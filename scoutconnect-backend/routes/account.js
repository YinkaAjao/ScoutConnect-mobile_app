// routes/account.js
// The signed-in account: its details and its editable profile.
const express = require('express');
const models = require('../models');
const { sequelize, ScoutProfile } = models;
const { SUPABASE_URL } = require('../config/supabase');
const { createAccountDeleter } = require('../services/accountDeletion');
const { normaliseName } = require('../lib/profile');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// The signed-in account's own details (for profile screens).
router.get('/me', authenticateToken, async (req, res) => {
  const user = req.user;
  const me = {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone || null,
    role: user.role,
    isAdmin: Boolean(user.isAdmin),
    createdAt: user.createdAt || null
  };
  if (user.role === 'Scout') {
    try {
      me.accreditationStatus = (await ScoutProfile.findOne({ where: { userId: user.id } }))?.status || 'Pending';
    } catch (error) {
      console.error('Could not read accreditation status:', error.message);
    }
  }
  res.status(200).json(me);
});

// Update the signed-in user's own display name and phone.
router.put('/profile', authenticateToken, async (req, res) => {
  if (req.user.isAdmin) return res.status(403).json({ error: 'Administrator accounts have no editable profile.' });
  const { username, phone } = req.body;
  const updates = {};
  if (username !== undefined) {
    if (!normaliseName(username)) return res.status(400).json({ error: 'Name cannot be empty.' });
    updates.username = normaliseName(username);
  }
  if (phone !== undefined) updates.phone = normaliseName(phone) || null;

  try {
    await req.user.update(updates);
    res.status(200).json({ user: req.user });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// Delete the signed-in user's own account (see services/accountDeletion.js for what goes and what stays).
router.delete('/account', authenticateToken, async (req, res) => {
  const deleter = createAccountDeleter({
    sequelize, models, supabaseUrl: SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  });
  try {
    const result = await deleter.deleteAccount(req.user, req.body?.confirm);
    if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
    res.status(200).json({ message: 'Your account has been deleted.' });
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({ error: 'Could not delete your account. Nothing was removed.' });
  }
});

module.exports = router;
