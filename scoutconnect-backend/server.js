// server.js
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken'); 
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const { sequelize, User, Player, Evaluation, MatchStat, Achievement, Shortlist, Club, Flag } = require('./models');

const app = express();
app.use(cors());
app.use(express.json());

// --- GLOBAL REQUEST LOGGER ---
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] Incoming Request: ${req.method} ${req.url}`);
  next();
});

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'your-supabase-jwt-secret';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, '_')}`)
});
const upload = multer({ storage });
app.use('/uploads', express.static(uploadDir));

// --- SUPABASE AUTHENTICATION MIDDLEWARE WITH ERROR LOGGING ---
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    console.log(`❌ Auth Blocked: Missing token for ${req.url}`);
    return res.status(401).json({ error: 'Access token required.' });
  }
  
  try {
    let userId;
    try {
      userId = jwt.verify(token, SUPABASE_JWT_SECRET).sub;
    } catch (verifyErr) {
      // Shared-secret check failed (wrong/missing secret or asymmetric signing keys): ask Supabase Auth to validate.
      console.log(`⚠️ Local JWT verify failed (${verifyErr.message}); falling back to Supabase Auth.`);
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw verifyErr;
      const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY }
      });
      if (!authRes.ok) throw new Error(`Supabase Auth rejected token (${authRes.status})`);
      userId = (await authRes.json()).id;
    }
    const userRecord = await User.findByPk(userId);
    
    if (!userRecord) {
      console.log(`❌ Auth Blocked: Token valid, but UUID ${userId} missing in Postgres DB.`);
      return res.status(404).json({ error: 'User profile not found in Postgres.' });
    }
    
    req.user = userRecord;
    next();
  } catch (err) {
    console.log(`❌ Auth Blocked: JWT verification failed for ${req.url}. Reason: ${err.message}`);
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

app.get('/api/clubs/public', async (req, res) => {
  try {
    const clubs = await Club.findAll({ 
      attributes: ['id', 'name', 'region'],
      order: [['name', 'ASC']]
    });
    res.status(200).json(clubs);
  } catch (error) {
    console.error('Error fetching public clubs:', error);
    res.status(500).json({ error: 'Failed to fetch clubs.' });
  }
});

app.post('/api/auth/sync-profile', async (req, res) => {
  const { id, username, email, phone, role, clubId, newClubName, newClubRegion } = req.body;
  try {
    let assignedClubId = clubId;

    if (role === 'Coach' && !clubId && newClubName) {
      const [club] = await Club.findOrCreate({
        where: { name: newClubName.trim() },
        defaults: {
          region: newClubRegion || 'Kigali',
          isVerified: false
        }
      });
      assignedClubId = club.id;
    }

    if (role === 'Coach' && !assignedClubId) {
      return res.status(400).json({ error: 'Coaches must select or register an academy.' });
    }

    const user = await User.create({ 
      id, 
      username: username.trim(), 
      email: email.toLowerCase().trim(),
      phone: phone || null,
      role, 
      clubId: role === 'Coach' ? assignedClubId : null 
    });

    res.status(201).json({ message: 'Profile synced successfully', user });
  } catch (error) {
    console.error('Profile sync error:', error);
    res.status(500).json({ error: 'Profile sync failed.' });
  }
});

app.post('/api/upload', authenticateToken, upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.status(200).json({ url: fileUrl });
});

app.post('/api/sync', authenticateToken, async (req, res) => {
  const { records, matchStats, achievements } = req.body;
  const clubId = req.user.clubId; 
  const coachId = req.user.id;
  const transaction = await sequelize.transaction();

  try {
    if (records && records.length > 0) {
      for (const record of records) {
        let parsedChecklist = null;
        if (record.checklistJson) {
          try {
            parsedChecklist = typeof record.checklistJson === 'string' 
              ? JSON.parse(record.checklistJson) 
              : record.checklistJson;
          } catch (e) {
            parsedChecklist = null;
          }
        }

        const resolvedPosition = record.position || parsedChecklist?.position || 'Forward';

        const [player] = await Player.findOrCreate({
          where: { name: record.playerName, dateOfBirth: record.dateOfBirth, currentClubId: clubId },
          defaults: { 
            position: resolvedPosition, 
            currentClubId: clubId,
            profilePhoto: record.profilePhoto 
          },
          transaction
        });

        const recordDate = new Date(record.timestamp || Date.now());
        if (player.updatedAt < recordDate) {
          await player.update({ 
            currentClubId: clubId,
            position: resolvedPosition,
            ...(record.profilePhoto && { profilePhoto: record.profilePhoto })
          }, { transaction });
        }

        const signaturePayload = `${coachId}-${player.id}-${record.sprintSpeed}-${record.dribblingScore}-${recordDate.getTime()}`;
        const coachSignature = crypto.createHmac('sha256', process.env.JWT_SECRET || 'fallback_secret').update(signaturePayload).digest('hex');

        await Evaluation.create({
          playerId: player.id,
          sprintSpeed: record.sprintSpeed,
          dribblingScore: record.dribblingScore,
          workRate: record.workRate,
          evalType: record.evalType,
          evaluatorName: parsedChecklist?.evaluatorName || null,
          evaluationDate: parsedChecklist?.evaluationDate || null,
          overallRating: parsedChecklist?.overallRating || null,
          strengths: parsedChecklist?.strengths || null,
          areasForImprovement: parsedChecklist?.areasForImprovement || null,
          checklistData: parsedChecklist,
          coachSignature
        }, { transaction });
      }
    }

    if (matchStats && matchStats.length > 0) {
      for (const stat of matchStats) {
        const player = await Player.findOne({ where: { name: stat.playerName, dateOfBirth: stat.dateOfBirth, currentClubId: clubId }, transaction });
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
        const player = await Player.findOne({ where: { name: ach.playerName, dateOfBirth: ach.dateOfBirth, currentClubId: clubId }, transaction });
        if (player) {
          await Achievement.create({ playerId: player.id, title: ach.title, year: ach.year }, { transaction });
        }
      }
    }

    await transaction.commit();
    res.status(200).json({ message: 'Synchronized successfully with accountability audit trail.' });

  } catch (error) {
    await transaction.rollback();
    console.error('Sync Error:', error);
    res.status(500).json({ error: 'Failed to synchronize data.' });
  }
});

app.post('/api/flags', authenticateToken, async (req, res) => {
  const { playerId, reason } = req.body;
  const reporterId = req.user.id;

  try {
    const flag = await Flag.create({ reporterId, playerId, reason });

    const player = await Player.findByPk(playerId, { include: [Club] });
    if (player && player.Club) {
      const totalFlags = await Flag.count({
        include: [{ model: Player, where: { currentClubId: player.Club.id } }],
        where: { status: 'Pending' }
      });

      if (totalFlags >= 5 && player.Club.standingStatus !== 'Penalized') {
        await player.Club.update({
          standingStatus: 'Penalized',
          trustScore: Math.max(0, (player.Club.trustScore || 100) - 15)
        });
      }
    }

    res.status(201).json({ message: 'Profile successfully flagged for manual audit.', flag });
  } catch (error) {
    console.error('Flag error:', error);
    res.status(500).json({ error: 'Failed to submit flag report.' });
  }
});

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
        { model: Club, attributes: ['name', 'contactEmail', 'contactPhone', 'standingStatus', 'trustScore'] } 
      ] 
    });

    res.status(200).json({ totalItems: count, totalPages: Math.ceil(count / limit), currentPage: parseInt(page), players: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/players/:id', authenticateToken, async (req, res) => {
  try {
    const player = await Player.findByPk(req.params.id, {
      include: [
        { model: Evaluation }, 
        { model: MatchStat }, 
        { model: Achievement }, 
        { model: Club, attributes: ['name', 'region', 'contactEmail', 'contactPhone', 'standingStatus', 'trustScore'] }
      ],
      order: [ [Evaluation, 'createdAt', 'ASC'], [MatchStat, 'matchDate', 'DESC'] ]
    });
    if (!player) return res.status(404).json({ error: 'Player not found.' });
    res.status(200).json(player);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch player details.' });
  }
});

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

app.get('/api/club', authenticateToken, async (req, res) => {
  try {
    const club = await Club.findByPk(req.user.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found.' });
    const playerCount = await Player.count({ where: { currentClubId: req.user.clubId } });
    res.status(200).json({ club, playerCount, coachProfile: req.user });
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