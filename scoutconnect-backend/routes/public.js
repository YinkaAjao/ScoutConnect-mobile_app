// routes/public.js
// Endpoints that need no sign-in.
const express = require('express');
const { Club } = require('../models');

const router = express.Router();

// Lightweight endpoint for uptime pings (keeps a free Render instance awake without touching the database).
router.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// --- PUBLIC ---
router.get('/clubs/public', async (req, res) => {
  try {
    const clubs = await Club.findAll({ attributes: ['id', 'name', 'region'], order: [['name', 'ASC']] });
    res.status(200).json(clubs);
  } catch (error) {
    console.error('Error fetching public clubs:', error);
    res.status(500).json({ error: 'Failed to fetch clubs.' });
  }
});

module.exports = router;
