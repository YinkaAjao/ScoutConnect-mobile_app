const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createTokenVerifier } = require('../lib/auth');

const URL_BASE = 'https://example-project.supabase.co';
const ISS = `${URL_BASE}/auth/v1`;

const makeKeys = (kid) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' } };
};

const jwksFetch = (keys, counter = { calls: 0 }) => async () => {
  counter.calls += 1;
  return { ok: true, status: 200, json: async () => ({ keys: keys.map((k) => k.jwk) }) };
};

const sign = (key, claims = {}, options = {}) =>
  jwt.sign({ sub: 'user-1', aud: 'authenticated', iss: ISS, ...claims }, key.privateKey, { algorithm: 'ES256', keyid: key.kid, expiresIn: '1h', ...options });

test('accepts a valid ES256 token and caches the signing keys', async () => {
  const key = makeKeys('k1');
  const counter = { calls: 0 };
  const verify = createTokenVerifier({ supabaseUrl: URL_BASE, fetchImpl: jwksFetch([key], counter) });

  assert.equal((await verify(sign(key))).sub, 'user-1');
  assert.equal((await verify(sign(key))).sub, 'user-1');
  assert.equal(counter.calls, 1);
});

test('rejects a token signed by a different key that claims a known kid', async () => {
  const real = makeKeys('k1');
  const attacker = makeKeys('k1');
  const verify = createTokenVerifier({ supabaseUrl: URL_BASE, fetchImpl: jwksFetch([real]) });
  await assert.rejects(verify(sign(attacker)), /invalid signature/);
});

test('rejects wrong issuer, wrong audience and expired tokens', async () => {
  const key = makeKeys('k1');
  const verify = createTokenVerifier({ supabaseUrl: URL_BASE, fetchImpl: jwksFetch([key]) });
  await assert.rejects(verify(sign(key, { iss: 'https://evil.example/auth/v1' })), /issuer/);
  await assert.rejects(verify(sign(key, { aud: 'anon' })), /audience/);
  await assert.rejects(verify(sign(key, {}, { expiresIn: -10 })), /expired/);
});

test('rejects tokens whose kid is not published', async () => {
  const known = makeKeys('k1');
  const unknown = makeKeys('k2');
  const verify = createTokenVerifier({ supabaseUrl: URL_BASE, fetchImpl: jwksFetch([known]) });
  await assert.rejects(verify(sign(unknown)), /No Supabase signing key/);
});

test('refuses HS256 tokens when no secret is configured (no placeholder fallback)', async () => {
  const forged = jwt.sign({ sub: 'attacker', aud: 'authenticated' }, 'your-supabase-jwt-secret', { algorithm: 'HS256' });
  const verify = createTokenVerifier({ supabaseUrl: URL_BASE, fetchImpl: jwksFetch([]) });
  await assert.rejects(verify(forged), /HS256 tokens are not accepted/);
});

test('accepts HS256 tokens signed with the configured secret and rejects other secrets', async () => {
  const verify = createTokenVerifier({ supabaseUrl: URL_BASE, jwtSecret: 's3cret', fetchImpl: jwksFetch([]) });
  const good = jwt.sign({ sub: 'u' }, 's3cret', { algorithm: 'HS256' });
  const bad = jwt.sign({ sub: 'u' }, 'other', { algorithm: 'HS256' });
  assert.equal((await verify(good)).sub, 'u');
  await assert.rejects(verify(bad), /invalid signature/);
});

test('rejects malformed tokens', async () => {
  const verify = createTokenVerifier({ supabaseUrl: URL_BASE, fetchImpl: jwksFetch([]) });
  await assert.rejects(verify('not-a-jwt'), /Malformed token/);
});
