const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotifier } = require('../lib/notify');
const { newRequestEmail, decisionEmail } = require('../lib/emails');

const quietLogger = { error: () => {}, warn: () => {} };
const okFetch = (calls = []) => async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => '' }; };

test('sends through Resend with the key, sender and recipients', async () => {
  const calls = [];
  const notifier = createNotifier({ apiKey: 'key-1', from: 'ScoutConnect <no-reply@example.com>', fetchImpl: okFetch(calls), logger: quietLogger });
  const result = await notifier.send({ to: ['a@x.co', 'b@x.co'], subject: 'Hi', text: 'Body' });

  assert.deepEqual(result, { sent: true });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer key-1');
  assert.deepEqual(JSON.parse(calls[0].init.body), { from: 'ScoutConnect <no-reply@example.com>', to: ['a@x.co', 'b@x.co'], subject: 'Hi', text: 'Body' });
});

test('accepts a single address and ignores empty recipients', async () => {
  const calls = [];
  const notifier = createNotifier({ apiKey: 'k', from: 'f@x.co', fetchImpl: okFetch(calls), logger: quietLogger });
  await notifier.send({ to: 'solo@x.co', subject: 's', text: 't' });
  assert.deepEqual(JSON.parse(calls[0].init.body).to, ['solo@x.co']);

  assert.deepEqual(await notifier.send({ to: [], subject: 's', text: 't' }), { skipped: 'no recipients' });
  assert.deepEqual(await notifier.send({ to: [null, ''], subject: 's', text: 't' }), { skipped: 'no recipients' });
  assert.equal(calls.length, 1);
});

test('does nothing (and never calls the network) when not configured', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  for (const config of [{}, { apiKey: 'k' }, { from: 'f@x.co' }]) {
    const notifier = createNotifier({ ...config, fetchImpl, logger: quietLogger });
    assert.equal(notifier.enabled, false);
    assert.deepEqual(await notifier.send({ to: 'a@x.co', subject: 's', text: 't' }), { skipped: 'not configured' });
  }
  assert.equal(called, false);
});

test('never throws: provider errors, network errors and timeouts resolve to a failure', async () => {
  const logged = [];
  const logger = { error: (m) => logged.push(m) };

  const rejected = createNotifier({ apiKey: 'k', from: 'f@x.co', logger, fetchImpl: async () => ({ ok: false, status: 422, text: async () => 'bad domain' }) });
  assert.deepEqual(await rejected.send({ to: 'a@x.co', subject: 's', text: 't' }), { failed: true, status: 422 });

  const offline = createNotifier({ apiKey: 'k', from: 'f@x.co', logger, fetchImpl: async () => { throw new Error('ENOTFOUND'); } });
  assert.deepEqual(await offline.send({ to: 'a@x.co', subject: 's', text: 't' }), { failed: true });

  const slow = createNotifier({
    apiKey: 'k', from: 'f@x.co', logger, timeoutMs: 20,
    fetchImpl: (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
  });
  assert.deepEqual(await slow.send({ to: 'a@x.co', subject: 's', text: 't' }), { failed: true });

  assert.equal(logged.length, 3);
  assert.match(logged[0], /422/);
  assert.match(logged[2], /timed out/);
});

test('the admin email carries what a reviewer needs and nothing unsafe in the subject', () => {
  const email = newRequestEmail({
    club: { name: 'Rwanda\nStars  FC', entityType: 'Registered Club', region: 'Kigali' },
    owner: { username: 'Eric', email: 'eric@stars.rw' },
    documentCount: 2,
    athleteCount: 14,
  });
  assert.equal(email.subject, 'New verification request: Rwanda Stars FC');
  assert.match(email.text, /Athletes on roster: 14/);
  assert.match(email.text, /Documents attached: 2/);
  assert.match(email.text, /eric@stars\.rw/);
  assert.match(email.text, /Verification Review/);
});

test('owner emails explain each outcome and include the reason when there is one', () => {
  const club = { name: 'Rwanda Stars FC' };
  const approved = decisionEmail({ club, decision: 'approve' });
  assert.match(approved.subject, /is now verified/);
  assert.match(approved.text, /Verified badge/);

  const declined = decisionEmail({ club, decision: 'reject', reason: '  Certificate is   unreadable ' });
  assert.match(declined.subject, /more information needed/);
  assert.match(declined.text, /Reason: Certificate is unreadable/);
  assert.match(declined.text, /Club tab/);

  const revoked = decisionEmail({ club, decision: 'revoke', reason: 'Fraudulent documents' });
  assert.match(revoked.subject, /removed/);
  assert.match(revoked.text, /Fraudulent documents/);

  assert.match(decisionEmail({ club, decision: 'reject' }).text, /No reason was given/);
});
