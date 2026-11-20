import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecoveryLink } from './recoveryLink.ts';

test('reads tokens from the fragment (implicit flow)', () => {
  const link = 'scoutconnectfrontend://reset-password#access_token=abc.def&refresh_token=r123&expires_in=3600&type=recovery';
  assert.deepEqual(parseRecoveryLink(link), { kind: 'tokens', accessToken: 'abc.def', refreshToken: 'r123' });
});

test('reads a code from the query (PKCE flow)', () => {
  assert.deepEqual(parseRecoveryLink('scoutconnectfrontend://reset-password?code=xyz'), { kind: 'code', code: 'xyz' });
});

test('reports an expired or invalid link', () => {
  const link = 'scoutconnectfrontend://reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
  assert.deepEqual(parseRecoveryLink(link), { kind: 'error', message: 'Email link is invalid or has expired' });
});

test('ignores links with nothing usable', () => {
  assert.deepEqual(parseRecoveryLink(null), { kind: 'none' });
  assert.deepEqual(parseRecoveryLink('scoutconnectfrontend://reset-password'), { kind: 'none' });
  assert.deepEqual(parseRecoveryLink('scoutconnectfrontend://reset-password#access_token=only'), { kind: 'none' });
});
