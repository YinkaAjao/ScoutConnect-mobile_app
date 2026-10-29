// routes/accreditation.js
// Scout accreditation: the scout's application and the administrators' review.
const express = require('express');
const { sequelize, User, VerificationDocument, VerificationEvent, ScoutProfile } = require('../models');
const { normaliseName } = require('../lib/profile');
const { sendEmail, adminRecipients } = require('../services/notifications');
const { authenticateToken, requireRole, requireAdmin } = require('../middleware/auth');
const emails = require('../lib/emails');
const scouts = require('../lib/scouts');

const router = express.Router();

// --- SCOUT ACCREDITATION: scout side ---
router.get('/scout/accreditation', authenticateToken, requireRole('Scout'), async (req, res) => {
  try {
    const profile = await ScoutProfile.findOne({ where: { userId: req.user.id } });
    const documents = profile ? await VerificationDocument.findAll({ where: { scoutUserId: req.user.id }, order: [['createdAt', 'ASC']] }) : [];
    res.status(200).json({
      status: profile?.status || 'Pending',
      organisation: profile?.organisation || null,
      orgType: profile?.orgType || null,
      licenceNumber: profile?.licenceNumber || null,
      statement: profile?.statement || null,
      submittedAt: profile?.submittedAt || null,
      decidedAt: profile?.decidedAt || null,
      rejectionReason: profile?.rejectionReason || null,
      documents: documents.map((d) => ({ id: d.id, docType: d.docType, fileName: d.fileName })),
      orgTypes: scouts.ORG_TYPES
    });
  } catch (error) {
    console.error('Accreditation status error:', error);
    res.status(500).json({ error: 'Failed to load your accreditation status.' });
  }
});

router.post('/scout/accreditation', authenticateToken, requireRole('Scout'), async (req, res) => {
  const parsed = scouts.validateAccreditation(req.body, req.user.id);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    let profile = await ScoutProfile.findOne({ where: { userId: req.user.id } });
    const status = profile?.status || 'Pending';
    if (status === 'Approved') return res.status(409).json({ error: 'Your accreditation is already approved.' });
    if (status === 'Submitted') return res.status(409).json({ error: 'Your application is already awaiting review.' });
    if (status === 'Suspended') return res.status(403).json({ error: 'Your scout access is suspended. Contact an administrator.', code: 'SCOUT_NOT_APPROVED' });

    await sequelize.transaction(async (transaction) => {
      // Only the latest application's documents are kept; earlier decisions stay in the event log.
      await VerificationDocument.destroy({ where: { scoutUserId: req.user.id }, transaction });
      for (const doc of parsed.documents) {
        await VerificationDocument.create({ scoutUserId: req.user.id, uploadedBy: req.user.id, ...doc }, { transaction });
      }
      const fields = {
        organisation: parsed.organisation,
        orgType: parsed.orgType,
        licenceNumber: parsed.licenceNumber,
        statement: parsed.statement,
        status: 'Submitted',
        submittedAt: new Date(),
        decidedAt: null,
        decidedBy: null,
        rejectionReason: null
      };
      if (profile) await profile.update(fields, { transaction });
      else profile = await ScoutProfile.create({ userId: req.user.id, ...fields }, { transaction });
      await VerificationEvent.create({ scoutUserId: req.user.id, actorId: req.user.id, action: 'Submitted', note: parsed.statement }, { transaction });
    });

    await sendEmail(req, {
      to: adminRecipients(),
      ...emails.scoutRequestEmail({ scout: req.user, profile: parsed, documentCount: parsed.documents.length })
    });
    res.status(201).json({ status: 'Submitted' });
  } catch (error) {
    console.error('Accreditation submit error:', error);
    res.status(500).json({ error: 'Failed to submit your application.' });
  }
});

// --- SCOUT ACCREDITATION: admin review ---
router.get('/admin/scouts', authenticateToken, requireAdmin, async (req, res) => {
  const status = ['Submitted', 'Approved', 'Rejected', 'Suspended'].includes(req.query.status) ? req.query.status : 'Submitted';
  try {
    const profiles = await ScoutProfile.findAll({ where: { status }, order: [['submittedAt', 'ASC']], limit: 50 });
    const items = await Promise.all(profiles.map(async (profile) => {
      const [user, documents] = await Promise.all([
        User.findByPk(profile.userId, { attributes: ['username', 'email', 'phone'] }),
        VerificationDocument.findAll({ where: { scoutUserId: profile.userId }, order: [['createdAt', 'ASC']] })
      ]);
      return {
        id: profile.userId, // decisions are addressed by the scout's user id
        name: user?.username || 'Unknown',
        email: user?.email || null,
        phone: user?.phone || null,
        organisation: profile.organisation,
        orgType: profile.orgType,
        licenceNumber: profile.licenceNumber,
        statement: profile.statement || null,
        status: profile.status,
        submittedAt: profile.submittedAt || null,
        decidedAt: profile.decidedAt || null,
        rejectionReason: profile.rejectionReason || null,
        documents: documents.map((d) => ({ id: d.id, docType: d.docType, fileName: d.fileName, storagePath: d.storagePath }))
      };
    }));
    res.status(200).json(items);
  } catch (error) {
    console.error('Admin scout list error:', error);
    res.status(500).json({ error: 'Failed to load scout applications.' });
  }
});

const SCOUT_DECISIONS = {
  approve: { from: 'Submitted', to: 'Approved', action: 'Approved' },
  reject: { from: 'Submitted', to: 'Rejected', action: 'Rejected', needsReason: true },
  suspend: { from: 'Approved', to: 'Suspended', action: 'Suspended', needsReason: true },
  reinstate: { from: 'Suspended', to: 'Approved', action: 'Reinstated' }
};

router.put('/admin/scouts/:userId', authenticateToken, requireAdmin, async (req, res) => {
  const { decision } = req.body;
  const rule = SCOUT_DECISIONS[decision];
  const reason = normaliseName(req.body.reason);
  if (!rule) return res.status(400).json({ error: 'Decision must be "approve", "reject", "suspend" or "reinstate".' });
  if (rule.needsReason && !reason) return res.status(400).json({ error: 'A reason is required.' });

  try {
    const profile = await ScoutProfile.findOne({ where: { userId: req.params.userId } });
    if (!profile) return res.status(404).json({ error: 'Scout application not found.' });
    if (profile.status !== rule.from) {
      return res.status(409).json({ error: `Only ${rule.from.toLowerCase()} scouts can be ${decision === 'reject' ? 'rejected' : decision + 'd'}; this scout is ${String(profile.status).toLowerCase()}.` });
    }

    await sequelize.transaction(async (transaction) => {
      await profile.update({
        status: rule.to,
        decidedAt: new Date(),
        decidedBy: req.user.id,
        rejectionReason: rule.needsReason ? reason : null
      }, { transaction });
      await VerificationEvent.create({ scoutUserId: profile.userId, actorId: req.user.id, action: rule.action, note: reason || null }, { transaction });
    });

    try {
      const scoutUser = await User.findByPk(profile.userId, { attributes: ['email'] });
      await sendEmail(req, { to: scoutUser?.email, ...emails.scoutDecisionEmail({ decision, reason }) });
    } catch (error) {
      console.error('Could not notify the scout:', error.message);
    }

    res.status(200).json({ id: profile.userId, status: rule.to });
  } catch (error) {
    console.error('Admin scout decision error:', error);
    res.status(500).json({ error: 'Failed to record the decision.' });
  }
});

module.exports = router;
