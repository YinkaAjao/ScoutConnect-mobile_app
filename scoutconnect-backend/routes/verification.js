// routes/verification.js
// Club verification: the owner's request and the administrators' review.
const express = require('express');
const { sequelize, User, Player, Club, VerificationDocument, VerificationEvent } = require('../models');
const { verificationStatusOf, readinessChecklist, canRequestVerification, validateSubmission } = require('../lib/verification');
const { normaliseName } = require('../lib/profile');
const { clubRoleOf } = require('../lib/membership');
const { sendEmail, notifyClubOwners, adminRecipients } = require('../services/notifications');
const { authenticateToken, requireAdmin, requireActiveCoach, requireClubOwner } = require('../middleware/auth');
const emails = require('../lib/emails');

const router = express.Router();

// --- VERIFICATION: club owner side ---
router.get('/club/verification', authenticateToken, requireActiveCoach, async (req, res) => {
  try {
    const club = await Club.findByPk(req.user.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found.' });

    const athleteCount = await Player.count({ where: { currentClubId: club.id } });
    const [documents, history] = await Promise.all([
      VerificationDocument.findAll({ where: { clubId: club.id }, order: [['createdAt', 'ASC']] }),
      VerificationEvent.findAll({ where: { clubId: club.id }, order: [['createdAt', 'DESC']], limit: 10 })
    ]);

    res.status(200).json({
      status: verificationStatusOf(club),
      rejectionReason: club.verificationRejectionReason || null,
      statement: club.verificationStatement || null,
      submittedAt: club.verificationSubmittedAt || null,
      verifiedAt: club.verifiedAt || null,
      checklist: readinessChecklist(club, athleteCount),
      canRequest: clubRoleOf(req.user) === 'Owner' && canRequestVerification(club, athleteCount),
      isOwner: clubRoleOf(req.user) === 'Owner',
      documents: documents.map((d) => ({ id: d.id, docType: d.docType, fileName: d.fileName })),
      history: history.map((e) => ({ action: e.action, note: e.note, at: e.createdAt }))
    });
  } catch (error) {
    console.error('Verification status error:', error);
    res.status(500).json({ error: 'Failed to load verification status.' });
  }
});

router.post('/club/verification', authenticateToken, ...requireClubOwner, async (req, res) => {
  const parsed = validateSubmission(req.body, req.user.id);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const club = await Club.findByPk(req.user.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found.' });

    const status = verificationStatusOf(club);
    if (status === 'Verified') return res.status(409).json({ error: 'This club is already verified.' });
    if (status === 'Submitted') return res.status(409).json({ error: 'A verification request is already awaiting review.' });

    const athleteCount = await Player.count({ where: { currentClubId: club.id } });
    const missing = readinessChecklist(club, athleteCount).filter((item) => !item.done).map((item) => item.label);
    if (missing.length) return res.status(400).json({ error: `Complete these first: ${missing.join(', ')}.`, missing });

    await sequelize.transaction(async (transaction) => {
      // Only the latest submission's documents are kept; earlier decisions stay in the event log.
      await VerificationDocument.destroy({ where: { clubId: club.id }, transaction });
      for (const doc of parsed.documents) {
        await VerificationDocument.create({ clubId: club.id, uploadedBy: req.user.id, ...doc }, { transaction });
      }
      await club.update({
        verificationStatus: 'Submitted',
        verificationStatement: parsed.statement,
        verificationSubmittedAt: new Date(),
        verificationRejectionReason: null
      }, { transaction });
      await VerificationEvent.create({ clubId: club.id, actorId: req.user.id, action: 'Submitted', note: parsed.statement }, { transaction });
    });

    // The request is saved; telling the admins is best-effort.
    await sendEmail(req, {
      to: adminRecipients(),
      ...emails.newRequestEmail({ club, owner: req.user, documentCount: parsed.documents.length, athleteCount })
    });

    res.status(201).json({ status: 'Submitted' });
  } catch (error) {
    console.error('Verification submit error:', error);
    res.status(500).json({ error: 'Failed to submit verification request.' });
  }
});

// --- VERIFICATION: admin review ---
router.get('/admin/verifications', authenticateToken, requireAdmin, async (req, res) => {
  const status = ['Submitted', 'Verified', 'Rejected', 'Unverified'].includes(req.query.status) ? req.query.status : 'Submitted';
  try {
    // `isVerified` is the source of truth for Verified, so clubs verified before this feature still appear.
    const where = status === 'Verified' ? { isVerified: true } : { isVerified: false, verificationStatus: status };
    const clubs = await Club.findAll({ where, order: [['verificationSubmittedAt', 'ASC']], limit: 50 });

    const items = await Promise.all(clubs.map(async (club) => {
      const [owner, athleteCount, documents] = await Promise.all([
        User.findOne({ where: { clubId: club.id, role: 'Coach', clubRole: 'Owner' }, attributes: ['username', 'email', 'phone'], order: [['createdAt', 'ASC']] }),
        Player.count({ where: { currentClubId: club.id } }),
        VerificationDocument.findAll({ where: { clubId: club.id }, order: [['createdAt', 'ASC']] })
      ]);
      return {
        id: club.id,
        name: club.name,
        region: club.region,
        entityType: club.entityType,
        contactEmail: club.contactEmail,
        contactPhone: club.contactPhone,
        status: verificationStatusOf(club),
        statement: club.verificationStatement || null,
        submittedAt: club.verificationSubmittedAt || null,
        verifiedAt: club.verifiedAt || null,
        rejectionReason: club.verificationRejectionReason || null,
        athleteCount,
        owner: owner ? { username: owner.username, email: owner.email, phone: owner.phone } : null,
        documents: documents.map((d) => ({ id: d.id, docType: d.docType, fileName: d.fileName, storagePath: d.storagePath }))
      };
    }));
    res.status(200).json(items);
  } catch (error) {
    console.error('Admin verification list error:', error);
    res.status(500).json({ error: 'Failed to load verification requests.' });
  }
});

router.put('/admin/verifications/:clubId', authenticateToken, requireAdmin, async (req, res) => {
  const { decision } = req.body;
  const reason = normaliseName(req.body.reason);
  if (!['approve', 'reject', 'revoke'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be "approve", "reject" or "revoke".' });
  }
  if (decision !== 'approve' && !reason) return res.status(400).json({ error: 'A reason is required.' });

  try {
    const club = await Club.findByPk(req.params.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found.' });

    const status = verificationStatusOf(club);
    const allowedFrom = { approve: 'Submitted', reject: 'Submitted', revoke: 'Verified' }[decision];
    if (status !== allowedFrom) {
      return res.status(409).json({ error: `Only ${allowedFrom.toLowerCase()} clubs can be ${decision === 'revoke' ? 'revoked' : decision + 'd'}; this club is ${status.toLowerCase()}.` });
    }

    const outcome = {
      approve: { updates: { isVerified: true, verificationStatus: 'Verified', verifiedAt: new Date(), verifiedBy: req.user.id, verificationRejectionReason: null }, action: 'Verified' },
      reject: { updates: { isVerified: false, verificationStatus: 'Rejected', verificationRejectionReason: reason }, action: 'Rejected' },
      revoke: { updates: { isVerified: false, verificationStatus: 'Unverified', verifiedAt: null, verifiedBy: null, verificationRejectionReason: reason }, action: 'Revoked' }
    }[decision];

    await sequelize.transaction(async (transaction) => {
      await club.update(outcome.updates, { transaction });
      await VerificationEvent.create({ clubId: club.id, actorId: req.user.id, action: outcome.action, note: reason || null }, { transaction });
    });

    await notifyClubOwners(req, club, decision, reason);

    res.status(200).json({ id: club.id, status: verificationStatusOf(club) });
  } catch (error) {
    console.error('Admin verification decision error:', error);
    res.status(500).json({ error: 'Failed to record the decision.' });
  }
});

module.exports = router;
