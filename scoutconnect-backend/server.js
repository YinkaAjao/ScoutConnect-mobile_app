// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Op, fn, col, where: sqlWhere } = require('sequelize');

const { sequelize, User, Player, Evaluation, MatchStat, Achievement, Shortlist, Club, Flag, VerificationDocument, VerificationEvent, ScoutProfile, ContactRequest, ScoutAccessLog } = require('./models');
const { createTokenVerifier } = require('./lib/auth');
const { verificationStatusOf, readinessChecklist, canRequestVerification, validateSubmission } = require('./lib/verification');
const { createNotifier } = require('./lib/notify');
const emails = require('./lib/emails');
const scouts = require('./lib/scouts');
const { createPhotoSigner } = require('./lib/photos');
const { validateReport, URGENT_CATEGORIES } = require('./lib/reports');
const { ENTITY_TYPES, normaliseName, isValidDob, isValidEmail, profileFromClaims } = require('./lib/profile');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// --- GLOBAL REQUEST LOGGER ---
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] Incoming Request: ${req.method} ${req.url}`);
  next();
});

// Lightweight endpoint for uptime pings (keeps a free Render instance awake without touching the database).
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));

// Pinned (never taken from a token) so a forged `iss` can't point verification at an attacker's keys.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xekggzfumxbqvoyirndd.supabase.co';
const verifySupabaseToken = createTokenVerifier({
  supabaseUrl: SUPABASE_URL,
  jwtSecret: process.env.SUPABASE_JWT_SECRET
});
if (!process.env.JWT_SECRET) console.warn('⚠️ JWT_SECRET is not set: evaluation signatures use a weak fallback secret.');

// Email (Resend). Kept on app.locals so tests can swap in a fake. Without RESEND_API_KEY + MAIL_FROM it quietly does nothing.
app.locals.notifier = createNotifier({ apiKey: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM });
if (!app.locals.notifier.enabled) console.warn('⚠️ Email notifications are off: set RESEND_API_KEY and MAIL_FROM to turn them on.');

// Photos are in a private bucket; the server creates short-lived links for people allowed to see them.
// Without the project's service-role key no photo is shown (safer than falling back to public links).
app.locals.photos = createPhotoSigner({ supabaseUrl: SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
if (!app.locals.photos.enabled) console.warn('⚠️ Photos are off: set SUPABASE_SERVICE_ROLE_KEY so the server can create private photo links.');

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

// --- HELPERS ---
const membershipOf = (user) => user.membershipStatus || 'Active';
const clubRoleOf = (user) => user.clubRole || 'Owner';
const escapeLike = (text) => String(text).replace(/[\\%_]/g, '\\$&');
const byLowerName = (name) => sqlWhere(fn('lower', col('name')), normaliseName(name).toLowerCase());
const byCreatedAt = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);

/**
 * Plain object whose evaluations run oldest -> newest, so clients can safely treat the last one as the latest.
 * (The database returns joined rows in no particular order.)
 */
const withSortedEvaluations = (row) => {
  const plain = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
  if (Array.isArray(plain.Evaluations)) plain.Evaluations = [...plain.Evaluations].sort(byCreatedAt);
  return plain;
};

/** Parses a comma-separated query value ("a,b,c") into a clean list. */
const csv = (value) => String(value || '').split(',').map(normaliseName).filter(Boolean);

const toInt = (value, { min = 0, max = 1000000 } = {}) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** Creates the Postgres profile for a verified Supabase user from the answers stored at sign-up. */
async function provisionUser(claims) {
  const parsed = profileFromClaims(claims);
  if (parsed.error) {
    const err = new Error(parsed.error);
    err.status = 400;
    throw err;
  }
  const p = parsed.profile;

  return sequelize.transaction(async (transaction) => {
    const base = { id: p.id, username: p.username, email: p.email, phone: p.phone, role: p.role };

    if (p.role === 'Scout') {
      const [user] = await User.findOrCreate({ where: { id: p.id }, defaults: base, transaction });
      return user;
    }

    let club;
    let joining = true;
    if (p.clubId) {
      club = await Club.findByPk(p.clubId, { transaction });
      if (!club) {
        const err = new Error('The selected academy no longer exists.');
        err.status = 400;
        throw err;
      }
    } else {
      // Registering a name that already exists is a request to join it, never a takeover.
      club = await Club.findOne({ where: byLowerName(p.newClub.name), transaction });
      if (!club) {
        club = await Club.create({ ...p.newClub, isVerified: false }, { transaction });
        joining = false;
      }
    }

    const [user] = await User.findOrCreate({
      where: { id: p.id },
      defaults: {
        ...base,
        clubId: club.id,
        clubRole: joining ? 'Member' : 'Owner',
        membershipStatus: joining ? 'Pending' : 'Active'
      },
      transaction
    });
    return user;
  });
}

// --- SUPABASE AUTHENTICATION MIDDLEWARE ---
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log(`❌ Auth Blocked: Missing token for ${req.url}`);
    return res.status(401).json({ error: 'Access token required.' });
  }

  let claims;
  try {
    claims = await verifySupabaseToken(token);
  } catch (err) {
    console.log(`❌ Auth Blocked: JWT verification failed for ${req.url}. Reason: ${err.message}`);
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }

  // Admins are marked in the token's app_metadata, which only the Supabase project owner can set (users can't edit it).
  // They have no row in our tables: they exist only to review verification requests.
  if (claims.app_metadata?.role === 'admin') {
    req.user = { id: claims.sub, email: claims.email, username: claims.email, role: 'Admin', isAdmin: true };
    return next();
  }

  try {
    let user = await User.findByPk(claims.sub);
    if (!user) {
      try {
        user = await provisionUser(claims);
        console.log(`✅ Provisioned profile for ${claims.sub} (${user.role})`);
      } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') {
          user = await User.findByPk(claims.sub); // lost a race with a parallel first request
          if (!user) return res.status(409).json({ error: 'An account with this email already exists.' });
        } else {
          console.log(`❌ Auth Blocked: could not create profile for ${claims.sub}. Reason: ${err.message}`);
          return res.status(err.status || 500).json({ error: err.status ? err.message : 'Failed to set up your profile.', code: 'PROFILE_INCOMPLETE' });
        }
      }
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth lookup error:', err);
    return res.status(500).json({ error: 'Authentication failed.' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (roles.includes(req.user.role)) return next();
  return res.status(403).json({ error: `This action is only available to ${roles.join(' or ')} accounts.`, code: 'WRONG_ROLE' });
};

const requireAdmin = (req, res, next) =>
  req.user.isAdmin ? next() : res.status(403).json({ error: 'Administrator access required.', code: 'NOT_ADMIN' });

/** Coach whose membership of their club has been approved. */
const requireActiveCoach = (req, res, next) => {
  if (req.user.role !== 'Coach') {
    return res.status(403).json({ error: 'This action is only available to Coach accounts.', code: 'WRONG_ROLE' });
  }
  if (!req.user.clubId) return res.status(403).json({ error: 'Your account is not linked to a club.', code: 'NO_CLUB' });
  const status = membershipOf(req.user);
  if (status === 'Pending') return res.status(403).json({ error: 'Your request to join this club is awaiting approval.', code: 'MEMBERSHIP_PENDING' });
  if (status !== 'Active') return res.status(403).json({ error: 'Your request to join this club was declined.', code: 'MEMBERSHIP_REJECTED' });
  next();
};

const requireClubOwner = [
  requireActiveCoach,
  (req, res, next) =>
    clubRoleOf(req.user) === 'Owner'
      ? next()
      : res.status(403).json({ error: 'Only the club owner can do this.', code: 'NOT_OWNER' })
];

/** Scout whose accreditation an administrator has approved. Everyone else is locked out of athlete data. */
const requireApprovedScout = async (req, res, next) => {
  if (req.user.role !== 'Scout') {
    return res.status(403).json({ error: 'This action is only available to Scout accounts.', code: 'WRONG_ROLE' });
  }
  try {
    const profile = await ScoutProfile.findOne({ where: { userId: req.user.id } });
    const status = profile?.status || 'Pending'; // no row = never applied
    if (status !== 'Approved') {
      return res.status(403).json({
        error: status === 'Suspended' ? 'Your scout access has been suspended.' : 'Your scout accreditation has not been approved yet.',
        code: 'SCOUT_NOT_APPROVED',
        accreditationStatus: status
      });
    }
    req.scoutProfile = profile;
    next();
  } catch (error) {
    console.error('Scout access check failed:', error);
    res.status(500).json({ error: 'Could not check your accreditation.' });
  }
};

// Browsing limit: scraping the roster of children's records would take thousands of requests.
// It counts the scout's recent rows in the access log, so it survives restarts and works across server instances.
const SEARCH_WINDOW_MS = 10 * 60 * 1000;
const SEARCH_MAX_PER_WINDOW = 120;

const limitScoutSearches = async (req, res, next) => {
  try {
    const recent = await ScoutAccessLog.count({
      where: { scoutId: req.user.id, createdAt: { [Op.gte]: new Date(Date.now() - SEARCH_WINDOW_MS) } }
    });
    if (recent >= SEARCH_MAX_PER_WINDOW) {
      res.set('Retry-After', '60');
      return res.status(429).json({ error: 'You are browsing very quickly. Please wait a moment and try again.', code: 'RATE_LIMITED', retryAfterSeconds: 60 });
    }
  } catch (error) {
    console.error('Search limit check failed:', error.message); // fail open: the search itself needs the same database
  }
  next();
};

/** One row per scout search, so unusual browsing can be spotted later. Best effort: it never fails the request. */
async function logScoutAccess(scoutId, route, athleteIds) {
  try {
    await ScoutAccessLog.create({ scoutId, route, resultCount: athleteIds.length, athleteIds: athleteIds.slice(0, 50) });
  } catch (error) {
    console.error('Could not write the scout access log:', error.message);
  }
}

// --- PUBLIC ---
app.get('/api/clubs/public', async (req, res) => {
  try {
    const clubs = await Club.findAll({ attributes: ['id', 'name', 'region'], order: [['name', 'ASC']] });
    res.status(200).json(clubs);
  } catch (error) {
    console.error('Error fetching public clubs:', error);
    res.status(500).json({ error: 'Failed to fetch clubs.' });
  }
});

// --- SYNC (idempotent, partial-success) ---
/**
 * Finds the athlete a synced item refers to. Prefers the server id (survives renames), then name + date of birth.
 * Evaluations may create the athlete; match stats and achievements may not.
 */
async function resolveAthlete(item, clubId, { create, defaults }, transaction) {
  if (item.playerId) {
    const byId = await Player.findOne({ where: { id: item.playerId, currentClubId: clubId }, transaction });
    return byId ? { player: byId } : { reason: 'athlete_removed' };
  }
  const name = normaliseName(item.playerName);
  if (!name || !isValidDob(item.dateOfBirth)) return { reason: 'invalid_athlete_details' };

  const existing = await Player.findOne({
    where: { [Op.and]: [byLowerName(name), { dateOfBirth: item.dateOfBirth, currentClubId: clubId }] },
    transaction
  });
  if (existing) return { player: existing };
  if (!create) return { reason: 'athlete_not_found' };
  const player = await Player.create({ name, dateOfBirth: item.dateOfBirth, currentClubId: clubId, ...defaults }, { transaction });
  return { player };
}

app.post('/api/sync', authenticateToken, requireActiveCoach, async (req, res) => {
  const { records = [], matchStats = [], achievements = [] } = req.body;
  const clubId = req.user.clubId;
  const coachId = req.user.id;
  const syncedIds = { records: [], matchStats: [], achievements: [] };
  const skipped = [];
  let created = 0;
  let duplicates = 0;

  // Each item commits on its own, so one bad item never rolls back (or blocks) the rest of the batch.
  const processItem = async (type, item, work) => {
    try {
      const outcome = await sequelize.transaction(async (transaction) => {
        if (item.clientId) {
          const Model = { records: Evaluation, matchStats: MatchStat, achievements: Achievement }[type];
          if (await Model.findOne({ where: { clientId: item.clientId }, transaction })) return 'duplicate';
        }
        return work(transaction);
      });
      if (outcome === 'duplicate') duplicates += 1;
      else if (outcome === 'created') created += 1;
      else { skipped.push({ type, id: item.id, reason: outcome }); return; }
      syncedIds[type].push(item.id);
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError' && item.clientId) {
        duplicates += 1; // a parallel request stored the same item first
        syncedIds[type].push(item.id);
        return;
      }
      console.error(`Sync error (${type} ${item.id}):`, error);
      skipped.push({ type, id: item.id, reason: 'server_error' });
    }
  };

  for (const record of Array.isArray(records) ? records : []) {
    await processItem('records', record, async (transaction) => {
      let parsedChecklist = null;
      if (record.checklistJson) {
        try {
          parsedChecklist = typeof record.checklistJson === 'string' ? JSON.parse(record.checklistJson) : record.checklistJson;
        } catch (e) {
          parsedChecklist = null;
        }
      }
      const resolvedPosition = record.position || parsedChecklist?.position || 'Forward';

      const found = await resolveAthlete(record, clubId, {
        create: true,
        defaults: { position: resolvedPosition, profilePhoto: record.profilePhoto || null, consentStatus: 'Missing' }
      }, transaction);
      if (!found.player) return found.reason;
      const player = found.player;

      const recordDate = new Date(record.timestamp || Date.now());
      if (player.updatedAt < recordDate) {
        await player.update({
          position: resolvedPosition,
          ...(record.profilePhoto && { profilePhoto: record.profilePhoto })
        }, { transaction });
      }

      const signaturePayload = `${coachId}-${player.id}-${record.sprintSpeed}-${record.dribblingScore}-${recordDate.getTime()}`;
      const coachSignature = crypto.createHmac('sha256', process.env.JWT_SECRET || 'fallback_secret').update(signaturePayload).digest('hex');

      await Evaluation.create({
        playerId: player.id,
        clientId: record.clientId || null,
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
      return 'created';
    });
  }

  for (const stat of Array.isArray(matchStats) ? matchStats : []) {
    await processItem('matchStats', stat, async (transaction) => {
      const found = await resolveAthlete(stat, clubId, { create: false }, transaction);
      if (!found.player) return found.reason;
      await MatchStat.create({
        playerId: found.player.id,
        clientId: stat.clientId || null,
        competition: stat.competition,
        matchDate: stat.matchDate,
        opponent: stat.opponent,
        matchResult: stat.matchResult,
        goals: stat.goals,
        assists: stat.assists,
        minutesPlayed: stat.minutesPlayed
      }, { transaction });
      return 'created';
    });
  }

  for (const ach of Array.isArray(achievements) ? achievements : []) {
    await processItem('achievements', ach, async (transaction) => {
      const found = await resolveAthlete(ach, clubId, { create: false }, transaction);
      if (!found.player) return found.reason;
      await Achievement.create({ playerId: found.player.id, clientId: ach.clientId || null, title: ach.title, year: ach.year }, { transaction });
      return 'created';
    });
  }

  res.status(200).json({
    message: skipped.length ? 'Synchronized with some items skipped.' : 'Synchronized successfully with accountability audit trail.',
    syncedIds,
    skipped,
    summary: { created, duplicates, skipped: skipped.length }
  });
});

// --- REPORTS (flags) ---
// Anyone who can see an athlete can report a problem with their profile. Administrators review the reports.
app.post('/api/flags', authenticateToken, async (req, res) => {
  const parsed = validateReport(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const reporterId = req.user.id;
  const { playerId } = req.body;

  if (req.user.isAdmin) return res.status(403).json({ error: 'Administrators review reports; they do not file them.' });
  if (req.user.role === 'Coach' && membershipOf(req.user) !== 'Active') {
    return res.status(403).json({ error: 'Your club membership is not active.', code: 'MEMBERSHIP_PENDING' });
  }

  try {
    if (req.user.role === 'Scout') {
      const profile = await ScoutProfile.findOne({ where: { userId: reporterId } });
      const status = profile?.status || 'Pending';
      if (status !== 'Approved') {
        return res.status(403).json({ error: 'Your scout accreditation has not been approved yet.', code: 'SCOUT_NOT_APPROVED', accreditationStatus: status });
      }
    }

    const player = playerId ? await Player.findByPk(playerId, { include: [Club] }) : null;
    // A scout can only report an athlete they are able to see.
    if (!player || (req.user.role === 'Scout' && !scouts.isVisibleToScouts(player))) return res.status(404).json({ error: 'Player not found.' });
    if (req.user.clubId && player.currentClubId === req.user.clubId) {
      return res.status(403).json({ error: 'You cannot report athletes from your own club.' });
    }
    if (await Flag.findOne({ where: { reporterId, playerId, status: 'Pending' } })) {
      return res.status(409).json({ error: 'You have already reported this profile.' });
    }

    const flag = await Flag.create({ reporterId, playerId, category: parsed.category, reason: parsed.details });

    if (player.Club) {
      // Count distinct reporters, so a single account can't penalise a rival club on its own.
      const pendingFlags = await Flag.findAll({
        attributes: ['reporterId'],
        where: { status: 'Pending' },
        include: [{ model: Player, attributes: [], where: { currentClubId: player.Club.id }, required: true }],
        raw: true
      });
      const uniqueReporters = new Set(pendingFlags.map((f) => f.reporterId)).size;
      if (uniqueReporters >= 5 && player.Club.standingStatus !== 'Penalized') {
        await player.Club.update({
          standingStatus: 'Penalized',
          trustScore: Math.max(0, (player.Club.trustScore || 100) - 15)
        });
      }
    }

    await sendEmail(req, {
      to: adminRecipients(),
      ...emails.reportEmail({ athleteName: player.name, clubName: player.Club?.name, category: parsed.category, details: parsed.details, reporter: req.user })
    });

    res.status(201).json({ message: 'Thank you. An administrator will review your report.', id: flag.id });
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Failed to submit your report.' });
  }
});

app.get('/api/admin/reports', authenticateToken, requireAdmin, async (req, res) => {
  const status = ['Pending', 'Resolved', 'Dismissed'].includes(req.query.status) ? req.query.status : 'Pending';
  try {
    const flags = await Flag.findAll({
      where: { status },
      order: [['createdAt', status === 'Pending' ? 'ASC' : 'DESC']],
      limit: 50,
      include: [
        { model: Player, attributes: ['id', 'name', 'position', 'currentClubId', 'scoutHidden', 'scoutHiddenReason'] },
        { model: User, attributes: ['username', 'role'] }
      ]
    });

    const clubIds = [...new Set(flags.map((f) => f.Player?.currentClubId).filter(Boolean))];
    const clubs = clubIds.length ? await Club.findAll({ where: { id: { [Op.in]: clubIds } }, attributes: ['id', 'name'] }) : [];
    const clubName = new Map(clubs.map((c) => [c.id, c.name]));

    const items = flags.map((row) => {
      const flag = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
      return {
        id: flag.id,
        category: flag.category || 'Other',
        details: flag.reason,
        status: flag.status,
        createdAt: flag.createdAt,
        resolutionNote: flag.resolutionNote || null,
        resolvedAt: flag.resolvedAt || null,
        athlete: flag.Player
          ? { id: flag.Player.id, name: flag.Player.name, position: flag.Player.position, scoutHidden: Boolean(flag.Player.scoutHidden), scoutHiddenReason: flag.Player.scoutHiddenReason || null }
          : null,
        club: flag.Player ? { name: clubName.get(flag.Player.currentClubId) || null } : null,
        reporter: flag.User ? { username: flag.User.username, role: flag.User.role } : null
      };
    });
    // Safeguarding concerns always come first.
    items.sort((a, b) => Number(URGENT_CATEGORIES.includes(b.category)) - Number(URGENT_CATEGORIES.includes(a.category)));

    res.status(200).json(items);
  } catch (error) {
    console.error('Admin report list error:', error);
    res.status(500).json({ error: 'Failed to load reports.' });
  }
});

app.put('/api/admin/reports/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { decision, hideAthlete } = req.body;
  const note = normaliseName(req.body.reason).slice(0, 500);
  if (!['resolve', 'dismiss'].includes(decision)) return res.status(400).json({ error: 'Decision must be "resolve" or "dismiss".' });
  if (decision === 'resolve' && !note) return res.status(400).json({ error: 'Add a note saying what was done.' });

  try {
    const flag = await Flag.findByPk(req.params.id);
    if (!flag) return res.status(404).json({ error: 'Report not found.' });
    if (flag.status !== 'Pending') return res.status(409).json({ error: `This report was already ${String(flag.status).toLowerCase()}.` });

    await sequelize.transaction(async (transaction) => {
      await flag.update({
        status: decision === 'resolve' ? 'Resolved' : 'Dismissed',
        resolutionNote: note || null,
        resolvedBy: req.user.id,
        resolvedAt: new Date()
      }, { transaction });
      if (decision === 'resolve' && hideAthlete === true) {
        await Player.update({ scoutHidden: true, scoutHiddenReason: note.slice(0, 255) }, { where: { id: flag.playerId }, transaction });
      }
    });

    try {
      const reporter = await User.findByPk(flag.reporterId, { attributes: ['email'] });
      await sendEmail(req, { to: reporter?.email, ...emails.reportOutcomeEmail({ decision }) });
    } catch (error) {
      console.error('Could not notify the reporter:', error.message);
    }

    res.status(200).json({ id: flag.id, status: flag.status });
  } catch (error) {
    console.error('Admin report decision error:', error);
    res.status(500).json({ error: 'Failed to record the decision.' });
  }
});

// Hide an athlete from scouts, or bring them back (for example after a report was investigated).
app.put('/api/admin/players/:id/scout-visibility', authenticateToken, requireAdmin, async (req, res) => {
  const hidden = req.body.hidden === true;
  const reason = normaliseName(req.body.reason).slice(0, 255);
  if (hidden && !reason) return res.status(400).json({ error: 'A reason is required to hide an athlete.' });

  try {
    const player = await Player.findByPk(req.params.id, { attributes: ['id'] });
    if (!player) return res.status(404).json({ error: 'Athlete not found.' });
    await Player.update({ scoutHidden: hidden, scoutHiddenReason: hidden ? reason : null }, { where: { id: player.id } });
    res.status(200).json({ id: player.id, scoutHidden: hidden });
  } catch (error) {
    console.error('Visibility update error:', error);
    res.status(500).json({ error: 'Failed to update visibility.' });
  }
});

// --- SCOUT-FACING PLAYER SEARCH ---
// Scouts get a minimised view (see lib/scouts.js): masked name, age instead of date of birth, no club contact until accepted.
const SCOUT_PAGE_MAX = 20;
const SCOUT_SORTS = {
  name: [['name', 'ASC'], ['id', 'ASC']],
  youngest: [['dateOfBirth', 'DESC'], ['name', 'ASC'], ['id', 'ASC']],
  oldest: [['dateOfBirth', 'ASC'], ['name', 'ASC'], ['id', 'ASC']]
};
const SCOUT_PLAYER_ATTRIBUTES = ['id', 'name', 'dateOfBirth', 'position', 'profilePhoto', 'currentClubId', 'consentStatus', 'consentGraceUntil', 'scoutHidden'];
const SCOUT_EVALUATION_ATTRIBUTES = ['id', 'createdAt', 'evalType', 'sprintSpeed', 'dribblingScore', 'overallRating', 'checklistData'];
const SCOUT_CLUB_ATTRIBUTES = ['id', 'name', 'isVerified', 'standingStatus', 'trustScore', 'contactEmail', 'contactPhone'];

/** The newest contact request this scout made for each of the given athletes. */
async function latestRequestsFor(scoutId, playerIds) {
  const latest = new Map();
  if (playerIds.length === 0) return latest;
  const requests = await ContactRequest.findAll({
    where: { scoutId, playerId: { [Op.in]: playerIds } },
    order: [['createdAt', 'DESC']]
  });
  for (const request of requests) if (!latest.has(request.playerId)) latest.set(request.playerId, request);
  return latest;
}

/** Signed photo links for a batch of rows (stored photo value -> link). */
const signedPhotos = (req, rows) => req.app.locals.photos.sign(rows.map((row) => row.profilePhoto));

app.get('/api/players', authenticateToken, requireApprovedScout, limitScoutSearches, async (req, res) => {
  const { evalType, position } = req.query;
  const page = Math.max(1, toInt(req.query.page, { min: 1 }) || 1);
  const limit = Math.min(SCOUT_PAGE_MAX, toInt(req.query.limit, { min: 1 }) || 10);
  const offset = (page - 1) * limit;
  const now = new Date();

  try {
    const playerWhere = {};
    const conditions = [scouts.visibleToScoutsWhere(now)]; // only athletes with consent on record (or still in the grace period)

    const search = normaliseName(req.query.search);
    if (search) playerWhere.name = { [Op.iLike]: `%${escapeLike(search)}%` };
    if (position) playerWhere.position = position; // exact match, kept for older app versions

    // `positions` keeps only those positions (e.g. a whole category); `excludePositions` is the "Other" bucket.
    const included = csv(req.query.positions);
    const excluded = csv(req.query.excludePositions);
    if (included.length) playerWhere.position = { [Op.in]: included };
    else if (excluded.length) playerWhere.position = { [Op.notIn]: excluded };

    // `under=15` keeps athletes younger than 15 today.
    const under = toInt(req.query.under, { min: 8, max: 25 });
    if (under) conditions.push({ dateOfBirth: { [Op.gt]: scouts.dobCutoffForUnder(under, now) } });
    // `minAge=15` keeps athletes who are at least 15 today (born on or before the same date 15 years ago); with `under` it makes an age band.
    const minAge = toInt(req.query.minAge, { min: 6, max: 25 });
    if (minAge) conditions.push({ dateOfBirth: { [Op.lte]: scouts.dobCutoffForUnder(minAge, now) } });
    playerWhere[Op.and] = conditions;

    const evaluationInclude = { model: Evaluation, attributes: SCOUT_EVALUATION_ATTRIBUTES };
    if (evalType) evaluationInclude.where = { evalType };

    // `verifiedOnly=true` keeps only athletes whose club has passed admin review.
    const clubInclude = { model: Club, attributes: SCOUT_CLUB_ATTRIBUTES };
    if (req.query.verifiedOnly === 'true') {
      clubInclude.where = { isVerified: true };
      clubInclude.required = true;
    }

    const { count, rows } = await Player.findAndCountAll({
      where: playerWhere, limit, offset, distinct: true,
      attributes: SCOUT_PLAYER_ATTRIBUTES,
      order: SCOUT_SORTS[req.query.sort] || SCOUT_SORTS.name, // always ends with the id, so pages never repeat or skip athletes
      include: [
        evaluationInclude,
        { model: MatchStat, attributes: ['id', 'competition', 'opponent', 'matchResult', 'matchDate', 'goals', 'assists', 'minutesPlayed'] },
        { model: Achievement, attributes: ['id', 'title', 'year'] },
        clubInclude
      ]
    });

    const requests = await latestRequestsFor(req.user.id, rows.map((row) => row.id));
    const photoUrls = await signedPhotos(req, rows);
    await logScoutAccess(req.user.id, 'players', rows.map((row) => row.id));

    res.status(200).json({
      totalItems: count,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      players: rows.map((row) => scouts.toScoutAthlete(row, { now, request: requests.get(row.id), photoUrl: photoUrls.get(row.profilePhoto) }))
    });
  } catch (error) {
    console.error('Player search error:', error);
    res.status(500).json({ error: 'Failed to fetch players.' });
  }
});

async function scoutAthleteDetail(req, res) {
  const now = new Date();
  try {
    const player = await Player.findByPk(req.params.id, {
      attributes: SCOUT_PLAYER_ATTRIBUTES,
      include: [
        { model: Evaluation, attributes: SCOUT_EVALUATION_ATTRIBUTES },
        { model: MatchStat, attributes: ['id', 'competition', 'opponent', 'matchResult', 'matchDate', 'goals', 'assists', 'minutesPlayed'] },
        { model: Achievement, attributes: ['id', 'title', 'year'] },
        { model: Club, attributes: SCOUT_CLUB_ATTRIBUTES }
      ]
    });
    if (!player || !scouts.isVisibleToScouts(player, now)) return res.status(404).json({ error: 'Player not found.' });

    const requests = await latestRequestsFor(req.user.id, [player.id]);
    const photoUrls = await signedPhotos(req, [player]);
    const shortlisted = await Shortlist.findOne({ where: { scoutId: req.user.id, playerId: player.id } });
    await logScoutAccess(req.user.id, 'player-detail', [player.id]);
    res.status(200).json({
      ...scouts.toScoutAthlete(player, { now, request: requests.get(player.id), photoUrl: photoUrls.get(player.profilePhoto) }),
      shortlistId: shortlisted?.id || null
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch player details.' });
  }
}

async function coachAthleteDetail(req, res) {
  try {
    const player = await Player.findByPk(req.params.id, {
      include: [
        { model: Evaluation },
        { model: MatchStat },
        { model: Achievement },
        { model: Club, attributes: ['name', 'region', 'contactEmail', 'contactPhone', 'standingStatus', 'trustScore'] }
      ],
      order: [[Evaluation, 'createdAt', 'ASC'], [MatchStat, 'matchDate', 'DESC']]
    });
    // Coaches only see their own club's athletes (404, not 403, so other ids are not confirmed to exist).
    const allowed = player && req.user.role === 'Coach' && membershipOf(req.user) === 'Active' && player.currentClubId === req.user.clubId;
    if (!allowed) return res.status(404).json({ error: 'Player not found.' });
    const photoUrls = await signedPhotos(req, [player]);
    res.status(200).json({ ...(typeof player.toJSON === 'function' ? player.toJSON() : player), photoUrl: photoUrls.get(player.profilePhoto) || null });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch player details.' });
  }
}

app.get('/api/players/:id', authenticateToken, (req, res) => {
  if (req.user.role === 'Scout') return requireApprovedScout(req, res, () => scoutAthleteDetail(req, res));
  return coachAthleteDetail(req, res);
});

// The signed-in account's own details (for profile screens).
app.get('/api/me', authenticateToken, async (req, res) => {
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

// --- SHORTLIST (scouts) ---
app.post('/api/shortlist', authenticateToken, requireApprovedScout, async (req, res) => {
  const { playerId } = req.body;
  const notes = String(req.body.notes ?? '').trim().slice(0, 500);
  const scoutId = req.user.id;
  try {
    const player = playerId ? await Player.findByPk(playerId, { attributes: ['id', 'consentStatus', 'consentGraceUntil'] }) : null;
    if (!player || !scouts.isVisibleToScouts(player)) return res.status(404).json({ error: 'That athlete is not available.' });

    const existing = await Shortlist.findOne({ where: { scoutId, playerId } });
    if (existing) return res.status(400).json({ error: 'Athlete is already in your shortlist.' });
    const entry = await Shortlist.create({ scoutId, playerId, notes: notes || null });
    res.status(201).json({ message: 'Added to shortlist!', entry });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add to shortlist.' });
  }
});

app.get('/api/shortlist', authenticateToken, requireApprovedScout, async (req, res) => {
  const scoutId = req.user.id;
  const now = new Date();
  try {
    const entries = await Shortlist.findAll({
      where: { scoutId },
      include: [{
        model: Player,
        attributes: SCOUT_PLAYER_ATTRIBUTES,
        include: [
          { model: Evaluation, attributes: SCOUT_EVALUATION_ATTRIBUTES },
          { model: Club, attributes: SCOUT_CLUB_ATTRIBUTES }
        ]
      }],
      order: [['createdAt', 'DESC']]
    });

    const plainEntries = entries.map((entry) => (typeof entry.toJSON === 'function' ? entry.toJSON() : { ...entry }));
    const requests = await latestRequestsFor(scoutId, plainEntries.map((e) => e.Player?.id).filter(Boolean));
    const photoUrls = await signedPhotos(req, plainEntries.map((e) => e.Player).filter(Boolean));

    res.status(200).json(plainEntries.map((entry) => {
      const visible = entry.Player && scouts.isVisibleToScouts(entry.Player, now);
      return {
        id: entry.id,
        notes: entry.notes || null,
        createdAt: entry.createdAt,
        // An athlete whose consent lapsed (or who was removed) stays in the list, but only as a placeholder.
        unavailable: !visible,
        Player: visible ? scouts.toScoutAthlete(entry.Player, { now, request: requests.get(entry.Player.id), photoUrl: photoUrls.get(entry.Player.profilePhoto) }) : null
      };
    }));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch shortlist.' });
  }
});

// Edit the private note on a shortlist entry.
app.patch('/api/shortlist/:id', authenticateToken, requireRole('Scout'), async (req, res) => {
  const notes = String(req.body.notes ?? '').trim().slice(0, 500);
  try {
    const [updated] = await Shortlist.update({ notes: notes || null }, { where: { id: req.params.id, scoutId: req.user.id } });
    if (updated) res.status(200).json({ id: req.params.id, notes: notes || null });
    else res.status(404).json({ error: 'Shortlist entry not found.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update the note.' });
  }
});

app.delete('/api/shortlist/:id', authenticateToken, requireRole('Scout'), async (req, res) => {
  try {
    const deleted = await Shortlist.destroy({ where: { id: req.params.id, scoutId: req.user.id } });
    if (deleted) res.status(200).json({ message: 'Removed from shortlist.' });
    else res.status(404).json({ error: 'Shortlist entry not found.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove from shortlist.' });
  }
});

// --- COACH: CLUB ---
app.get('/api/club', authenticateToken, requireRole('Coach'), async (req, res) => {
  try {
    const club = req.user.clubId ? await Club.findByPk(req.user.clubId, { attributes: { exclude: ['verifiedBy'] } }) : null;
    if (!club) return res.status(404).json({ error: 'Club not found.' });

    const status = membershipOf(req.user);
    if (status !== 'Active') {
      // Pending/declined coaches see only the basics, plus their status so the app can explain it.
      return res.status(200).json({
        club: { id: club.id, name: club.name, region: club.region, entityType: club.entityType },
        playerCount: 0,
        coachProfile: req.user,
        membershipStatus: status
      });
    }

    const playerCount = await Player.count({ where: { currentClubId: req.user.clubId } });
    res.status(200).json({ club, playerCount, coachProfile: req.user, membershipStatus: status });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch club information.' });
  }
});

// Update the club's details (owner only; verification/trust stay admin-controlled).
app.put('/api/club', authenticateToken, ...requireClubOwner, async (req, res) => {
  const { name, region, contactEmail, contactPhone, entityType } = req.body;
  const updates = {};

  if (name !== undefined) {
    if (!normaliseName(name)) return res.status(400).json({ error: 'Club name cannot be empty.' });
    updates.name = normaliseName(name);
  }
  if (entityType !== undefined) {
    if (!ENTITY_TYPES.includes(entityType)) return res.status(400).json({ error: 'Invalid entity classification.' });
    updates.entityType = entityType;
  }
  for (const [key, val] of Object.entries({ region, contactEmail, contactPhone })) {
    if (val !== undefined) updates[key] = normaliseName(val) || null;
  }
  if (updates.contactEmail && !isValidEmail(updates.contactEmail)) {
    return res.status(400).json({ error: 'Please enter a valid contact email.' });
  }

  try {
    const club = await Club.findByPk(req.user.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found.' });
    if (updates.name) {
      const clash = await Club.findOne({ where: { [Op.and]: [byLowerName(updates.name), { id: { [Op.ne]: club.id } }] } });
      if (clash) return res.status(409).json({ error: 'Another club already uses that name.' });
    }

    // A verified club that changes its name or classification is no longer the entity the admin reviewed.
    const identityChanged = Boolean(
      (updates.name && updates.name !== club.name) || (updates.entityType && updates.entityType !== club.entityType)
    );
    const verificationReset = identityChanged && verificationStatusOf(club) === 'Verified';
    if (verificationReset) {
      Object.assign(updates, { isVerified: false, verificationStatus: 'Unverified', verifiedAt: null, verifiedBy: null });
    }

    await club.update(updates);
    if (verificationReset) {
      await VerificationEvent.create({ clubId: club.id, actorId: req.user.id, action: 'Reset', note: 'Club name or classification changed after verification.' });
    }
    res.status(200).json({ club, verificationReset });
  } catch (error) {
    console.error('Club update error:', error);
    res.status(500).json({ error: 'Failed to update club information.' });
  }
});

// Update the signed-in user's own display name and phone.
app.put('/api/profile', authenticateToken, async (req, res) => {
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

// --- COACH: MEMBERSHIP APPROVALS (club owner) ---
app.get('/api/club/members', authenticateToken, ...requireClubOwner, async (req, res) => {
  try {
    const members = await User.findAll({
      where: { clubId: req.user.clubId, role: 'Coach' },
      attributes: ['id', 'username', 'email', 'phone', 'clubRole', 'membershipStatus', 'createdAt'],
      order: [['createdAt', 'ASC']]
    });
    res.status(200).json(members);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch club members.' });
  }
});

app.put('/api/club/members/:userId', authenticateToken, ...requireClubOwner, async (req, res) => {
  const { action } = req.body;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Action must be "approve" or "reject".' });

  try {
    const target = await User.findOne({ where: { id: req.params.userId, clubId: req.user.clubId, role: 'Coach' } });
    if (!target) return res.status(404).json({ error: 'Member not found in your club.' });
    if (clubRoleOf(target) === 'Owner') return res.status(400).json({ error: 'Club owners cannot be changed.' });

    await target.update({ membershipStatus: action === 'approve' ? 'Active' : 'Rejected' });
    res.status(200).json({ member: { id: target.id, username: target.username, membershipStatus: target.membershipStatus } });
  } catch (error) {
    console.error('Member update error:', error);
    res.status(500).json({ error: 'Failed to update member.' });
  }
});

// --- COACH: ROSTER ---
// Paginated list with the stats the roster cards need (search by name, filter by position).
app.get('/api/club/players', authenticateToken, requireActiveCoach, async (req, res) => {
  const page = Math.max(1, toInt(req.query.page, { min: 1 }) || 1);
  const limit = Math.min(50, toInt(req.query.limit, { min: 1 }) || 20);
  const search = normaliseName(req.query.search);

  try {
    const where = { currentClubId: req.user.clubId };
    if (search) where.name = { [Op.iLike]: `%${escapeLike(search)}%` };
    // `positions` is a comma-separated list, so the app can filter by a whole category (e.g. all defenders).
    const positions = csv(req.query.positions);
    if (positions.length) where.position = { [Op.in]: positions };

    const { count, rows } = await Player.findAndCountAll({
      where, limit, offset: (page - 1) * limit, distinct: true, order: [['name', 'ASC']],
      include: [
        { model: MatchStat, attributes: ['id', 'goals', 'assists'] },
        { model: Achievement, attributes: ['id'] }
      ]
    });
    // Athletes without a recorded guardian consent (whole club, not just this page): hidden from scouts once any grace period ends.
    const needsConsent = await Player.count({
      where: { currentClubId: req.user.clubId, [Op.or]: [{ consentStatus: null }, { consentStatus: { [Op.ne]: 'Recorded' } }] }
    });

    res.status(200).json({ players: rows, totalItems: count, totalPages: Math.ceil(count / limit), currentPage: page, needsConsent });
  } catch (error) {
    console.error('Roster error:', error);
    res.status(500).json({ error: 'Failed to fetch club roster.' });
  }
});

// Whole roster, minimal fields: for pickers and pre-filling the evaluation form.
app.get('/api/club/roster', authenticateToken, requireActiveCoach, async (req, res) => {
  try {
    const players = await Player.findAll({
      where: { currentClubId: req.user.clubId },
      attributes: ['id', 'name', 'dateOfBirth', 'position'],
      order: [['name', 'ASC']]
    });
    res.status(200).json(players);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch club roster.' });
  }
});

app.put('/api/club/players/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  const { name, dateOfBirth, position, consent, guardianName } = req.body;
  const updates = {};

  if (name !== undefined) {
    if (!normaliseName(name)) return res.status(400).json({ error: 'Athlete name cannot be empty.' });
    updates.name = normaliseName(name);
  }
  if (dateOfBirth !== undefined) {
    if (!isValidDob(dateOfBirth)) return res.status(400).json({ error: 'Date of birth must be a valid date (YYYY-MM-DD).' });
    updates.dateOfBirth = dateOfBirth;
  }
  if (position !== undefined) {
    if (!normaliseName(position)) return res.status(400).json({ error: 'Position cannot be empty.' });
    updates.position = normaliseName(position);
  }
  if (consent !== undefined) {
    if (consent === true || consent === 'true') {
      const guardian = normaliseName(guardianName);
      if (!guardian) return res.status(400).json({ error: "Enter the parent or guardian's name to record consent." });
      Object.assign(updates, {
        consentStatus: 'Recorded', consentGuardian: guardian.slice(0, 120), consentRecordedAt: new Date(),
        consentRecordedBy: req.user.id, consentGraceUntil: null
      });
    } else {
      // Withdrawing consent hides the athlete from scouts straight away (the grace period is cleared too).
      Object.assign(updates, {
        consentStatus: 'Missing', consentGuardian: null, consentRecordedAt: null, consentRecordedBy: null, consentGraceUntil: null
      });
    }
  }

  try {
    const player = await Player.findOne({ where: { id: req.params.id, currentClubId: req.user.clubId } });
    if (!player) return res.status(404).json({ error: 'Athlete not found in your roster.' });

    const nextName = updates.name ?? player.name;
    const nextDob = updates.dateOfBirth ?? player.dateOfBirth;
    const clash = await Player.findOne({
      where: { [Op.and]: [byLowerName(nextName), { dateOfBirth: nextDob, currentClubId: req.user.clubId, id: { [Op.ne]: player.id } }] }
    });
    if (clash) return res.status(409).json({ error: 'An athlete with that name and date of birth is already on your roster.' });

    await player.update(updates);
    res.status(200).json({ player });
  } catch (error) {
    console.error('Athlete update error:', error);
    res.status(500).json({ error: 'Failed to update athlete.' });
  }
});

app.delete('/api/club/players/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const player = await Player.findOne({ where: { id: req.params.id, currentClubId: req.user.clubId }, transaction });
    if (!player) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Athlete not found in your roster.' });
    }
    const where = { playerId: player.id };
    await Promise.all([
      Evaluation.destroy({ where, transaction }),
      MatchStat.destroy({ where, transaction }),
      Achievement.destroy({ where, transaction }),
      Shortlist.destroy({ where, transaction }),
      Flag.destroy({ where, transaction }),
      ContactRequest.destroy({ where, transaction })
    ]);
    await player.destroy({ transaction });
    await transaction.commit();
    res.status(200).json({ message: 'Athlete removed from roster.' });
  } catch (error) {
    await transaction.rollback();
    console.error('Athlete delete error:', error);
    res.status(500).json({ error: 'Failed to remove athlete.' });
  }
});

// --- COACH: EVALUATIONS / MATCH STATS / ACHIEVEMENTS ---
// A record is only reachable if its athlete belongs to the coach's own club.
const findOwnedRecord = (Model, req) =>
  Model.findOne({
    where: { id: req.params.id },
    include: [{ model: Player, attributes: ['id'], where: { currentClubId: req.user.clubId }, required: true }]
  });

// Evaluations are cryptographically signed at sync time, so they can be removed but never edited.
app.delete('/api/club/evaluations/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  try {
    const record = await findOwnedRecord(Evaluation, req);
    if (!record) return res.status(404).json({ error: 'Evaluation not found in your roster.' });
    await record.destroy();
    res.status(200).json({ message: 'Evaluation removed.' });
  } catch (error) {
    console.error('Evaluation delete error:', error);
    res.status(500).json({ error: 'Failed to remove evaluation.' });
  }
});

app.put('/api/club/match-stats/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  const { competition, opponent, matchResult, matchDate, goals, assists, minutesPlayed } = req.body;
  const updates = {};

  if (competition !== undefined) {
    if (!normaliseName(competition)) return res.status(400).json({ error: 'Competition cannot be empty.' });
    updates.competition = normaliseName(competition);
  }
  if (opponent !== undefined) updates.opponent = normaliseName(opponent) || null;
  if (matchResult !== undefined) updates.matchResult = normaliseName(matchResult) || null;
  if (matchDate !== undefined) {
    if (!isValidDob(matchDate)) return res.status(400).json({ error: 'Match date must be a valid date (YYYY-MM-DD).' });
    updates.matchDate = matchDate;
  }
  for (const [key, val, max] of [['goals', goals, 99], ['assists', assists, 99], ['minutesPlayed', minutesPlayed, 150]]) {
    if (val === undefined) continue;
    const n = toInt(val, { max });
    if (n === null) return res.status(400).json({ error: `${key} must be a whole number between 0 and ${max}.` });
    updates[key] = n;
  }

  try {
    const record = await findOwnedRecord(MatchStat, req);
    if (!record) return res.status(404).json({ error: 'Match record not found in your roster.' });
    await record.update(updates);
    res.status(200).json({ matchStat: record });
  } catch (error) {
    console.error('Match stat update error:', error);
    res.status(500).json({ error: 'Failed to update match record.' });
  }
});

app.delete('/api/club/match-stats/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  try {
    const record = await findOwnedRecord(MatchStat, req);
    if (!record) return res.status(404).json({ error: 'Match record not found in your roster.' });
    await record.destroy();
    res.status(200).json({ message: 'Match record removed.' });
  } catch (error) {
    console.error('Match stat delete error:', error);
    res.status(500).json({ error: 'Failed to remove match record.' });
  }
});

app.put('/api/club/achievements/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  const { title, year } = req.body;
  const updates = {};

  if (title !== undefined) {
    if (!normaliseName(title)) return res.status(400).json({ error: 'Title cannot be empty.' });
    updates.title = normaliseName(title).slice(0, 255);
  }
  if (year !== undefined) {
    const n = toInt(year, { min: 1900, max: new Date().getFullYear() + 1 });
    if (n === null) return res.status(400).json({ error: 'Year must be a valid year.' });
    updates.year = n;
  }

  try {
    const record = await findOwnedRecord(Achievement, req);
    if (!record) return res.status(404).json({ error: 'Achievement not found in your roster.' });
    await record.update(updates);
    res.status(200).json({ achievement: record });
  } catch (error) {
    console.error('Achievement update error:', error);
    res.status(500).json({ error: 'Failed to update achievement.' });
  }
});

app.delete('/api/club/achievements/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  try {
    const record = await findOwnedRecord(Achievement, req);
    if (!record) return res.status(404).json({ error: 'Achievement not found in your roster.' });
    await record.destroy();
    res.status(200).json({ message: 'Achievement removed.' });
  } catch (error) {
    console.error('Achievement delete error:', error);
    res.status(500).json({ error: 'Failed to remove achievement.' });
  }
});

// --- VERIFICATION: club owner side ---
app.get('/api/club/verification', authenticateToken, requireActiveCoach, async (req, res) => {
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

app.post('/api/club/verification', authenticateToken, ...requireClubOwner, async (req, res) => {
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
app.get('/api/admin/verifications', authenticateToken, requireAdmin, async (req, res) => {
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

app.put('/api/admin/verifications/:clubId', authenticateToken, requireAdmin, async (req, res) => {
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

// --- SCOUT ACCREDITATION: scout side ---
app.get('/api/scout/accreditation', authenticateToken, requireRole('Scout'), async (req, res) => {
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

app.post('/api/scout/accreditation', authenticateToken, requireRole('Scout'), async (req, res) => {
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
app.get('/api/admin/scouts', authenticateToken, requireAdmin, async (req, res) => {
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

app.put('/api/admin/scouts/:userId', authenticateToken, requireAdmin, async (req, res) => {
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

// --- CONTACT REQUESTS: scout side ---
// A scout never gets a club's phone or email directly: they ask, and the club owner decides.
const DAILY_CONTACT_REQUEST_LIMIT = 10;

app.post('/api/contact-requests', authenticateToken, requireApprovedScout, async (req, res) => {
  const message = String(req.body.message ?? '').trim();
  if (message.length < 10) return res.status(400).json({ error: 'Write a short message (at least 10 characters) so the club knows why you are asking.' });
  if (message.length > 500) return res.status(400).json({ error: 'Please keep the message under 500 characters.' });

  try {
    const player = req.body.playerId
      ? await Player.findByPk(req.body.playerId, { include: [{ model: Club, attributes: ['id', 'name'] }] })
      : null;
    if (!player || !scouts.isVisibleToScouts(player)) return res.status(404).json({ error: 'That athlete is not available.' });

    const open = await ContactRequest.findOne({ where: { scoutId: req.user.id, playerId: player.id, status: { [Op.in]: ['Pending', 'Accepted'] } } });
    if (open) {
      return res.status(409).json({
        error: open.status === 'Accepted' ? 'The club already accepted. Their details are in your Requests tab.' : 'You already have a request waiting for this athlete.'
      });
    }

    const lastDecline = await ContactRequest.findOne({
      where: { scoutId: req.user.id, playerId: player.id, status: 'Declined' },
      order: [['respondedAt', 'DESC']]
    });
    const cooldownEnds = scouts.contactCooldownEnds(lastDecline);
    if (cooldownEnds) {
      return res.status(429).json({
        error: `The club declined your last request. You can ask again on ${cooldownEnds.toISOString().slice(0, 10)}.`,
        code: 'COOLDOWN',
        canRequestAgainAt: cooldownEnds.toISOString()
      });
    }

    const recent = await ContactRequest.count({ where: { scoutId: req.user.id, createdAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
    if (recent >= DAILY_CONTACT_REQUEST_LIMIT) {
      return res.status(429).json({ error: `You can send up to ${DAILY_CONTACT_REQUEST_LIMIT} contact requests a day. Please try again tomorrow.`, code: 'RATE_LIMITED' });
    }

    const request = await ContactRequest.create({ scoutId: req.user.id, playerId: player.id, clubId: player.currentClubId, message });

    // Tell the club's owner(s); best effort.
    const owners = await User.findAll({ where: { clubId: player.currentClubId, role: 'Coach', clubRole: 'Owner' }, attributes: ['email', 'membershipStatus'] });
    await sendEmail(req, {
      to: owners.filter((o) => (o.membershipStatus || 'Active') === 'Active').map((o) => o.email),
      ...emails.contactRequestEmail({ club: player.Club || { name: 'your club' }, athleteName: player.name, scout: req.user, organisation: req.scoutProfile?.organisation, message })
    });

    res.status(201).json({ id: request.id, status: 'Pending' });
  } catch (error) {
    console.error('Contact request error:', error);
    res.status(500).json({ error: 'Failed to send your request.' });
  }
});

app.get('/api/contact-requests', authenticateToken, requireApprovedScout, async (req, res) => {
  try {
    const requests = await ContactRequest.findAll({
      where: { scoutId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit: 100,
      include: [
        { model: Player, attributes: ['id', 'name', 'position', 'dateOfBirth', 'profilePhoto'] },
        { model: Club, attributes: ['name', 'isVerified', 'contactEmail', 'contactPhone'] }
      ]
    });
    const now = new Date();
    const photoUrls = await signedPhotos(req, requests.map((r) => r.Player).filter(Boolean));

    res.status(200).json(requests.map((row) => {
      const request = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
      const accepted = request.status === 'Accepted';
      const player = request.Player;
      return {
        id: request.id,
        status: request.status,
        message: request.message,
        responseNote: request.status === 'Pending' ? null : request.responseNote || null,
        createdAt: request.createdAt,
        respondedAt: request.respondedAt || null,
        athlete: player
          ? {
              id: player.id,
              displayName: accepted ? normaliseName(player.name) : scouts.publicName(player.name),
              position: player.position,
              age: scouts.ageFromDob(player.dateOfBirth, now),
              profilePhoto: photoUrls.get(player.profilePhoto) || null
            }
          : null,
        club: request.Club
          ? {
              name: request.Club.name,
              isVerified: Boolean(request.Club.isVerified),
              ...(accepted ? { contactEmail: request.Club.contactEmail || null, contactPhone: request.Club.contactPhone || null } : {})
            }
          : null
      };
    }));
  } catch (error) {
    console.error('Contact request list error:', error);
    res.status(500).json({ error: 'Failed to load your requests.' });
  }
});

// --- CONTACT REQUESTS: club owner side ---
app.get('/api/club/contact-requests', authenticateToken, ...requireClubOwner, async (req, res) => {
  const status = ['Pending', 'Accepted', 'Declined'].includes(req.query.status) ? req.query.status : null;
  try {
    const requests = await ContactRequest.findAll({
      where: { clubId: req.user.clubId, ...(status ? { status } : {}) },
      order: [['createdAt', 'DESC']],
      limit: 100,
      include: [
        { model: Player, attributes: ['id', 'name', 'position'] },
        { model: User, as: 'Scout', attributes: ['id', 'username', 'email', 'phone'] }
      ]
    });

    const scoutIds = [...new Set(requests.map((r) => r.scoutId))];
    const profiles = scoutIds.length ? await ScoutProfile.findAll({ where: { userId: { [Op.in]: scoutIds } } }) : [];
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

    res.status(200).json(requests.map((row) => {
      const request = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
      const profile = profileByUser.get(request.scoutId);
      const accepted = request.status === 'Accepted';
      return {
        id: request.id,
        status: request.status,
        message: request.message,
        responseNote: request.responseNote || null,
        createdAt: request.createdAt,
        respondedAt: request.respondedAt || null,
        athlete: request.Player ? { id: request.Player.id, name: request.Player.name, position: request.Player.position } : null,
        scout: {
          username: request.Scout?.username || 'Unknown',
          organisation: profile?.organisation || null,
          orgType: profile?.orgType || null,
          // The scout's own contact details are shared with the club only once the club has accepted.
          ...(accepted ? { email: request.Scout?.email || null, phone: request.Scout?.phone || null } : {})
        }
      };
    }));
  } catch (error) {
    console.error('Club contact request list error:', error);
    res.status(500).json({ error: 'Failed to load scout requests.' });
  }
});

app.put('/api/club/contact-requests/:id', authenticateToken, ...requireClubOwner, async (req, res) => {
  const { decision } = req.body;
  const note = normaliseName(req.body.note).slice(0, 300);
  if (!['accept', 'decline'].includes(decision)) return res.status(400).json({ error: 'Decision must be "accept" or "decline".' });

  try {
    const request = await ContactRequest.findOne({ where: { id: req.params.id, clubId: req.user.clubId } });
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.status !== 'Pending') return res.status(409).json({ error: `This request was already ${String(request.status).toLowerCase()}.` });

    await request.update({
      status: decision === 'accept' ? 'Accepted' : 'Declined',
      responseNote: note || null,
      respondedBy: req.user.id,
      respondedAt: new Date()
    });

    try {
      const [scoutUser, player, club] = await Promise.all([
        User.findByPk(request.scoutId, { attributes: ['email'] }),
        Player.findByPk(request.playerId, { attributes: ['name'] }),
        Club.findByPk(request.clubId, { attributes: ['name'] })
      ]);
      await sendEmail(req, {
        to: scoutUser?.email,
        ...emails.contactResponseEmail({
          decision,
          athleteName: decision === 'accept' ? player?.name : scouts.publicName(player?.name),
          clubName: club?.name,
          note
        })
      });
    } catch (error) {
      console.error('Could not notify the scout:', error.message);
    }

    res.status(200).json({ id: request.id, status: request.status });
  } catch (error) {
    console.error('Contact request decision error:', error);
    res.status(500).json({ error: 'Failed to record your answer.' });
  }
});

// Malformed JSON bodies etc. should answer with JSON, not Express's HTML error page.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Unexpected server error.' });
});

// Only start listening when run directly, so tests can import the app without a database.
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  sequelize.sync({ alter: true }).then(async () => {
    console.log('PostgreSQL Database synced.');
    const pruneLog = async () => {
      try {
        const removed = await scouts.pruneAccessLog(ScoutAccessLog);
        if (removed) console.log(`Removed ${removed} scout access log row(s) older than ${scouts.ACCESS_LOG_RETENTION_DAYS} days.`);
      } catch (error) {
        console.error('Could not prune the scout access log:', error.message);
      }
    };
    await pruneLog();
    setInterval(pruneLog, 24 * 60 * 60 * 1000).unref();

    try {
      const covered = await scouts.backfillConsentGrace(Player);
      if (covered) console.log(`Consent grace period started for ${covered} existing athlete(s).`);
    } catch (error) {
      console.error('Could not start the consent grace period:', error.message);
    }
    app.listen(PORT, () => console.log(`ScoutConnect API running on port ${PORT}`));
  });
}

module.exports = app;
