const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isDeletedAccount, deletedEmailFor, deletionBlocker, confirmationMatches, createAccountDeleter, REMOVED_MESSAGE
} = require('../services/accountDeletion');

const silent = { error: () => {} };

const build = ({ docs = [], clubUsers = [], athleteCount = 0, authStatus = 200 } = {}) => {
  const calls = { destroyed: [], updated: [], fetches: [] };
  const models = {
    User: {
      findAll: async () => clubUsers,
      update: async (values, { where }) => calls.updated.push(['User', values, where])
    },
    Player: { count: async () => athleteCount },
    Shortlist: { destroy: async ({ where }) => calls.destroyed.push(['Shortlist', where]) },
    ScoutProfile: { destroy: async ({ where }) => calls.destroyed.push(['ScoutProfile', where]) },
    VerificationDocument: {
      findAll: async () => docs,
      destroy: async ({ where }) => calls.destroyed.push(['VerificationDocument', where])
    },
    ContactRequest: { update: async (values, { where }) => calls.updated.push(['ContactRequest', values, where]) }
  };
  const fetchImpl = async (url, options) => {
    calls.fetches.push([url, options.method]);
    return { ok: authStatus < 400, status: authStatus };
  };
  const deleter = createAccountDeleter({
    sequelize: { transaction: async (work) => work({}) },
    models, supabaseUrl: 'https://x.supabase.co', serviceKey: 'key', fetchImpl, logger: silent
  });
  return { deleter, calls };
};

const scout = { id: 's1', email: 'Scout@Example.com', role: 'Scout' };
const owner = { id: 'c1', email: 'coach@x.rw', role: 'Coach', clubId: 'club1', clubRole: 'Owner', membershipStatus: 'Active' };

test('deleted accounts are recognised so their old tokens are refused', () => {
  assert.equal(isDeletedAccount({ email: deletedEmailFor('abc') }), true);
  assert.equal(isDeletedAccount({ email: 'real@example.com' }), false);
  assert.equal(isDeletedAccount(null), false);
});

test('confirmation must repeat the account email (case-insensitive)', () => {
  assert.equal(confirmationMatches(scout, ' scout@example.com '), true);
  assert.equal(confirmationMatches(scout, 'other@example.com'), false);
  assert.equal(confirmationMatches(scout, undefined), false);
});

test('a sole owner cannot leave athletes without a manager', () => {
  assert.match(deletionBlocker(owner, { clubUsers: [owner], athleteCount: 3 }), /3 athlete records/);
  assert.equal(deletionBlocker(owner, { clubUsers: [owner], athleteCount: 0 }), null);
  const second = { id: 'c2', clubRole: 'Owner', membershipStatus: 'Active' };
  assert.equal(deletionBlocker(owner, { clubUsers: [owner, second], athleteCount: 3 }), null);
  const member = { ...owner, clubRole: 'Member' };
  assert.equal(deletionBlocker(member, { clubUsers: [member], athleteCount: 3 }), null);
});

test('wrong confirmation changes nothing', async () => {
  const { deleter, calls } = build();
  const result = await deleter.deleteAccount(scout, 'nope');
  assert.equal(result.status, 400);
  assert.deepEqual(calls.updated, []);
  assert.deepEqual(calls.fetches, []);
});

test('admins cannot use it, and a missing service key changes nothing', async () => {
  const { deleter } = build();
  assert.equal((await deleter.deleteAccount({ ...scout, isAdmin: true }, scout.email)).status, 403);
  const off = createAccountDeleter({ sequelize: {}, models: {}, supabaseUrl: 'u', serviceKey: '' });
  assert.equal((await off.deleteAccount(scout, scout.email)).status, 503);
});

test('a scout is anonymised, their data removed and sign-in deleted', async () => {
  const { deleter, calls } = build({ docs: [{ storagePath: 's1/licence.pdf' }] });
  const result = await deleter.deleteAccount(scout, 'scout@example.com');
  assert.equal(result.ok, true);
  assert.deepEqual(calls.destroyed.map((d) => d[0]).sort(), ['ScoutProfile', 'Shortlist', 'VerificationDocument']);
  const user = calls.updated.find((u) => u[0] === 'User')[1];
  assert.equal(user.username, 'Deleted user');
  assert.equal(user.email, deletedEmailFor('s1'));
  assert.equal(user.phone, null);
  const messages = calls.updated.filter((u) => u[0] === 'ContactRequest');
  assert.equal(messages[0][1].message, REMOVED_MESSAGE);
  assert.equal(messages[1][1].status, 'Withdrawn');
  assert.deepEqual(calls.fetches.map((f) => f[1]), ['DELETE', 'DELETE']);
  assert.match(calls.fetches[0][0], /storage\/v1\/object\/verification-docs/);
  assert.match(calls.fetches[1][0], /auth\/v1\/admin\/users\/s1/);
});

test('a sole owner with athletes is refused and nothing is touched', async () => {
  const { deleter, calls } = build({ clubUsers: [owner], athleteCount: 2 });
  const result = await deleter.deleteAccount(owner, owner.email);
  assert.equal(result.status, 409);
  assert.deepEqual(calls.updated, []);
});

test('a failed sign-in removal does not undo the anonymisation', async () => {
  const { deleter } = build({ authStatus: 500 });
  assert.equal((await deleter.deleteAccount(scout, scout.email)).ok, true);
});
