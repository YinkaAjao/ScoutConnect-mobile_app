// Route-level tests. The Sequelize models are replaced with small in-memory stand-ins, so these check the
// server's own logic (auth, provisioning, membership gating, idempotent sync), not SQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');

process.env.SUPABASE_JWT_SECRET = 'test-secret';

const state = {};
const resetState = () => {
  Object.assign(state, {
    users: new Map(),
    clubs: new Map(),
    clubByName: null, // what Club.findOne (lookup by name) returns
    athletes: new Map(), // id -> athlete
    athleteByName: null, // what a name + dob lookup returns
    clientIds: { evaluations: new Set(), matchStats: new Set(), achievements: new Set() },
    created: { evaluations: [], matchStats: [], achievements: [] },
    athleteCount: 0,
    owner: null,
    owners: [], // coach owners returned by User.findAll (for notification emails)
    playerRows: [], // rows returned by Player.findAndCountAll
    shortlistRows: [],
    docs: [],
    events: [],
    scoutProfiles: new Map(), // userId -> ScoutProfile
    contactRequests: [],
    accessLogs: [],
    flags: [],
  });
};
resetState();

// Minimal stand-in for Sequelize `where`: equality, Op.in and Op.gte are all the routes use.
const matches = (row, where = {}) =>
  Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if (cond[Op.in]) return cond[Op.in].includes(value);
      if (cond[Op.gte]) return new Date(value) >= cond[Op.gte];
      return false;
    }
    return value === cond;
  });

const record = (values) => ({
  ...values,
  update: async function (updates) { Object.assign(this, updates); return this; },
});

const fakeModels = () => {
  const withClientIds = (key) => ({
    findOne: async ({ where }) => (state.clientIds[key].has(where.clientId) ? { id: 'existing' } : null),
    create: async (values) => {
      if (values.clientId) state.clientIds[key].add(values.clientId);
      state.created[key].push(values);
      return values;
    },
  });
  return {
    sequelize: { transaction: async (work) => (work ? work({}) : { commit: async () => {}, rollback: async () => {} }) },
    User: {
      findAll: async () => state.owners,
      findOne: async () => state.owner,
      findByPk: async (id) => state.users.get(id) || null,
      findOrCreate: async ({ where, defaults }) => {
        const existing = state.users.get(where.id);
        if (existing) return [existing, false];
        const user = record({ ...defaults, id: where.id });
        state.users.set(user.id, user);
        return [user, true];
      },
    },
    Club: {
      findAll: async ({ where }) =>
        [...state.clubs.values()].filter((c) => (where.id ? matches(c, { id: where.id }) : where.isVerified ? c.isVerified === true : !c.isVerified && c.verificationStatus === where.verificationStatus)),
      findByPk: async (id) => state.clubs.get(id) || null,
      findOne: async () => state.clubByName,
      create: async (values) => {
        const club = record({ id: `club-${state.clubs.size + 1}`, ...values });
        state.clubs.set(club.id, club);
        return club;
      },
    },
    Player: {
      findAll: async () => [],
      findAndCountAll: async (options) => { state.lastPlayerQuery = options; return { count: state.playerRows.length, rows: state.playerRows }; },
      count: async () => state.athleteCount,
      findByPk: async (id) => state.athletes.get(id) || null,
      update: async (values, { where }) => { const athlete = state.athletes.get(where.id); if (athlete) Object.assign(athlete, values); return [athlete ? 1 : 0]; },
      findOne: async ({ where }) => {
        if (where.id) {
          const athlete = state.athletes.get(where.id);
          return athlete && athlete.currentClubId === where.currentClubId ? athlete : null;
        }
        return state.athleteByName;
      },
      create: async (values) => { state.lastCreatedPlayer = values; return record({ id: 'new-athlete', updatedAt: new Date(0), ...values }); },
    },
    Evaluation: withClientIds('evaluations'),
    MatchStat: withClientIds('matchStats'),
    Achievement: withClientIds('achievements'),
    Shortlist: {
      findAll: async () => state.shortlistRows,
      findOne: async ({ where }) => state.shortlistRows.find((e) => e.scoutId === where.scoutId && e.playerId === where.playerId) || null,
      create: async (values) => { const entry = { id: 'sl-' + (state.shortlistRows.length + 1), ...values }; state.shortlistRows.push(entry); return entry; },
      destroy: async () => 1,
      update: async (values, { where }) => {
        const row = state.shortlistRows.find((e) => e.id === where.id && e.scoutId === where.scoutId);
        if (row) Object.assign(row, values);
        return [row ? 1 : 0];
      },
    },
    ScoutProfile: {
      findOne: async ({ where }) => state.scoutProfiles.get(where.userId) || null,
      findAll: async ({ where }) => [...state.scoutProfiles.values()].filter((p) => matches(p, where)),
      create: async (values) => { const profile = record({ id: 'sp-' + (state.scoutProfiles.size + 1), ...values }); state.scoutProfiles.set(profile.userId, profile); return profile; },
    },
    ContactRequest: {
      findAll: async ({ where }) => state.contactRequests.filter((r) => matches(r, where)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      findOne: async ({ where }) => state.contactRequests.find((r) => matches(r, where)) || null,
      count: async ({ where }) => state.contactRequests.filter((r) => matches(r, where)).length,
      create: async (values) => { const request = record({ id: 'cr-' + (state.contactRequests.length + 1), status: 'Pending', createdAt: new Date(), ...values }); state.contactRequests.push(request); return request; },
      destroy: async () => 0,
    },
    ScoutAccessLog: {
      create: async (values) => { state.accessLogs.push(values); return values; },
      count: async ({ where }) => state.accessLogs.filter((row) => matches(row, where)).length,
    },
    Flag: {
      findOne: async ({ where }) => state.flags.find((f) => matches(f, where)) || null,
      findAll: async ({ where }) => state.flags.filter((f) => matches(f, where)),
      findByPk: async (id) => state.flags.find((f) => f.id === id) || null,
      create: async (values) => { const flag = record({ id: 'f-' + (state.flags.length + 1), status: 'Pending', createdAt: new Date(), ...values }); state.flags.push(flag); return flag; },
    },
    VerificationDocument: {
      findAll: async ({ where }) => state.docs.filter((d) => (where.scoutUserId !== undefined ? d.scoutUserId === where.scoutUserId : d.clubId === where.clubId)),
      destroy: async ({ where }) => { state.docs = state.docs.filter((d) => !(where.scoutUserId !== undefined ? d.scoutUserId === where.scoutUserId : d.clubId === where.clubId)); },
      create: async (values) => { const d = { id: `doc-${state.docs.length + 1}`, ...values }; state.docs.push(d); return d; },
    },
    VerificationEvent: {
      findAll: async ({ where }) => state.events.filter((e) => e.clubId === where.clubId).reverse(),
      create: async (values) => { state.events.push(values); return values; },
    },
  };
};

const modelsPath = require.resolve('../models');
require.cache[modelsPath] = { id: modelsPath, filename: modelsPath, loaded: true, exports: fakeModels() };
const app = require('../server');

let server;
let base;
test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());
test.beforeEach(resetState);

const token = (sub, metadata = {}, email = `${sub}@example.com`) =>
  jwt.sign({ sub, email, aud: 'authenticated', user_metadata: metadata }, 'test-secret', { algorithm: 'HS256' });

const call = async (method, path, { as, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${as}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const addActiveCoach = (id = 'coach-1', clubId = 'club-1') => {
  state.clubs.set(clubId, record({ id: clubId, name: 'Test FC' }));
  state.users.set(id, record({ id, role: 'Coach', clubId, clubRole: 'Owner', membershipStatus: 'Active' }));
  return token(id);
};

test('health check needs no authentication', async () => {
  assert.equal((await call('GET', '/api/health')).status, 200);
});

test('requests without a valid token are rejected', async () => {
  assert.equal((await call('GET', '/api/club/roster')).status, 401);
  assert.equal((await call('GET', '/api/club/roster', { as: 'garbage' })).status, 403);
  const forged = jwt.sign({ sub: 'x', email: 'x@y.co' }, 'wrong-secret', { algorithm: 'HS256' });
  assert.equal((await call('GET', '/api/club/roster', { as: forged })).status, 403);
});

test('the old unauthenticated sync-profile endpoint is gone', async () => {
  const res = await call('POST', '/api/auth/sync-profile', { body: { id: 'x', role: 'Coach', clubId: 'club-1' } });
  assert.equal(res.status, 404);
});

test('first sign-in creates a scout profile from the token, and scouts cannot use coach routes', async () => {
  const res = await call('GET', '/api/club/roster', { as: token('scout-1', { username: 'Aline', role: 'Scout' }) });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'WRONG_ROLE');
  assert.equal(state.users.get('scout-1').role, 'Scout');
});

test('a coach joining an existing club is Pending and locked out of its data', async () => {
  state.clubs.set('club-9', record({ id: 'club-9', name: 'Existing FC' }));
  const as = token('coach-2', { username: 'Eric', role: 'Coach', clubId: 'club-9' });
  const res = await call('GET', '/api/club/roster', { as });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MEMBERSHIP_PENDING');
  const user = state.users.get('coach-2');
  assert.equal(user.clubId, 'club-9');
  assert.equal(user.clubRole, 'Member');
  assert.equal(user.membershipStatus, 'Pending');
});

test('a coach registering a brand-new club becomes its active owner', async () => {
  const as = token('coach-3', { username: 'Eric', role: 'Coach', newClubName: 'Rwanda Stars', newClubEntityType: 'Registered Club' });
  const res = await call('GET', '/api/club/roster', { as });
  assert.equal(res.status, 200);
  const user = state.users.get('coach-3');
  assert.equal(user.clubRole, 'Owner');
  assert.equal(user.membershipStatus, 'Active');
  assert.equal(state.clubs.size, 1);
});

test('registering a club name that already exists is a join request, never a takeover', async () => {
  const existing = record({ id: 'club-7', name: 'Rwanda Stars' });
  state.clubs.set('club-7', existing);
  state.clubByName = existing;
  const as = token('coach-4', { username: 'Eric', role: 'Coach', newClubName: 'rwanda  stars', newClubEntityType: 'Registered Club' });
  const res = await call('GET', '/api/club/roster', { as });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MEMBERSHIP_PENDING');
  assert.equal(state.users.get('coach-4').clubId, 'club-7');
  assert.equal(state.clubs.size, 1);
});

test('an account without registration answers gets a clear error', async () => {
  const res = await call('GET', '/api/club/roster', { as: token('ghost', {}) });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'PROFILE_INCOMPLETE');
  assert.equal(state.users.size, 0);
});

test('only the club owner can edit club details or manage members', async () => {
  state.clubs.set('club-1', record({ id: 'club-1', name: 'Test FC' }));
  state.users.set('member-1', record({ id: 'member-1', role: 'Coach', clubId: 'club-1', clubRole: 'Member', membershipStatus: 'Active' }));
  const as = token('member-1');
  assert.equal((await call('PUT', '/api/club', { as, body: { name: 'Hijacked' } })).body.code, 'NOT_OWNER');
  assert.equal((await call('GET', '/api/club/members', { as })).body.code, 'NOT_OWNER');
});

test('sync is idempotent: a record the server already has is confirmed, not stored twice', async () => {
  const as = addActiveCoach();
  state.clientIds.evaluations.add('dup');
  const res = await call('POST', '/api/sync', {
    as,
    body: {
      records: [
        { id: 1, clientId: 'fresh', playerName: ' Jean   Paul ', dateOfBirth: '2008-05-01', sprintSpeed: 4, dribblingScore: 3, timestamp: '2026-01-01T00:00:00Z' },
        { id: 2, clientId: 'dup', playerName: 'Jean Paul', dateOfBirth: '2008-05-01' },
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.syncedIds.records, [1, 2]);
  assert.equal(res.body.summary.created, 1);
  assert.equal(res.body.summary.duplicates, 1);
  assert.equal(state.created.evaluations.length, 1);
  assert.equal(state.created.evaluations[0].clientId, 'fresh');
});

test('sync never claims success for items it skipped', async () => {
  const as = addActiveCoach();
  const res = await call('POST', '/api/sync', {
    as,
    body: {
      matchStats: [
        { id: 10, clientId: 'm1', playerId: 'removed-athlete', competition: 'League' }, // athlete no longer exists
        { id: 11, clientId: 'm2', playerName: 'Nobody Here', dateOfBirth: '2008-05-01', competition: 'League' }, // not on roster
        { id: 12, clientId: 'm3', playerName: 'Bad Date', dateOfBirth: '2008-99-99', competition: 'League' },
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.syncedIds.matchStats, []);
  assert.deepEqual(res.body.skipped.map((s) => s.reason), ['athlete_removed', 'athlete_not_found', 'invalid_athlete_details']);
  assert.equal(state.created.matchStats.length, 0);
});

test('sync stores match stats against the athlete id, even after a rename', async () => {
  const as = addActiveCoach();
  state.athletes.set('ath-1', { id: 'ath-1', name: 'Renamed Name', currentClubId: 'club-1' });
  const res = await call('POST', '/api/sync', {
    as,
    body: { matchStats: [{ id: 5, clientId: 'm5', playerId: 'ath-1', playerName: 'Old Name', dateOfBirth: '2000-01-01', competition: 'Cup', goals: 2 }] },
  });
  assert.deepEqual(res.body.syncedIds.matchStats, [5]);
  assert.equal(state.created.matchStats[0].playerId, 'ath-1');
});

test('a pending coach cannot sync', async () => {
  state.clubs.set('club-1', record({ id: 'club-1', name: 'Test FC' }));
  state.users.set('p', record({ id: 'p', role: 'Coach', clubId: 'club-1', clubRole: 'Member', membershipStatus: 'Pending' }));
  const res = await call('POST', '/api/sync', { as: token('p'), body: { records: [] } });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MEMBERSHIP_PENDING');
});

// ---------------- verification review ----------------
const adminToken = (sub = 'admin-1') =>
  jwt.sign({ sub, email: 'admin@example.com', aud: 'authenticated', app_metadata: { role: 'admin' } }, 'test-secret', { algorithm: 'HS256' });

const completeClub = (overrides = {}) =>
  record({
    id: 'club-1', name: 'Test FC', contactEmail: 'info@test.rw', contactPhone: '+250 788 000 000',
    region: 'Kigali', entityType: 'Registered Club', isVerified: false, verificationStatus: 'Unverified', ...overrides,
  });

const addOwner = (club) => {
  state.clubs.set(club.id, club);
  state.users.set('coach-1', record({ id: 'coach-1', role: 'Coach', clubId: club.id, clubRole: 'Owner', membershipStatus: 'Active' }));
  return token('coach-1');
};

const submission = (extra = {}) => ({
  statement: 'Registered with the federation in 2021.',
  documents: [{ path: 'coach-1/cert.jpg', docType: 'Registration Certificate', fileName: 'cert.jpg' }],
  ...extra,
});

test('verification admin routes reject everyone who is not an administrator', async () => {
  assert.equal((await call('GET', '/api/admin/verifications')).status, 401);
  const coach = addOwner(completeClub());
  const res = await call('GET', '/api/admin/verifications', { as: coach });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'NOT_ADMIN');
  assert.equal((await call('PUT', '/api/admin/verifications/club-1', { as: coach, body: { decision: 'approve' } })).body.code, 'NOT_ADMIN');
});

test('an admin has no coach access and no editable profile', async () => {
  assert.equal((await call('GET', '/api/club/roster', { as: adminToken() })).body.code, 'WRONG_ROLE');
  assert.equal((await call('PUT', '/api/profile', { as: adminToken(), body: { username: 'x' } })).status, 403);
});

test('an owner cannot request review until the checklist is complete', async () => {
  const as = addOwner(completeClub({ contactPhone: null }));
  state.athleteCount = 0;
  const res = await call('POST', '/api/club/verification', { as, body: submission() });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.missing, ['Contact phone', 'At least one athlete on the roster']);
  assert.equal(state.docs.length, 0);
});

test('a complete request is stored, marked Submitted and logged; documents must be in the owner\'s folder', async () => {
  const club = completeClub();
  const as = addOwner(club);
  state.athleteCount = 4;

  const stranger = await call('POST', '/api/club/verification', { as, body: submission({ documents: [{ path: 'someone-else/x.jpg', docType: 'Other' }] }) });
  assert.equal(stranger.status, 400);

  const res = await call('POST', '/api/club/verification', { as, body: submission() });
  assert.equal(res.status, 201);
  assert.equal(club.verificationStatus, 'Submitted');
  assert.equal(state.docs.length, 1);
  assert.equal(state.docs[0].storagePath, 'coach-1/cert.jpg');
  assert.equal(state.events[0].action, 'Submitted');

  const again = await call('POST', '/api/club/verification', { as, body: submission() });
  assert.equal(again.status, 409); // already awaiting review
});

test('only the club owner can request review', async () => {
  state.clubs.set('club-1', completeClub());
  state.users.set('member-1', record({ id: 'member-1', role: 'Coach', clubId: 'club-1', clubRole: 'Member', membershipStatus: 'Active' }));
  const res = await call('POST', '/api/club/verification', { as: token('member-1'), body: submission() });
  assert.equal(res.body.code, 'NOT_OWNER');
});

test('an admin sees submitted clubs with their documents and can approve them', async () => {
  const club = completeClub({ verificationStatus: 'Submitted', verificationStatement: 'Hello' });
  addOwner(club);
  state.owner = { username: 'Eric', email: 'eric@test.rw', phone: null };
  state.athleteCount = 2;
  state.docs.push({ id: 'd1', clubId: 'club-1', docType: 'Registration Certificate', storagePath: 'coach-1/cert.jpg', fileName: 'cert.jpg' });

  const list = await call('GET', '/api/admin/verifications', { as: adminToken() });
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].owner.username, 'Eric');
  assert.equal(list.body[0].athleteCount, 2);
  assert.equal(list.body[0].documents[0].storagePath, 'coach-1/cert.jpg');

  const res = await call('PUT', '/api/admin/verifications/club-1', { as: adminToken('admin-7'), body: { decision: 'approve' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'Verified');
  assert.equal(club.isVerified, true);
  assert.equal(club.verifiedBy, 'admin-7');
  assert.equal(state.events.at(-1).action, 'Verified');

  const asOwner = await call('GET', '/api/club/verification', { as: token('coach-1') });
  assert.equal(asOwner.body.status, 'Verified');
  assert.equal(asOwner.body.canRequest, false);
});

test('rejecting needs a reason, records it, and lets the owner resubmit', async () => {
  const club = completeClub({ verificationStatus: 'Submitted' });
  const owner = addOwner(club);
  state.athleteCount = 1;

  const noReason = await call('PUT', '/api/admin/verifications/club-1', { as: adminToken(), body: { decision: 'reject' } });
  assert.equal(noReason.status, 400);

  const res = await call('PUT', '/api/admin/verifications/club-1', { as: adminToken(), body: { decision: 'reject', reason: 'Certificate is unreadable' } });
  assert.equal(res.status, 200);
  assert.equal(club.verificationStatus, 'Rejected');

  const status = await call('GET', '/api/club/verification', { as: owner });
  assert.equal(status.body.status, 'Rejected');
  assert.equal(status.body.rejectionReason, 'Certificate is unreadable');
  assert.equal(status.body.canRequest, true);
});

test('decisions only apply from the right state', async () => {
  addOwner(completeClub({ verificationStatus: 'Unverified' }));
  const approve = await call('PUT', '/api/admin/verifications/club-1', { as: adminToken(), body: { decision: 'approve' } });
  assert.equal(approve.status, 409);
  const revoke = await call('PUT', '/api/admin/verifications/club-1', { as: adminToken(), body: { decision: 'revoke', reason: 'x' } });
  assert.equal(revoke.status, 409);
  assert.equal((await call('PUT', '/api/admin/verifications/missing', { as: adminToken(), body: { decision: 'approve' } })).status, 404);
  assert.equal((await call('PUT', '/api/admin/verifications/club-1', { as: adminToken(), body: { decision: 'maybe' } })).status, 400);
});

test('an admin can revoke a verified club', async () => {
  const club = completeClub({ isVerified: true, verificationStatus: 'Verified', verifiedBy: 'admin-1' });
  addOwner(club);
  const res = await call('PUT', '/api/admin/verifications/club-1', { as: adminToken(), body: { decision: 'revoke', reason: 'Fraudulent documents' } });
  assert.equal(res.status, 200);
  assert.equal(club.isVerified, false);
  assert.equal(club.verifiedBy, null);
  assert.equal(state.events.at(-1).action, 'Revoked');
});

test('changing the name of a verified club resets its verification', async () => {
  const club = completeClub({ isVerified: true, verificationStatus: 'Verified', verifiedBy: 'admin-1' });
  const as = addOwner(club);

  const harmless = await call('PUT', '/api/club', { as, body: { region: 'Musanze' } });
  assert.equal(harmless.body.verificationReset, false);
  assert.equal(club.isVerified, true);

  const rename = await call('PUT', '/api/club', { as, body: { name: 'Different Name FC' } });
  assert.equal(rename.status, 200);
  assert.equal(rename.body.verificationReset, true);
  assert.equal(club.isVerified, false);
  assert.equal(club.verificationStatus, 'Unverified');
  assert.equal(state.events.at(-1).action, 'Reset');
});

// ---------------- scout search ----------------
const approveScout = (id = 'scout-9') =>
  state.scoutProfiles.set(id, record({ userId: id, status: 'Approved', organisation: 'Kigali Scouts', orgType: 'Agent' }));
const scoutToken = () => { approveScout(); return token('scout-9', { username: 'Aline', role: 'Scout' }); };
const unapprovedScoutToken = () => token('scout-8', { username: 'Newbie', role: 'Scout' });
const clubInclude = () => state.lastPlayerQuery.include.find((i) => i.attributes?.includes('isVerified'));

test('scout search returns the club\'s verified flag, and does not require it by default', async () => {
  const res = await call('GET', '/api/players', { as: scoutToken() });
  assert.equal(res.status, 200);
  assert.ok(clubInclude(), 'club include should expose isVerified');
  assert.equal(clubInclude().required, undefined);
  assert.equal(clubInclude().where, undefined);
});

test('verifiedOnly makes the club join mandatory and limits it to verified clubs', async () => {
  const res = await call('GET', '/api/players?verifiedOnly=true', { as: scoutToken() });
  assert.equal(res.status, 200);
  assert.equal(clubInclude().required, true);
  assert.deepEqual(clubInclude().where, { isVerified: true });
});

test('only the exact value "true" turns the verified filter on', async () => {
  await call('GET', '/api/players?verifiedOnly=1', { as: scoutToken() });
  assert.equal(clubInclude().required, undefined);
});

test('coaches cannot use scout search', async () => {
  const res = await call('GET', '/api/players?verifiedOnly=true', { as: addActiveCoach() });
  assert.equal(res.body.code, 'WRONG_ROLE');
});

// ---------------- notifications ----------------
const useFakeNotifier = (result = { sent: true }) => {
  const sent = [];
  app.locals.notifier = { enabled: true, send: async (message) => { sent.push(message); return result; } };
  return sent;
};

test('submitting a request emails the administrators', async () => {
  process.env.ADMIN_NOTIFY_EMAIL = 'admin1@example.com, admin2@example.com';
  const sent = useFakeNotifier();
  const as = addOwner(completeClub());
  state.athleteCount = 3;

  const res = await call('POST', '/api/club/verification', { as, body: submission() });
  assert.equal(res.status, 201);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['admin1@example.com', 'admin2@example.com']);
  assert.match(sent[0].subject, /New verification request: Test FC/);
  assert.match(sent[0].text, /Athletes on roster: 3/);
  delete process.env.ADMIN_NOTIFY_EMAIL;
});

test('with no admin address configured, submitting still works and sends nothing useful', async () => {
  delete process.env.ADMIN_NOTIFY_EMAIL;
  const sent = useFakeNotifier();
  const as = addOwner(completeClub());
  state.athleteCount = 1;
  const res = await call('POST', '/api/club/verification', { as, body: submission() });
  assert.equal(res.status, 201);
  assert.deepEqual(sent[0].to, []); // the real notifier skips an empty recipient list
});

test('each decision emails the club owners', async () => {
  const sent = useFakeNotifier();
  state.owners = [{ email: 'owner@stars.rw', username: 'Eric' }];
  addOwner(completeClub({ verificationStatus: 'Submitted' }));

  await call('PUT', '/api/admin/verifications/club-1', { as: adminToken(), body: { decision: 'reject', reason: 'Unreadable scan' } });
  assert.deepEqual(sent[0].to, ['owner@stars.rw']);
  assert.match(sent[0].subject, /more information needed/);
  assert.match(sent[0].text, /Unreadable scan/);

  state.clubs.get('club-1').update({ verificationStatus: 'Submitted' });
  await call('PUT', '/api/admin/verifications/club-1', { as: adminToken(), body: { decision: 'approve' } });
  assert.match(sent[1].subject, /is now verified/);
});

test('a failing mail provider never blocks a decision or a submission', async () => {
  const failing = { enabled: true, send: async () => { throw new Error('mail is down'); } };
  app.locals.notifier = failing;
  state.owners = [{ email: 'owner@stars.rw' }];

  const club = completeClub({ verificationStatus: 'Submitted' });
  addOwner(club);
  const decision = await call('PUT', '/api/admin/verifications/club-1', { as: adminToken(), body: { decision: 'approve' } });
  assert.equal(decision.status, 200);
  assert.equal(club.isVerified, true);
});

test('a throwing mail provider does not turn a saved submission into an error', async () => {
  app.locals.notifier = { enabled: true, send: async () => { throw new Error('mail is down'); } };
  const club = completeClub();
  const as = addOwner(club);
  state.athleteCount = 2;

  const res = await call('POST', '/api/club/verification', { as, body: submission() });
  assert.equal(res.status, 201);
  assert.equal(club.verificationStatus, 'Submitted');
});

// ---------------- scout position filter ----------------

test('scout position filters are passed to the database as lists, not exact matches', async () => {
  await call('GET', '/api/players?positions=Defender,Center%20Back,Left%20Fullback', { as: scoutToken() });
  assert.deepEqual(state.lastPlayerQuery.where.position, { [Op.in]: ['Defender', 'Center Back', 'Left Fullback'] });

  await call('GET', '/api/players?excludePositions=Goalkeeper,Defender', { as: scoutToken() });
  assert.deepEqual(state.lastPlayerQuery.where.position, { [Op.notIn]: ['Goalkeeper', 'Defender'] });

  await call('GET', '/api/players', { as: scoutToken() });
  assert.equal(state.lastPlayerQuery.where.position, undefined);
});

test('an included list wins over an exclusion list, and the old exact "position" still works', async () => {
  await call('GET', '/api/players?positions=Striker&excludePositions=Goalkeeper', { as: scoutToken() });
  assert.deepEqual(state.lastPlayerQuery.where.position, { [Op.in]: ['Striker'] });

  await call('GET', '/api/players?position=Goalkeeper', { as: scoutToken() });
  assert.equal(state.lastPlayerQuery.where.position, 'Goalkeeper');
});

// ---------------- scout fixes ----------------
const evaluation = (id, createdAt) => ({ id, createdAt });

test('scout search uses a fixed order so pages never repeat or skip athletes', async () => {
  await call('GET', '/api/players', { as: scoutToken() });
  assert.deepEqual(state.lastPlayerQuery.order, [['name', 'ASC'], ['id', 'ASC']]);
});

test('scout search by name is a case-insensitive contains match, with wildcards escaped', async () => {
  await call('GET', '/api/players?search=%20%20jean%20%20paul%20', { as: scoutToken() });
  assert.deepEqual(state.lastPlayerQuery.where.name, { [Op.iLike]: '%jean paul%' });

  await call('GET', '/api/players?search=100%25_x', { as: scoutToken() });
  assert.deepEqual(state.lastPlayerQuery.where.name, { [Op.iLike]: '%100\\%\\_x%' });

  await call('GET', '/api/players?search=', { as: scoutToken() });
  assert.equal(state.lastPlayerQuery.where.name, undefined);
});

test('evaluations come back oldest to newest whatever order the database used', async () => {
  state.playerRows = [{ id: 'p1', name: 'A', Evaluations: [evaluation('newest', '2026-03-01'), evaluation('oldest', '2026-01-01'), evaluation('middle', '2026-02-01')] }];
  const res = await call('GET', '/api/players', { as: scoutToken() });
  assert.deepEqual(res.body.players[0].Evaluations.map((e) => e.id), ['oldest', 'middle', 'newest']);
  assert.equal(res.body.totalItems, 1);
});

test('shortlist entries also get their evaluations sorted', async () => {
  state.shortlistRows = [{ id: 's1', Player: { id: 'p1', name: 'A B', consentStatus: 'Recorded', Evaluations: [evaluation('b', '2026-05-01'), evaluation('a', '2026-04-01')] } }];
  const res = await call('GET', '/api/shortlist', { as: scoutToken() });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body[0].Player.Evaluations.map((e) => e.id), ['a', 'b']);
});

test("/api/me returns the signed-in account's own details and nothing sensitive", async () => {
  state.users.set('scout-9', record({ id: 'scout-9', username: 'Aline K', email: 'aline@x.co', phone: null, role: 'Scout', createdAt: '2026-02-02T00:00:00Z', passwordHash: 'secret' }));
  const res = await call('GET', '/api/me', { as: scoutToken() });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { id: 'scout-9', username: 'Aline K', email: 'aline@x.co', phone: null, role: 'Scout', isAdmin: false, createdAt: '2026-02-02T00:00:00Z', accreditationStatus: 'Approved' });
  assert.equal((await call('GET', '/api/me')).status, 401);
});

// ---------------- scout accreditation, minimised data, consent, contact requests ----------------
const scoutsLib = require('../lib/scouts');

const visibleAthlete = (overrides = {}) =>
  record({
    id: 'ath-1', name: 'Jean Paul Mugisha', dateOfBirth: '2011-10-30', position: 'Center Back', profilePhoto: 'https://x/p.jpg',
    currentClubId: 'club-1', consentStatus: 'Recorded', ...overrides,
  });

const scoutApplication = (userId, extra = {}) => ({
  organisation: 'Kigali Scouts', orgType: 'Agent', licenceNumber: 'L-77', statement: 'Licensed since 2020.',
  documents: [{ path: userId + '/licence.pdf', docType: 'Other', fileName: 'licence.pdf' }],
  ...extra,
});

test('an unapproved scout is locked out of every athlete route but can still see their own account', async () => {
  const as = unapprovedScoutToken();
  state.athletes.set('ath-1', visibleAthlete());
  const routes = [
    ['GET', '/api/players'],
    ['GET', '/api/players/ath-1'],
    ['GET', '/api/shortlist'],
    ['POST', '/api/shortlist', { playerId: 'ath-1' }],
    ['POST', '/api/contact-requests', { playerId: 'ath-1', message: 'We would like a trial.' }],
    ['GET', '/api/contact-requests'],
  ];
  for (const [method, path, body] of routes) {
    const res = await call(method, path, { as, body });
    assert.equal(res.status, 403, method + ' ' + path);
    assert.equal(res.body.code, 'SCOUT_NOT_APPROVED', path);
    assert.equal(res.body.accreditationStatus, 'Pending');
  }
  const me = await call('GET', '/api/me', { as });
  assert.equal(me.status, 200);
  assert.equal(me.body.accreditationStatus, 'Pending');
  assert.equal(state.accessLogs.length, 0);
});

test('submitted and suspended scouts are locked out too, with a fitting message', async () => {
  const as = unapprovedScoutToken();
  state.scoutProfiles.set('scout-8', record({ userId: 'scout-8', status: 'Submitted' }));
  assert.equal((await call('GET', '/api/players', { as })).body.accreditationStatus, 'Submitted');

  state.scoutProfiles.get('scout-8').status = 'Suspended';
  const res = await call('GET', '/api/players', { as });
  assert.equal(res.body.accreditationStatus, 'Suspended');
  assert.match(res.body.error, /suspended/);
});

test('a scout applies with documents, and the administrators are emailed', async () => {
  process.env.ADMIN_NOTIFY_EMAIL = 'admin@example.com';
  const sent = useFakeNotifier();
  const as = unapprovedScoutToken();

  assert.equal((await call('POST', '/api/scout/accreditation', { as, body: scoutApplication('scout-8', { documents: [] }) })).status, 400);
  assert.equal((await call('POST', '/api/scout/accreditation', { as, body: scoutApplication('someone-else') })).status, 400);
  assert.equal((await call('POST', '/api/scout/accreditation', { as, body: scoutApplication('scout-8', { orgType: 'Wizard' }) })).status, 400);

  const res = await call('POST', '/api/scout/accreditation', { as, body: scoutApplication('scout-8') });
  assert.equal(res.status, 201);
  const profile = state.scoutProfiles.get('scout-8');
  assert.equal(profile.status, 'Submitted');
  assert.equal(profile.organisation, 'Kigali Scouts');
  assert.equal(profile.licenceNumber, 'L-77');
  assert.equal(state.docs[0].scoutUserId, 'scout-8');
  assert.equal(state.events.at(-1).action, 'Submitted');
  assert.deepEqual(sent[0].to, ['admin@example.com']);
  assert.match(sent[0].subject, /scout accreditation/);

  assert.equal((await call('POST', '/api/scout/accreditation', { as, body: scoutApplication('scout-8') })).status, 409);

  const status = await call('GET', '/api/scout/accreditation', { as });
  assert.equal(status.body.status, 'Submitted');
  assert.equal(status.body.documents.length, 1);
  assert.ok(status.body.orgTypes.includes('Agent'));
  delete process.env.ADMIN_NOTIFY_EMAIL;
});

test('every scout must apply: having no profile means no access, even for accounts that existed before', async () => {
  // An old scout account: a user row, but no ScoutProfile.
  state.users.set('scout-8', record({ id: 'scout-8', role: 'Scout', email: 'old@x.co', username: 'Old Scout' }));
  const res = await call('GET', '/api/players', { as: unapprovedScoutToken() });
  assert.equal(res.status, 403);
  assert.equal(res.body.accreditationStatus, 'Pending');
});

test('an admin reviews scouts: approve opens access, reject needs a reason, suspend closes it again', async () => {
  const sent = useFakeNotifier();
  state.users.set('scout-8', record({ id: 'scout-8', role: 'Scout', email: 'newbie@x.co', username: 'Newbie' }));
  state.scoutProfiles.set('scout-8', record({ userId: 'scout-8', status: 'Submitted', organisation: 'Kigali Scouts', orgType: 'Agent', submittedAt: new Date() }));
  state.docs.push({ id: 'd1', scoutUserId: 'scout-8', docType: 'Other', storagePath: 'scout-8/licence.pdf', fileName: 'licence.pdf' });

  const list = await call('GET', '/api/admin/scouts', { as: adminToken() });
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].id, 'scout-8');
  assert.equal(list.body[0].name, 'Newbie');
  assert.equal(list.body[0].documents[0].storagePath, 'scout-8/licence.pdf');
  assert.equal((await call('GET', '/api/admin/scouts', { as: scoutToken() })).body.code, 'NOT_ADMIN');

  const put = (body, as = adminToken()) => call('PUT', '/api/admin/scouts/scout-8', { as, body });
  assert.equal((await put({ decision: 'maybe' })).status, 400);
  assert.equal((await put({ decision: 'reject' })).status, 400); // reason needed
  assert.equal((await put({ decision: 'suspend', reason: 'x' })).status, 409); // not approved yet
  assert.equal((await call('PUT', '/api/admin/scouts/nobody', { as: adminToken(), body: { decision: 'approve' } })).status, 404);

  assert.equal((await put({ decision: 'approve' })).body.status, 'Approved');
  assert.equal(state.scoutProfiles.get('scout-8').decidedBy, 'admin-1');
  assert.equal(sent.at(-1).to, 'newbie@x.co');
  assert.match(sent.at(-1).subject, /approved/);
  assert.equal((await call('GET', '/api/players', { as: unapprovedScoutToken() })).status, 200); // access is open now

  assert.equal((await put({ decision: 'suspend', reason: 'Misuse of contact details' })).body.status, 'Suspended');
  assert.equal(state.scoutProfiles.get('scout-8').rejectionReason, 'Misuse of contact details');
  assert.equal((await call('GET', '/api/players', { as: unapprovedScoutToken() })).body.code, 'SCOUT_NOT_APPROVED');
  assert.match(sent.at(-1).subject, /suspended/);

  assert.equal((await put({ decision: 'reinstate' })).body.status, 'Approved');
  assert.equal(state.scoutProfiles.get('scout-8').rejectionReason, null);
  assert.equal(state.events.map((e) => e.action).join(','), 'Approved,Suspended,Reinstated');
});

test('a rejected scout can apply again', async () => {
  state.users.set('scout-8', record({ id: 'scout-8', role: 'Scout', email: 'n@x.co', username: 'Newbie' }));
  state.scoutProfiles.set('scout-8', record({ userId: 'scout-8', status: 'Submitted' }));
  await call('PUT', '/api/admin/scouts/scout-8', { as: adminToken(), body: { decision: 'reject', reason: 'Licence unreadable' } });
  assert.equal(state.scoutProfiles.get('scout-8').status, 'Rejected');

  const again = await call('POST', '/api/scout/accreditation', { as: unapprovedScoutToken(), body: scoutApplication('scout-8') });
  assert.equal(again.status, 201);
  assert.equal(state.scoutProfiles.get('scout-8').status, 'Submitted');
  assert.equal(state.scoutProfiles.get('scout-8').rejectionReason, null);
});

test('scouts receive minimised athletes, and every search is logged', async () => {
  state.playerRows = [record({
    id: 'ath-1', name: 'Jean Paul Mugisha', dateOfBirth: '2011-10-30', position: 'Center Back', profilePhoto: 'https://x/p.jpg',
    consentStatus: 'Recorded', consentGuardian: 'Parent Name',
    Club: { name: 'Stars FC', isVerified: true, contactEmail: 'info@stars.rw', contactPhone: '+250788000000' },
    Evaluations: [], MatchStats: [], Achievements: [],
  })];
  const res = await call('GET', '/api/players', { as: scoutToken() });
  const athlete = res.body.players[0];
  assert.equal(athlete.displayName, 'Jean M.');
  assert.equal(athlete.profilePhoto, null); // the test server has no service key, so no photo is shown: never the stored value
  assert.equal(athlete.Club.isVerified, true);

  const everything = JSON.stringify(res.body);
  for (const secret of ['2011-10-30', 'Mugisha', 'info@stars.rw', '788000000', 'Parent Name', 'consent', 'x/p.jpg']) {
    assert.ok(!everything.includes(secret), 'leaked: ' + secret);
  }
  assert.deepEqual(state.accessLogs, [{ scoutId: 'scout-9', route: 'players', resultCount: 1, athleteIds: ['ath-1'] }]);
});

test('searches only include athletes with consent, support "under N", whitelist columns and cap the page size', async () => {
  await call('GET', '/api/players?under=15&limit=500', { as: scoutToken() });
  const query = state.lastPlayerQuery;
  assert.equal(query.limit, 20);

  const conditions = query.where[Op.and];
  const [consentRule, hiddenRule] = conditions[0][Op.and];
  assert.ok(consentRule[Op.or], 'the consent rule must always be applied');
  assert.deepEqual(hiddenRule[Op.or], [{ scoutHidden: false }, { scoutHidden: null }]); // and athletes an admin hid stay hidden
  const age = conditions.find((c) => c.dateOfBirth);
  assert.equal(age.dateOfBirth[Op.gt], scoutsLib.dobCutoffForUnder(15));

  assert.ok(!query.attributes.includes('consentGuardian'));
  assert.ok(!query.attributes.includes('highlightVideo'));

  await call('GET', '/api/players?under=3', { as: scoutToken() }); // out of range: ignored
  assert.equal(state.lastPlayerQuery.where[Op.and].length, 1);
});

test('a scout can open an athlete only while consent allows it', async () => {
  state.athletes.set('ath-1', visibleAthlete({ consentStatus: 'Missing' }));
  assert.equal((await call('GET', '/api/players/ath-1', { as: scoutToken() })).status, 404);

  state.athletes.get('ath-1').consentStatus = 'Recorded';
  const ok = await call('GET', '/api/players/ath-1', { as: scoutToken() });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.displayName, 'Jean M.');
  assert.equal(ok.body.dateOfBirth, undefined);
  assert.equal(state.accessLogs.at(-1).route, 'player-detail');

  state.athletes.set('ath-2', visibleAthlete({ id: 'ath-2', consentStatus: null, consentGraceUntil: new Date(Date.now() + 86400000) }));
  assert.equal((await call('GET', '/api/players/ath-2', { as: scoutToken() })).status, 200); // grace period running

  state.athletes.set('ath-3', visibleAthlete({ id: 'ath-3', consentStatus: null, consentGraceUntil: new Date(Date.now() - 1000) }));
  assert.equal((await call('GET', '/api/players/ath-3', { as: scoutToken() })).status, 404); // grace period over
});

test('the shortlist only accepts available athletes, and keeps a placeholder when consent lapses', async () => {
  state.athletes.set('ath-1', visibleAthlete());
  state.athletes.set('ath-2', visibleAthlete({ id: 'ath-2', consentStatus: 'Missing' }));
  const as = scoutToken();

  assert.equal((await call('POST', '/api/shortlist', { as, body: { playerId: 'ath-2' } })).status, 404);
  assert.equal((await call('POST', '/api/shortlist', { as, body: { playerId: 'ath-1', notes: '  Strong left foot ' } })).status, 201);
  assert.equal(state.shortlistRows[0].notes, 'Strong left foot');
  assert.equal((await call('POST', '/api/shortlist', { as, body: { playerId: 'ath-1' } })).status, 400); // already there

  state.shortlistRows = [
    { id: 's1', notes: null, Player: { id: 'ath-2', name: 'Gone Player', consentStatus: 'Missing' } },
    { id: 's2', notes: 'x', Player: null },
  ];
  const list = await call('GET', '/api/shortlist', { as });
  assert.deepEqual(list.body.map((e) => e.unavailable), [true, true]);
  assert.deepEqual(list.body.map((e) => e.Player), [null, null]);
});

test('a scout can edit the note on their own shortlist entry, and the athlete detail says if it is shortlisted', async () => {
  state.athletes.set('ath-1', visibleAthlete());
  const as = scoutToken();
  assert.equal((await call('GET', '/api/players/ath-1', { as })).body.shortlistId, null);

  const added = await call('POST', '/api/shortlist', { as, body: { playerId: 'ath-1' } });
  const entryId = state.shortlistRows[0].id;
  assert.equal(added.status, 201);
  assert.equal((await call('GET', '/api/players/ath-1', { as })).body.shortlistId, entryId);

  const edited = await call('PATCH', `/api/shortlist/${entryId}`, { as, body: { notes: '  Watch again in March ' } });
  assert.equal(edited.status, 200);
  assert.equal(state.shortlistRows[0].notes, 'Watch again in March');
  assert.equal((await call('PATCH', '/api/shortlist/nope', { as, body: { notes: 'x' } })).status, 404);
});

test('coaches record guardian consent, which needs a guardian name, and can withdraw it', async () => {
  const as = addActiveCoach();
  const athlete = visibleAthlete({ consentStatus: 'Missing' });
  state.athletes.set('ath-1', athlete);
  const put = (body) => call('PUT', '/api/club/players/ath-1', { as, body });

  const noName = await put({ consent: true });
  assert.equal(noName.status, 400);
  assert.match(noName.body.error, /guardian/);
  assert.equal(athlete.consentStatus, 'Missing');

  assert.equal((await put({ consent: true, guardianName: '  Marie   Uwase ' })).status, 200);
  assert.equal(athlete.consentStatus, 'Recorded');
  assert.equal(athlete.consentGuardian, 'Marie Uwase');
  assert.equal(athlete.consentRecordedBy, 'coach-1');
  assert.equal(athlete.consentGraceUntil, null);

  assert.equal((await put({ consent: false })).status, 200);
  assert.equal(athlete.consentStatus, 'Missing');
  assert.equal(athlete.consentGuardian, null);
});

test('athletes created by a sync start without consent, so scouts cannot see them yet', async () => {
  const as = addActiveCoach();
  await call('POST', '/api/sync', {
    as,
    body: { records: [{ id: 1, clientId: 'c-new', playerName: 'New Kid', dateOfBirth: '2010-05-05', sprintSpeed: 4, dribblingScore: 3, timestamp: '2026-01-01T00:00:00Z' }] },
  });
  assert.equal(state.lastCreatedPlayer.consentStatus, 'Missing');
  assert.equal(scoutsLib.isVisibleToScouts(state.lastCreatedPlayer), false);
});

test('contact requests: validation, only active owners emailed, duplicates blocked, daily limit enforced', async () => {
  const sent = useFakeNotifier();
  state.athletes.set('ath-1', visibleAthlete({ Club: { id: 'club-1', name: 'Stars FC' } }));
  state.athletes.set('ath-2', visibleAthlete({ id: 'ath-2', consentStatus: 'Missing' }));
  state.owners = [{ email: 'owner@stars.rw', membershipStatus: 'Active' }, { email: 'pending@stars.rw', membershipStatus: 'Pending' }];
  const as = scoutToken();
  const message = 'We would like to invite him for a trial.';
  const post = (body) => call('POST', '/api/contact-requests', { as, body });

  assert.equal((await post({ playerId: 'ath-1', message: 'hi' })).status, 400);
  assert.equal((await post({ playerId: 'ath-1', message: 'x'.repeat(501) })).status, 400);
  assert.equal((await post({ playerId: 'ath-2', message })).status, 404); // no consent
  assert.equal((await post({ message })).status, 404);

  const created = await post({ playerId: 'ath-1', message });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'Pending');
  assert.equal(state.contactRequests[0].clubId, 'club-1');
  assert.deepEqual(sent.at(-1).to, ['owner@stars.rw']);
  assert.match(sent.at(-1).subject, /Jean Paul Mugisha/);
  assert.match(sent.at(-1).text, /Nothing about the athlete or your club is shared until you accept/);

  const duplicate = await post({ playerId: 'ath-1', message });
  assert.equal(duplicate.status, 409);

  for (let i = 0; i < 9; i++) state.contactRequests.push(record({ scoutId: 'scout-9', playerId: 'old-' + i, status: 'Declined', createdAt: new Date() }));
  state.athletes.set('ath-3', visibleAthlete({ id: 'ath-3', name: 'Other Kid' }));
  const limited = await post({ playerId: 'ath-3', message });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'RATE_LIMITED');
});

test('the club owner answers requests; identity and contact details are released only on acceptance', async () => {
  const sent = useFakeNotifier();
  const club = completeClub({ id: 'club-1', name: 'Stars FC', contactEmail: 'info@stars.rw', contactPhone: '+250788000000' });
  const ownerAs = addOwner(club);
  state.athletes.set('ath-1', visibleAthlete());
  const scoutAs = scoutToken();

  const makeRequest = (id) => record({
    id, scoutId: 'scout-9', playerId: 'ath-1', clubId: 'club-1', message: 'Trial invitation please', status: 'Pending', createdAt: new Date(),
    Player: { id: 'ath-1', name: 'Jean Paul Mugisha', position: 'Center Back', dateOfBirth: '2011-10-30', profilePhoto: null },
    Club: { name: 'Stars FC', isVerified: true, contactEmail: 'info@stars.rw', contactPhone: '+250788000000' },
    Scout: { id: 'scout-9', username: 'Aline', email: 'aline@x.co', phone: '+250700000000' },
  });
  const request = makeRequest('cr-1');
  state.contactRequests.push(request);

  // the scout's view while the request is pending: masked, no contact
  const pending = await call('GET', '/api/contact-requests', { as: scoutAs });
  assert.equal(pending.body[0].status, 'Pending');
  assert.equal(pending.body[0].athlete.displayName, 'Jean M.');
  assert.equal(pending.body[0].athlete.age, scoutsLib.ageFromDob('2011-10-30'));
  assert.equal(pending.body[0].club.contactEmail, undefined);
  assert.ok(!JSON.stringify(pending.body).includes('2011-10-30'));

  // the owner's view: full athlete name, the scout's organisation, but not the scout's contact yet
  const incoming = await call('GET', '/api/club/contact-requests', { as: ownerAs });
  assert.equal(incoming.body[0].athlete.name, 'Jean Paul Mugisha');
  assert.equal(incoming.body[0].scout.organisation, 'Kigali Scouts');
  assert.equal(incoming.body[0].scout.email, undefined);

  // only the owner of THIS club can answer
  state.users.set('member-1', record({ id: 'member-1', role: 'Coach', clubId: 'club-1', clubRole: 'Member', membershipStatus: 'Active' }));
  state.clubs.set('club-2', record({ id: 'club-2', name: 'Other FC' }));
  state.users.set('other-owner', record({ id: 'other-owner', role: 'Coach', clubId: 'club-2', clubRole: 'Owner', membershipStatus: 'Active' }));
  const answer = (id, body, as) => call('PUT', '/api/club/contact-requests/' + id, { as, body });
  assert.equal((await answer('cr-1', { decision: 'accept' }, token('member-1'))).body.code, 'NOT_OWNER');
  assert.equal((await answer('cr-1', { decision: 'accept' }, token('other-owner'))).status, 404);
  assert.deepEqual((await call('GET', '/api/club/contact-requests', { as: token('other-owner') })).body, []);
  assert.equal((await answer('cr-1', { decision: 'maybe' }, ownerAs)).status, 400);
  assert.equal(request.status, 'Pending');

  // accept: the scout is emailed, and now sees the full name and the club's contact
  const accepted = await answer('cr-1', { decision: 'accept', note: 'Call after 5pm' }, ownerAs);
  assert.equal(accepted.status, 200);
  assert.equal(request.status, 'Accepted');
  assert.equal(request.respondedBy, 'coach-1');
  assert.equal(sent.at(-1).to, 'scout-9@example.com');
  assert.match(sent.at(-1).subject, /accepted/);
  assert.match(sent.at(-1).text, /Jean Paul Mugisha/);

  const revealed = await call('GET', '/api/contact-requests', { as: scoutAs });
  assert.equal(revealed.body[0].athlete.displayName, 'Jean Paul Mugisha');
  assert.equal(revealed.body[0].club.contactEmail, 'info@stars.rw');
  assert.equal(revealed.body[0].club.contactPhone, '+250788000000');
  assert.equal(revealed.body[0].responseNote, 'Call after 5pm');

  state.playerRows = [record({ id: 'ath-1', name: 'Jean Paul Mugisha', dateOfBirth: '2011-10-30', position: 'Center Back', consentStatus: 'Recorded', Club: { name: 'Stars FC', isVerified: true, contactEmail: 'info@stars.rw', contactPhone: '+250788000000' }, Evaluations: [] })];
  const search = await call('GET', '/api/players', { as: scoutAs });
  assert.equal(search.body.players[0].displayName, 'Jean Paul Mugisha'); // the search honours the accepted request too
  assert.equal(search.body.players[0].Club.contactEmail, 'info@stars.rw');
  assert.ok(!JSON.stringify(search.body).includes('2011-10-30'));

  const afterOwner = await call('GET', '/api/club/contact-requests?status=Accepted', { as: ownerAs });
  assert.equal(afterOwner.body[0].scout.email, 'aline@x.co'); // the scout's contact is shared with the club once accepted

  // it cannot be answered twice
  assert.equal((await answer('cr-1', { decision: 'decline' }, ownerAs)).status, 409);

  // a declined request reveals nothing and the decline email does not name the athlete in full
  state.contactRequests.length = 0;
  const second = makeRequest('cr-2');
  state.contactRequests.push(second);
  assert.equal((await answer('cr-2', { decision: 'decline', note: 'Not available' }, ownerAs)).status, 200);
  assert.equal(second.status, 'Declined');
  assert.match(sent.at(-1).subject, /declined/);
  assert.match(sent.at(-1).text, /Jean M\./);
  assert.ok(!sent.at(-1).text.includes('Mugisha'));
  const declined = await call('GET', '/api/contact-requests', { as: scoutAs });
  assert.equal(declined.body[0].athlete.displayName, 'Jean M.');
  assert.equal(declined.body[0].club.contactEmail, undefined);
});

test('the coach roster reports how many athletes still need guardian consent', async () => {
  const as = addActiveCoach();
  state.playerRows = [];
  state.athleteCount = 7;
  const res = await call('GET', '/api/club/players', { as });
  assert.equal(res.status, 200);
  assert.equal(res.body.needsConsent, 7);
  const where = state.lastPlayerQuery.where;
  assert.equal(where.currentClubId, 'club-1'); // the roster is scoped to the coach's own club
});

// ---------------- fixes for the known gaps: private photos, limits, cooldown, reports ----------------
const useFakePhotos = () => {
  app.locals.photos = {
    enabled: true,
    sign: async (values) => new Map(values.filter(Boolean).map((v) => [v, 'https://signed.example/' + v + '?token=T'])),
  };
};
const noPhotoKey = () => { app.locals.photos = { enabled: false, sign: async () => new Map() }; };

test('photos reach scouts only as short-lived signed links, never as the stored path', async () => {
  useFakePhotos();
  state.playerRows = [record({ id: 'ath-1', name: 'Jean Paul Mugisha', dateOfBirth: '2011-10-30', position: 'Center Back', profilePhoto: 'u1/pic.jpg', consentStatus: 'Recorded', Evaluations: [] })];
  const search = await call('GET', '/api/players', { as: scoutToken() });
  assert.equal(search.body.players[0].profilePhoto, 'https://signed.example/u1/pic.jpg?token=T');

  state.athletes.set('ath-1', visibleAthlete({ profilePhoto: 'u1/pic.jpg' }));
  const detail = await call('GET', '/api/players/ath-1', { as: scoutToken() });
  assert.equal(detail.body.profilePhoto, 'https://signed.example/u1/pic.jpg?token=T');

  noPhotoKey(); // no service key on the server: no photo at all, rather than a public fallback
  const without = await call('GET', '/api/players', { as: scoutToken() });
  assert.equal(without.body.players[0].profilePhoto, null);
  assert.ok(!JSON.stringify(without.body).includes('u1/pic.jpg'));
});

test('the shortlist and the request list carry signed photo links too', async () => {
  useFakePhotos();
  state.shortlistRows = [{ id: 's1', notes: null, Player: { id: 'ath-1', name: 'Jean Paul Mugisha', consentStatus: 'Recorded', profilePhoto: 'u1/pic.jpg', Evaluations: [] } }];
  const shortlist = await call('GET', '/api/shortlist', { as: scoutToken() });
  assert.equal(shortlist.body[0].Player.profilePhoto, 'https://signed.example/u1/pic.jpg?token=T');

  state.contactRequests.push(record({
    id: 'cr-1', scoutId: 'scout-9', status: 'Pending', message: 'A trial please', createdAt: new Date(),
    Player: { id: 'ath-1', name: 'Jean Paul Mugisha', position: 'Center Back', dateOfBirth: '2011-10-30', profilePhoto: 'u1/pic.jpg' },
    Club: { name: 'Stars FC', isVerified: true },
  }));
  const requests = await call('GET', '/api/contact-requests', { as: scoutToken() });
  assert.equal(requests.body[0].athlete.profilePhoto, 'https://signed.example/u1/pic.jpg?token=T');
});

test("a coach gets signed links for their own club's athletes only", async () => {
  useFakePhotos();
  const as = addActiveCoach();
  state.athletes.set('ath-1', visibleAthlete({ profilePhoto: 'u1/pic.jpg' }));
  const own = await call('GET', '/api/players/ath-1', { as });
  assert.equal(own.status, 200);
  assert.equal(own.body.photoUrl, 'https://signed.example/u1/pic.jpg?token=T');

  state.athletes.set('ath-2', visibleAthlete({ id: 'ath-2', currentClubId: 'club-9', profilePhoto: 'u2/x.jpg' }));
  assert.equal((await call('GET', '/api/players/ath-2', { as })).status, 404);
});

test('the search limit counts recent searches in the database, so it survives restarts', async () => {
  const as = scoutToken();
  const search = () => fetch(base + '/api/players', { headers: { Authorization: 'Bearer ' + as } });

  for (let i = 0; i < 120; i++) state.accessLogs.push({ scoutId: 'scout-9', route: 'players', createdAt: new Date() });
  const blocked = await search();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
  assert.equal((await blocked.json()).code, 'RATE_LIMITED');

  state.accessLogs.length = 0; // the same volume, but older than the 10-minute window
  for (let i = 0; i < 120; i++) state.accessLogs.push({ scoutId: 'scout-9', route: 'players', createdAt: new Date(Date.now() - 11 * 60 * 1000) });
  assert.equal((await search()).status, 200);

  state.accessLogs.length = 0; // somebody else's searches are not mine
  for (let i = 0; i < 120; i++) state.accessLogs.push({ scoutId: 'scout-1', route: 'players', createdAt: new Date() });
  assert.equal((await search()).status, 200);
});

test('after a decline a scout waits 30 days before asking again, then may ask', async () => {
  useFakeNotifier();
  state.athletes.set('ath-1', visibleAthlete({ Club: { id: 'club-1', name: 'Stars FC' } }));
  state.owners = [{ email: 'owner@stars.rw', membershipStatus: 'Active' }];
  const as = scoutToken();
  const message = 'We would like to invite him for a trial.';
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  state.contactRequests.push(record({ id: 'cr-old', scoutId: 'scout-9', playerId: 'ath-1', clubId: 'club-1', status: 'Declined', respondedAt: daysAgo(5), createdAt: daysAgo(6) }));

  const blocked = await call('POST', '/api/contact-requests', { as, body: { playerId: 'ath-1', message } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'COOLDOWN');
  assert.match(blocked.body.error, /You can ask again on 20\d\d-\d\d-\d\d/);
  const days = (new Date(blocked.body.canRequestAgainAt) - Date.now()) / 86400000;
  assert.ok(days > 24 && days < 26, 'about 25 days remain, got ' + days);
  assert.equal(state.contactRequests.length, 1); // nothing was created

  state.playerRows = [record({ id: 'ath-1', name: 'Jean Paul Mugisha', dateOfBirth: '2011-10-30', position: 'Center Back', consentStatus: 'Recorded', Evaluations: [] })];
  const search = await call('GET', '/api/players', { as });
  assert.ok(search.body.players[0].contactRequest.canRequestAgainAt, 'the app is told when it may ask again');

  state.contactRequests[0].respondedAt = daysAgo(31);
  assert.equal((await call('POST', '/api/contact-requests', { as, body: { playerId: 'ath-1', message } })).status, 201);
});

const reportBody = (extra = {}) => ({ playerId: 'ath-1', category: 'Inaccurate stats', details: 'The sprint time looks impossible', ...extra });

test('reports need a category and details, and only people who can see the athlete may file them', async () => {
  process.env.ADMIN_NOTIFY_EMAIL = 'admin@example.com';
  const sent = useFakeNotifier();
  state.athletes.set('ath-1', visibleAthlete({ Club: record({ id: 'club-1', name: 'Stars FC', standingStatus: 'Good', trustScore: 100 }) }));
  state.athletes.set('ath-2', visibleAthlete({ id: 'ath-2', consentStatus: 'Missing' }));
  const as = scoutToken();
  const file = (body, token = as) => call('POST', '/api/flags', { as: token, body });

  assert.equal((await file(reportBody({ category: 'Nonsense' }))).status, 400);
  assert.equal((await file(reportBody({ details: 'hi' }))).status, 400);
  assert.equal((await file(reportBody(), unapprovedScoutToken())).body.code, 'SCOUT_NOT_APPROVED');
  assert.equal((await file(reportBody({ playerId: 'ath-2' }))).status, 404); // a scout cannot report what they cannot see
  assert.equal((await file(reportBody({ playerId: 'nobody' }))).status, 404);
  assert.equal((await call('POST', '/api/flags', { as: adminToken(), body: reportBody() })).status, 403);
  assert.equal(state.flags.length, 0);

  const ok = await file(reportBody({ category: 'Safeguarding concern', details: '  The photo shows   a different child ' }));
  assert.equal(ok.status, 201);
  assert.equal(state.flags[0].category, 'Safeguarding concern');
  assert.equal(state.flags[0].reason, 'The photo shows a different child');
  assert.deepEqual(sent.at(-1).to, ['admin@example.com']);
  assert.match(sent.at(-1).subject, /^URGENT: /); // safeguarding reports are flagged as urgent

  assert.equal((await file(reportBody())).status, 409); // already reported
  delete process.env.ADMIN_NOTIFY_EMAIL;
});

test('a coach cannot report an athlete from their own club', async () => {
  const as = addActiveCoach();
  state.athletes.set('ath-1', visibleAthlete());
  assert.equal((await call('POST', '/api/flags', { as, body: reportBody() })).status, 403);
});

test('a club is penalised only once five different people have reported its athletes', async () => {
  useFakeNotifier();
  const club = record({ id: 'club-1', name: 'Stars FC', standingStatus: 'Good', trustScore: 100 });
  state.athletes.set('ath-1', visibleAthlete({ Club: club }));
  for (const id of ['r1', 'r2', 'r3']) state.flags.push(record({ id: 'f-' + id, reporterId: id, playerId: 'ath-1', status: 'Pending' }));

  approveScout('scout-9');
  await call('POST', '/api/flags', { as: token('scout-9', { username: 'Aline', role: 'Scout' }), body: reportBody() });
  assert.equal(club.standingStatus, 'Good'); // four different reporters so far

  state.flags.push(record({ id: 'f-r5', reporterId: 'r5', playerId: 'ath-1', status: 'Pending' }));
  approveScout('scout-7');
  await call('POST', '/api/flags', { as: token('scout-7', { username: 'Bo', role: 'Scout' }), body: reportBody() });
  assert.equal(club.standingStatus, 'Penalized');
  assert.equal(club.trustScore, 85);
});

test('administrators review reports: safeguarding first, resolving needs a note and can hide the athlete', async () => {
  const sent = useFakeNotifier();
  const athlete = visibleAthlete();
  state.athletes.set('ath-1', athlete);
  state.clubs.set('club-1', record({ id: 'club-1', name: 'Stars FC' }));
  state.users.set('scout-9', record({ id: 'scout-9', username: 'Aline', role: 'Scout', email: 'aline@x.co' }));
  const flag = (id, category, ageMs) => record({
    id, reporterId: 'scout-9', playerId: 'ath-1', category, reason: 'Something is wrong here', status: 'Pending',
    createdAt: new Date(Date.now() - ageMs), Player: athlete, User: { username: 'Aline', role: 'Scout' },
  });
  state.flags.push(flag('f1', 'Inaccurate stats', 5000), flag('f2', 'Safeguarding concern', 1000));
  const admin = adminToken();
  const put = (id, body) => call('PUT', '/api/admin/reports/' + id, { as: admin, body });

  assert.equal((await call('GET', '/api/admin/reports', { as: scoutToken() })).body.code, 'NOT_ADMIN');
  const list = await call('GET', '/api/admin/reports', { as: admin });
  assert.deepEqual(list.body.map((r) => r.id), ['f2', 'f1']); // the safeguarding concern is first although it is newer
  assert.equal(list.body[0].athlete.name, 'Jean Paul Mugisha');
  assert.equal(list.body[0].club.name, 'Stars FC');
  assert.equal(list.body[0].reporter.username, 'Aline');

  assert.equal((await put('f2', { decision: 'maybe' })).status, 400);
  assert.equal((await put('f2', { decision: 'resolve' })).status, 400); // a note is required
  assert.equal((await put('nope', { decision: 'dismiss' })).status, 404);

  const resolved = await put('f2', { decision: 'resolve', reason: 'Photo removed and athlete hidden', hideAthlete: true });
  assert.equal(resolved.status, 200);
  assert.equal(state.flags[1].status, 'Resolved');
  assert.equal(state.flags[1].resolvedBy, 'admin-1');
  assert.equal(athlete.scoutHidden, true);
  assert.equal(athlete.scoutHiddenReason, 'Photo removed and athlete hidden');
  assert.equal(sent.at(-1).to, 'aline@x.co');
  assert.match(sent.at(-1).subject, /reviewed/);
  assert.ok(!sent.at(-1).text.includes('hidden')); // the reporter is not told what was done

  assert.equal((await call('GET', '/api/players/ath-1', { as: scoutToken() })).status, 404); // hidden athletes vanish for scouts

  assert.equal((await put('f1', { decision: 'dismiss' })).status, 200);
  assert.equal(state.flags[0].status, 'Dismissed');
  assert.equal(athlete.scoutHidden, true); // dismissing another report does not bring them back
  assert.equal((await put('f1', { decision: 'resolve', reason: 'x' })).status, 409);

  const done = await call('GET', '/api/admin/reports?status=Resolved', { as: admin });
  assert.equal(done.body[0].resolutionNote, 'Photo removed and athlete hidden');
  assert.equal(done.body[0].athlete.scoutHidden, true);
});

test('an administrator can hide an athlete from scouts and bring them back', async () => {
  const athlete = visibleAthlete();
  state.athletes.set('ath-1', athlete);
  const admin = adminToken();
  const visibility = (id, body, as = admin) => call('PUT', '/api/admin/players/' + id + '/scout-visibility', { as, body });

  assert.equal((await visibility('ath-1', { hidden: false }, scoutToken())).body.code, 'NOT_ADMIN');
  assert.equal((await visibility('ath-1', { hidden: true })).status, 400); // a reason is required to hide
  assert.equal((await visibility('nobody', { hidden: true, reason: 'x' })).status, 404);

  assert.equal((await visibility('ath-1', { hidden: true, reason: 'Under investigation' })).status, 200);
  assert.equal(athlete.scoutHidden, true);
  assert.equal((await call('GET', '/api/players/ath-1', { as: scoutToken() })).status, 404);

  assert.equal((await visibility('ath-1', { hidden: false })).status, 200);
  assert.equal(athlete.scoutHidden, false);
  assert.equal(athlete.scoutHiddenReason, null);
  assert.equal((await call('GET', '/api/players/ath-1', { as: scoutToken() })).status, 200);
});
