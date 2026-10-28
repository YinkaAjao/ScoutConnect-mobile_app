const test = require('node:test');
const assert = require('node:assert/strict');
const { photoPath, createPhotoSigner } = require('../lib/photos');

const BUCKET = 'athlete-photos';
const URL_BASE = 'https://proj.supabase.co';
const quiet = { error: () => {} };

test('a stored plain path stays a path', () => {
  assert.equal(photoPath('user-1/abc.jpg', BUCKET), 'user-1/abc.jpg');
  assert.equal(photoPath('/user-1/abc.jpg', BUCKET), 'user-1/abc.jpg');
});

test('a public URL from before the bucket was private is turned back into its path', () => {
  assert.equal(photoPath(`${URL_BASE}/storage/v1/object/public/${BUCKET}/user-1/abc.jpg`, BUCKET), 'user-1/abc.jpg');
  assert.equal(photoPath(`${URL_BASE}/storage/v1/object/public/${BUCKET}/user-1/a%20b.jpg?t=123`, BUCKET), 'user-1/a b.jpg');
});

test('values that cannot be served privately have no path', () => {
  assert.equal(photoPath('https://old-server.example/uploads/1-photo.jpg', BUCKET), null);
  assert.equal(photoPath(`${URL_BASE}/storage/v1/object/public/other-bucket/x.jpg`, BUCKET), null);
  assert.equal(photoPath('../secrets/key.pem', BUCKET), null);
  assert.equal(photoPath('user/../../other.jpg', BUCKET), null);
  assert.equal(photoPath('', BUCKET), null);
  assert.equal(photoPath(null, BUCKET), null);
  assert.equal(photoPath(42, BUCKET), null);
});

const okFetch = (calls) => async (url, init) => {
  calls.push({ url, init });
  const { paths } = JSON.parse(init.body);
  return { ok: true, status: 200, json: async () => paths.map((path) => ({ path, signedURL: `/object/sign/${BUCKET}/${path}?token=T-${path}`, error: null })) };
};

test('signs many photos with ONE request, using the service key and the right bucket', async () => {
  const calls = [];
  const signer = createPhotoSigner({ supabaseUrl: URL_BASE, serviceKey: 'service-key', fetchImpl: okFetch(calls), logger: quiet });
  const result = await signer.sign(['u1/a.jpg', 'u2/b.jpg', 'u1/a.jpg', null]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${URL_BASE}/storage/v1/object/sign/${BUCKET}`);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer service-key');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.paths, ['u1/a.jpg', 'u2/b.jpg']); // de-duplicated, empty values dropped
  assert.equal(body.expiresIn, 3600);

  assert.equal(result.get('u1/a.jpg'), `${URL_BASE}/storage/v1/object/sign/${BUCKET}/u1/a.jpg?token=T-u1/a.jpg`);
  assert.equal(result.size, 2);
});

test('old public-URL values are signed by their path and keyed by what is stored', async () => {
  const calls = [];
  const signer = createPhotoSigner({ supabaseUrl: URL_BASE, serviceKey: 'k', fetchImpl: okFetch(calls), logger: quiet });
  const stored = `${URL_BASE}/storage/v1/object/public/${BUCKET}/u1/a.jpg`;
  const result = await signer.sign([stored]);
  assert.deepEqual(JSON.parse(calls[0].init.body).paths, ['u1/a.jpg']);
  assert.ok(result.get(stored).includes('/object/sign/'));
  assert.ok(!result.get(stored).includes('/object/public/')); // the permanent public link is never handed out
});

test('without a service key nothing is signed and no request is made', async () => {
  let called = false;
  const signer = createPhotoSigner({ supabaseUrl: URL_BASE, serviceKey: undefined, fetchImpl: async () => { called = true; }, logger: quiet });
  assert.equal(signer.enabled, false);
  assert.equal((await signer.sign(['u1/a.jpg'])).size, 0);
  assert.equal(called, false);
});

test('values with no usable path never reach Storage', async () => {
  let called = false;
  const signer = createPhotoSigner({ supabaseUrl: URL_BASE, serviceKey: 'k', fetchImpl: async () => { called = true; }, logger: quiet });
  assert.equal((await signer.sign(['https://old-server.example/uploads/x.jpg', '../x'])).size, 0);
  assert.equal(called, false);
});

test('failures never throw: a Storage error, a network error, or one bad item just means missing photos', async () => {
  const logged = [];
  const logger = { error: (m) => logged.push(m) };

  const rejected = createPhotoSigner({ supabaseUrl: URL_BASE, serviceKey: 'k', logger, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.equal((await rejected.sign(['u1/a.jpg'])).size, 0);

  const offline = createPhotoSigner({ supabaseUrl: URL_BASE, serviceKey: 'k', logger, fetchImpl: async () => { throw new Error('ENOTFOUND'); } });
  assert.equal((await offline.sign(['u1/a.jpg'])).size, 0);

  const partial = createPhotoSigner({
    supabaseUrl: URL_BASE, serviceKey: 'k', logger,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => [
      { path: 'u1/a.jpg', signedURL: '/object/sign/athlete-photos/u1/a.jpg?token=T', error: null },
      { path: 'u1/missing.jpg', signedURL: null, error: 'Object not found' },
    ] }),
  });
  const result = await partial.sign(['u1/a.jpg', 'u1/missing.jpg']);
  assert.deepEqual([...result.keys()], ['u1/a.jpg']);
  assert.equal(logged.length, 2);
});
