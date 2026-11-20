// src/lib/recoveryLink.ts
// Reads the link in a Supabase password-reset email. Pure (no React Native imports) so plain Node can test it.

export type RecoveryLink =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

const parsePairs = (text: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const at = pair.indexOf('=');
    const key = at === -1 ? pair : pair.slice(0, at);
    const raw = at === -1 ? '' : pair.slice(at + 1);
    try {
      out[decodeURIComponent(key)] = decodeURIComponent(raw.replace(/\+/g, ' '));
    } catch {
      /* skip a malformed pair */
    }
  }
  return out;
};

/**
 * Supabase puts its answer after `#` (implicit flow: access_token + refresh_token) or after `?` (PKCE flow: code).
 * Errors, such as an expired link, come back the same way.
 */
export function parseRecoveryLink(url: string | null | undefined): RecoveryLink {
  if (!url) return { kind: 'none' };
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt + 1);
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);

  const params = { ...parsePairs(query), ...parsePairs(hash) };

  if (params.error_description || params.error) {
    return { kind: 'error', message: params.error_description || params.error };
  }
  if (params.access_token && params.refresh_token) {
    return { kind: 'tokens', accessToken: params.access_token, refreshToken: params.refresh_token };
  }
  if (params.code) return { kind: 'code', code: params.code };
  return { kind: 'none' };
}
