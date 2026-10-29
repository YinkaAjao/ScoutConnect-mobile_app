// routes/account.js
// The signed-in account: its details and its editable profile.
const express = require('express');
const { ScoutProfile } = require('../models');
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

module.exports = router;
