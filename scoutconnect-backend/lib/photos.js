// lib/photos.js
// Athlete photos live in a PRIVATE Supabase Storage bucket. The database stores only the file's path, and the server
// hands out short-lived signed links to the people allowed to see a photo (approved scouts, the athlete's own club).

const PUBLIC_MARKER = '/storage/v1/object/public/';

/**
 * The storage path for whatever is saved in `Player.profilePhoto`.
 * - A plain path ("userId/file.jpg") is returned as it is.
 * - A public URL of this bucket (how photos were stored before they became private) is turned back into its path.
 * - Anything else (another host, e.g. the old server's uploads folder) has no path: it cannot be served privately.
 */
function photoPath(value, bucket) {
  if (!value || typeof value !== 'string') return null;

  let path;
  if (/^https?:\/\//i.test(value)) {
    const marker = `${PUBLIC_MARKER}${bucket}/`;
    const at = value.indexOf(marker);
    if (at === -1) return null;
    try {
      path = decodeURIComponent(value.slice(at + marker.length).split('?')[0]);
    } catch {
      return null;
    }
  } else {
    path = value.replace(/^\/+/, '');
  }

  return path && !path.includes('..') ? path : null;
}

/**
 * Signs many photos with one request to Supabase Storage, using the service-role key (kept on the server only).
 * `sign()` never throws; a photo that cannot be signed is simply missing from the result, so it shows as "no photo".
 */
function createPhotoSigner({ supabaseUrl, serviceKey, bucket = 'athlete-photos', expiresIn = 3600, fetchImpl = fetch, logger = console }) {
  const enabled = Boolean(supabaseUrl && serviceKey);

  return {
    enabled,
    bucket,
    /** @param {(string|null|undefined)[]} values stored photo values  @returns {Promise<Map<string,string>>} stored value -> signed URL */
    async sign(values) {
      const signed = new Map();
      if (!enabled) return signed;

      const valuesByPath = new Map(); // path -> stored values that point at it
      for (const value of new Set(values.filter(Boolean))) {
        const path = photoPath(value, bucket);
        if (!path) continue;
        if (!valuesByPath.has(path)) valuesByPath.set(path, []);
        valuesByPath.get(path).push(value);
      }
      if (valuesByPath.size === 0) return signed;

      try {
        const response = await fetchImpl(`${supabaseUrl}/storage/v1/object/sign/${bucket}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn, paths: [...valuesByPath.keys()] })
        });
        if (!response.ok) {
          logger.error(`Photo signing failed (Storage ${response.status}).`);
          return signed;
        }
        for (const item of await response.json()) {
          if (!item?.signedURL || item.error) continue;
          for (const value of valuesByPath.get(item.path) || []) signed.set(value, `${supabaseUrl}/storage/v1${item.signedURL}`);
        }
      } catch (error) {
        logger.error(`Photo signing failed: ${error.message}`);
      }
      return signed;
    }
  };
}

module.exports = { photoPath, createPhotoSigner };
