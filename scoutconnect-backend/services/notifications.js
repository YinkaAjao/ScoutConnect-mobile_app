// services/notifications.js
// Email helpers. Sending is best effort: whatever triggered an email has already been saved.
const { User } = require('../models');
const emails = require('../lib/emails');

const adminRecipients = () => (process.env.ADMIN_NOTIFY_EMAIL || '').split(',').map((e) => e.trim()).filter(Boolean);

/** Sends an email without ever failing the request: whatever triggered it has already been saved. */
async function sendEmail(req, message) {
  try {
    await req.app.locals.notifier.send(message);
  } catch (error) {
    console.error('Email failed:', error.message);
  }
}

/** Tells a club's owner(s) about a decision. */
async function notifyClubOwners(req, club, decision, reason) {
  try {
    const owners = await User.findAll({ where: { clubId: club.id, role: 'Coach', clubRole: 'Owner' }, attributes: ['email', 'username'] });
    await sendEmail(req, { to: owners.map((o) => o.email), ...emails.decisionEmail({ club, decision, reason }) });
  } catch (error) {
    console.error('Could not notify club owners:', error.message);
  }
}

module.exports = { adminRecipients, sendEmail, notifyClubOwners };
