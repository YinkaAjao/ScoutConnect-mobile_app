// lib/auth.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * Builds a Supabase access-token verifier.
 * - HS256 tokens (legacy projects) are checked with the shared JWT secret.
 * - ES256/RS256 tokens (asymmetric signing keys) are checked against the project's public JWKS.
 * `supabaseUrl` is pinned by the caller and never read from the token, so a forged `iss` can't redirect verification.
 */
function createTokenVerifier({ supabaseUrl, jwtSecret, fetchImpl = fetch, now = Date.now }) {
  const cache = { keys: new Map(), fetchedAt: 0 };

  async function getSigningKey(kid) {
    if (cache.keys.has(kid)) return cache.keys.get(kid);
    if (now() - cache.fetchedAt < 60000) return null; // throttle refetches for unknown kids
    const res = await fetchImpl(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
    if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
    const { keys } = await res.json();
    cache.fetchedAt = now();
    for (const jwk of keys) cache.keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    return cache.keys.get(kid) || null;
  }

  return async function verifySupabaseToken(token) {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) throw new Error('Malformed token');
    const { alg, kid } = decoded.header;
    if (alg === 'HS256') {
      // Never fall back to a placeholder secret: without a real one, HS256 tokens could be forged by anyone.
      if (!jwtSecret) throw new Error('HS256 tokens are not accepted (no SUPABASE_JWT_SECRET configured)');
      return jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    }
    const key = await getSigningKey(kid);
    if (!key) throw new Error(`No Supabase signing key found for kid ${kid}`);
    return jwt.verify(token, key, {
      algorithms: ['ES256', 'RS256'],
      issuer: `${supabaseUrl}/auth/v1`,
      audience: 'authenticated'
    });
  };
}

module.exports = { createTokenVerifier };
