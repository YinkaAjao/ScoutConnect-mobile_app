// middleware/auth.js
// Who is calling (Supabase token -> account) and what they may do (role, club membership, scout accreditation).
const { Op } = require('sequelize');
const { User, ScoutProfile, ScoutAccessLog } = require('../models');
const { membershipOf, clubRoleOf } = require('../lib/membership');
const { provisionUser } = require('../services/provisioning');
const { createTokenVerifier } = require('../lib/auth');
const { SUPABASE_URL } = require('../config/supabase');

const verifySupabaseToken = createTokenVerifier({
  supabaseUrl: SUPABASE_URL,
  jwtSecret: process.env.SUPABASE_JWT_SECRET
});

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

module.exports = {
  authenticateToken, requireRole, requireAdmin, requireActiveCoach, requireClubOwner, requireApprovedScout, limitScoutSearches
};
