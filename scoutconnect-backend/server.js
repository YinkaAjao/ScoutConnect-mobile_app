// server.js
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer'); // NEW: For file uploads
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { sequelize, User, Player, Evaluation, MatchStat, Achievement, Shortlist, Club } = require('./models');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'scoutconnect_super_secret_key_2026';

// --- NEW: CLOUD STORAGE MOCK (MULTER SETUP) ---
// Ensure the uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Configure where and how to save the files
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, '_')}`)
});
const upload = multer({ storage });

// Serve the uploads folder publicly so the mobile app can render the images
app.use('/uploads', express.static(uploadDir));


// --- AUTHENTICATION MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access token required.' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
};

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
  const { username, password, role, clubId } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashedPassword, role, clubId });
    res.status(201).json({ message: 'User created successfully', userId: user.id });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ where: { username } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    
    const token = jwt.sign({ id: user.id, role: user.role, clubId: user.clubId }, JWT_SECRET);
    res.json({ token, role: user.role, username: user.username });
  } catch (error) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

// --- NEW: MEDIA UPLOAD ENDPOINT ---
app.post('/api/upload', authenticateToken, upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  
  // Create a URL pointing to the newly saved file
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.status(200).json({ url: fileUrl });
});


// --- SMART CONFLICT RESOLUTION (SYNC) ---
app.post('/api/sync', authenticateToken, async (req, res) => {
  const { records, matchStats, achievements } = req.body;
  const clubId = req.user.clubId; 
  const transaction = await sequelize.transaction();

  try {
    if (records && records.length > 0) {
      for (const record of records) {
        // FIXED: Included profilePhoto in the findOrCreate defaults and update logic
        const [player] = await Player.findOrCreate({
          where: { name: record.playerName, dateOfBirth: record.dateOfBirth },
          defaults: { 
            position: record.position || 'Unknown', 
            currentClubId: clubId,
            profilePhoto: record.profilePhoto 
          },
          transaction
        });

        const recordDate = new Date(record.timestamp);
        if (player.updatedAt < recordDate) {
          await player.update({ 
            currentClubId: clubId,
            // Only overwrite the photo if the coach uploaded a new one
            ...(record.profilePhoto && { profilePhoto: record.profilePhoto })
          }, { transaction });
        }

        await Evaluation.create({
          playerId: player.id,
          sprintSpeed: record.sprintSpeed,
          dribblingScore: record.dribblingScore,
          workRate: record.workRate,
          evalType: record.evalType 
        }, { transaction });
      }
    }

    if (matchStats && matchStats.length > 0) {
      for (const stat of matchStats) {
        const player = await Player.findOne({ where: { name: stat.playerName, dateOfBirth: stat.dateOfBirth }, transaction });
        if (player) {
          await MatchStat.create({ 
            playerId: player.id, competition: stat.competition, matchDate: stat.matchDate, opponent: stat.opponent,       
            matchResult: stat.matchResult, goals: stat.goals, assists: stat.assists, minutesPlayed: stat.minutesPlayed 
          }, { transaction });
        }
      }
    }

    if (achievements && achievements.length > 0) {
      for (const ach of achievements) {
        const player = await Player.findOne({ where: { name: ach.playerName, dateOfBirth: ach.dateOfBirth }, transaction });
        if (player) {
          await Achievement.create({ playerId: player.id, title: ach.title, year: ach.year }, { transaction });
        }
      }
    }

    await transaction.commit();
    res.status(200).json({ message: 'Synchronized successfully.' });

  } catch (error) {
    await transaction.rollback();
    console.error('Sync Error:', error);
    res.status(500).json({ error: 'Failed to synchronize data.' });
  }
});

// --- GET MULTIPLE PLAYERS (DISCOVER UI) ---
app.get('/api/players', authenticateToken, async (req, res) => {
  const { evalType, position, page = 1, limit = 5 } = req.query; 
  const offset = (page - 1) * limit;

  try {
    const playerWhere = {};
    if (position) playerWhere.position = position;

    const evaluationInclude = { model: Evaluation };
    if (evalType) evaluationInclude.where = { evalType: evalType };

    const { count, rows } = await Player.findAndCountAll({ 
      where: playerWhere, limit: parseInt(limit), offset: parseInt(offset), distinct: true, 
      include: [
        evaluationInclude, { model: MatchStat }, { model: Achievement },
        { model: Club, attributes: ['name', 'contactEmail', 'contactPhone'] } 
      ] 
    });

    res.status(200).json({ totalItems: count, totalPages: Math.ceil(count / limit), currentPage: parseInt(page), players: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- GET SINGLE PLAYER BY ID (DRILL-DOWN UI) ---
app.get('/api/players/:id', authenticateToken, async (req, res) => {
  try {
    const player = await Player.findByPk(req.params.id, {
      include: [{ model: Evaluation }, { model: MatchStat }, { model: Achievement }, { model: Club, attributes: ['name'] }],
      order: [ [Evaluation, 'createdAt', 'ASC'], [MatchStat, 'matchDate', 'DESC'] ]
    });
    if (!player) return res.status(404).json({ error: 'Player not found.' });
    res.status(200).json(player);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch player details.' });
  }
});

// --- SHORTLIST LOGIC ---
app.post('/api/shortlist', authenticateToken, async (req, res) => {
  const { playerId, notes } = req.body;
  const scoutId = req.user.id; 
  try {
    const existing = await Shortlist.findOne({ where: { scoutId, playerId } });
    if (existing) return res.status(400).json({ error: 'Athlete is already in your shortlist.' });
    const entry = await Shortlist.create({ scoutId, playerId, notes });
    res.status(201).json({ message: 'Added to shortlist!', entry });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add to shortlist.' });
  }
});

app.get('/api/shortlist', authenticateToken, async (req, res) => {
  const scoutId = req.user.id; 
  try {
    const shortlists = await Shortlist.findAll({
      where: { scoutId },
      include: [{ model: Player, include: [{ model: Evaluation }] }],
      order: [['createdAt', 'DESC']]
    });
    res.status(200).json(shortlists);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch shortlist.' });
  }
});

app.delete('/api/shortlist/:id', authenticateToken, async (req, res) => {
  try {
    const deleted = await Shortlist.destroy({ where: { id: req.params.id, scoutId: req.user.id } });
    if (deleted) res.status(200).json({ message: 'Removed from shortlist.' });
    else res.status(404).json({ error: 'Shortlist entry not found.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove from shortlist.' });
  }
});

// --- CLUB ENDPOINTS ---
app.get('/api/club', authenticateToken, async (req, res) => {
  try {
    const club = await Club.findByPk(req.user.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found.' });
    const playerCount = await Player.count({ where: { currentClubId: req.user.clubId } });
    res.status(200).json({ club, playerCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch club information.' });
  }
});

app.get('/api/club/players', authenticateToken, async (req, res) => {
  try {
    const players = await Player.findAll({
      where: { currentClubId: req.user.clubId }, 
      include: [{ model: Evaluation }, { model: MatchStat }, { model: Achievement }],
      order: [['name', 'ASC']]
    });
    res.status(200).json(players);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch club roster.' });
  }
});

const PORT = process.env.PORT || 5000;
sequelize.sync({ alter: true }).then(() => {
  console.log('PostgreSQL Database synced.');
  app.listen(PORT, () => console.log(`ScoutConnect API running on port ${PORT}`));
});