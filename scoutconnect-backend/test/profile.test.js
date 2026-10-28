const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliseName, isValidDob, isValidEmail, profileFromClaims } = require('../lib/profile');

test('normaliseName collapses whitespace and trims', () => {
  assert.equal(normaliseName('  Jean   Paul \n Mugisha '), 'Jean Paul Mugisha');
  assert.equal(normaliseName(null), '');
  assert.equal(normaliseName(undefined), '');
});

test('isValidDob accepts real dates only', () => {
  assert.equal(isValidDob('2008-02-29'), true);
  assert.equal(isValidDob('2009-02-29'), false); // not a leap year
  assert.equal(isValidDob('2008-13-01'), false);
  assert.equal(isValidDob('08-01-2008'), false);
  assert.equal(isValidDob(''), false);
  assert.equal(isValidDob(null), false);
});

test('isValidEmail', () => {
  assert.equal(isValidEmail('coach@academy.rw'), true);
  assert.equal(isValidEmail('coach@academy'), false);
  assert.equal(isValidEmail(''), false);
});

const claims = (meta, extra = {}) => ({ sub: 'u1', email: 'Coach@Academy.rw', user_metadata: meta, ...extra });

test('scout registration needs only name and role', () => {
  const { profile, error } = profileFromClaims(claims({ username: ' Aline  K ', role: 'Scout' }));
  assert.equal(error, undefined);
  assert.deepEqual(profile, { id: 'u1', email: 'coach@academy.rw', username: 'Aline K', phone: null, role: 'Scout' });
});

test('coach joining an existing club', () => {
  const { profile } = profileFromClaims(claims({ username: 'Eric', role: 'Coach', clubId: 'club-1', phone: '+250 788 000 111' }));
  assert.equal(profile.clubId, 'club-1');
  assert.equal(profile.phone, '+250 788 000 111');
  assert.equal(profile.newClub, undefined);
});

test('coach registering a new club needs a valid entity type', () => {
  const ok = profileFromClaims(claims({ username: 'Eric', role: 'Coach', newClubName: ' Rwanda  Stars ', newClubEntityType: 'Registered Club', newClubRegion: 'Kigali' }));
  assert.equal(ok.profile.newClub.name, 'Rwanda Stars');
  assert.equal(ok.profile.newClub.entityType, 'Registered Club');

  const bad = profileFromClaims(claims({ username: 'Eric', role: 'Coach', newClubName: 'Rwanda Stars', newClubEntityType: 'Casino' }));
  assert.match(bad.error, /entity classification/);
});

test('rejects incomplete or invalid registrations', () => {
  assert.match(profileFromClaims(claims({ role: 'Scout' })).error, /no name/);
  assert.match(profileFromClaims(claims({ username: 'X', role: 'Admin' })).error, /valid role/);
  assert.match(profileFromClaims(claims({ username: 'X', role: 'Coach' })).error, /select or register/);
  assert.match(profileFromClaims(claims({ username: 'X', role: 'Coach', newClubName: 'A', newClubEntityType: 'Registered Club', newClubContactEmail: 'nope' })).error, /contact email/);
  assert.match(profileFromClaims({ sub: 'u1', user_metadata: { username: 'X', role: 'Scout' } }).error, /no email/);
  assert.match(profileFromClaims({ email: 'a@b.co', user_metadata: {} }).error, /no subject/);
});
