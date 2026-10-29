const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');
const {
  ORG_TYPES, publicName, ageFromDob, dobCutoffForUnder, isVisibleToScouts, visibleToScoutsWhere,
  toScoutAthlete, validateAccreditation, backfillConsentGrace, contactCooldownEnds, pruneAccessLog, CONTACT_COOLDOWN_DAYS
} = require('../lib/scouts');
const { scoutRequestEmail, scoutDecisionEmail, contactRequestEmail, contactResponseEmail } = require('../lib/emails');

const NOW = new Date('2026-10-29T12:00:00Z');

test('publicName keeps the first name and only the surname initial', () => {
  assert.equal(publicName('Jean Paul Mugisha'), 'Jean M.');
  assert.equal(publicName('  jean   mugisha '), 'jean M.');
  assert.equal(publicName('Aline'), 'Aline');
  assert.equal(publicName(''), 'Athlete');
  assert.equal(publicName(null), 'Athlete');
});

test('ageFromDob counts whole years and respects birthdays', () => {
  assert.equal(ageFromDob('2011-10-29', NOW), 15); // birthday today
  assert.equal(ageFromDob('2011-10-30', NOW), 14); // birthday tomorrow
  assert.equal(ageFromDob('2008-01-01', NOW), 18);
  assert.equal(ageFromDob('2027-01-01', NOW), null); // born in the future
  assert.equal(ageFromDob('garbage', NOW), null);
  assert.equal(ageFromDob(null, NOW), null);
});

test('"under N" cutoff: born after it means younger than N', () => {
  assert.equal(dobCutoffForUnder(15, NOW), '2011-10-29');
  // someone who turns 15 today is not under 15; someone who turns 15 tomorrow still is
  assert.ok(!('2011-10-29' > dobCutoffForUnder(15, NOW)));
  assert.ok('2011-10-30' > dobCutoffForUnder(15, NOW));
  assert.equal(ageFromDob('2011-10-30', NOW) < 15, true);
});

test('the cutoff for 29 February in a non-leap target year falls back to the 28th', () => {
  assert.equal(dobCutoffForUnder(17, new Date('2028-02-29T00:00:00Z')), '2011-02-28');
  assert.equal(dobCutoffForUnder(16, new Date('2028-02-29T00:00:00Z')), '2012-02-29'); // 2012 is a leap year
});

test('consent visibility: recorded consent, or a grace period that has not ended', () => {
  assert.equal(isVisibleToScouts({ consentStatus: 'Recorded' }, NOW), true);
  assert.equal(isVisibleToScouts({ consentStatus: 'Missing' }, NOW), false);
  assert.equal(isVisibleToScouts({ consentStatus: null, consentGraceUntil: new Date('2026-10-30T00:00:00Z') }, NOW), true);
  assert.equal(isVisibleToScouts({ consentStatus: null, consentGraceUntil: new Date('2026-10-28T00:00:00Z') }, NOW), false);
  assert.equal(isVisibleToScouts({ consentStatus: null }, NOW), false);
  assert.equal(isVisibleToScouts({ consentStatus: 'Missing', consentGraceUntil: new Date('2027-01-01') }, NOW), true); // grace still applies
});

test('the database condition mirrors the same rule', () => {
  assert.deepEqual(visibleToScoutsWhere(NOW), {
    [Op.and]: [
      { [Op.or]: [{ consentStatus: 'Recorded' }, { consentGraceUntil: { [Op.gt]: NOW } }] },
      { [Op.or]: [{ scoutHidden: false }, { scoutHidden: null }] },
    ],
  });
});

const athlete = () => ({
  id: 'p1', name: 'Jean Paul Mugisha', dateOfBirth: '2011-10-30', position: 'Center Back', profilePhoto: 'https://x/photo.jpg',
  consentGuardian: 'Secret Guardian', currentClubId: 'club-1', highlightVideo: 'https://x/video.mp4',
  Club: { name: 'Stars FC', isVerified: true, standingStatus: 'Good', trustScore: 90, contactEmail: 'info@stars.rw', contactPhone: '+250788000000' },
  Evaluations: [
    { id: 'e2', createdAt: '2026-03-01', evalType: 'Checklist', sprintSpeed: 4.1, dribblingScore: 4, overallRating: 4, strengths: 'private note', evaluatorName: 'Coach X', coachSignature: 'abc',
      checklistData: { averages: { technical: 3, tactical: 3, physical: 3, psychological: 3 }, evaluatorName: 'Coach X', strengths: 'private note' } },
    { id: 'e1', createdAt: '2026-01-01', evalType: 'Checklist', checklistData: null },
  ],
  MatchStats: [{ id: 'm1', competition: 'League', goals: 2, assists: 1, minutesPlayed: 90, cleanSheet: false }],
  Achievements: [{ id: 'a1', title: 'Golden Boot', year: 2025 }],
});

test('a scout sees a minimised athlete: masked name, age instead of date of birth, no club contact', () => {
  const dto = toScoutAthlete(athlete(), { now: NOW });
  assert.equal(dto.displayName, 'Jean M.');
  assert.equal(dto.identityRevealed, false);
  assert.equal(dto.age, 14);
  assert.equal(dto.profilePhoto, null); // no signed link was supplied, and the stored value is never used instead
  assert.deepEqual(dto.Club, { name: 'Stars FC', isVerified: true, standingStatus: 'Good', trustScore: 90 });

  const everything = JSON.stringify(dto);
  for (const secret of ['dateOfBirth', '2011-10-30', 'Mugisha', 'info@stars.rw', '788000000', 'Secret Guardian', 'video.mp4', 'photo.jpg', 'private note', 'Coach X', 'abc', 'consent', 'currentClubId']) {
    assert.ok(!everything.includes(secret), `leaked: ${secret}`);
  }
});

test('evaluations are sorted oldest to newest and carry only numeric ratings', () => {
  const dto = toScoutAthlete(athlete(), { now: NOW });
  assert.deepEqual(dto.Evaluations.map((e) => e.id), ['e1', 'e2']);
  assert.deepEqual(Object.keys(dto.Evaluations[1]).sort(), ['checklistData', 'createdAt', 'dribblingScore', 'evalType', 'id', 'overallRating', 'sprintSpeed']);
  assert.deepEqual(dto.Evaluations[1].checklistData, { averages: { technical: 3, tactical: 3, physical: 3, psychological: 3 } });
  assert.equal(dto.Evaluations[0].checklistData, null);
});

test('body measurements reach scouts field by field, range-checked, with the coach\'s notes left out', () => {
  const row = athlete();
  row.Evaluations[0].checklistData = {
    averages: { technical: 4 }, heightCm: 178, weightKg: 66.5, dominantFoot: 'Left', sprint10m: 1.8, bleepLevel: 99,
    evaluatorName: 'Coach X', strengths: 'private note', coachSignature: 'abc'
  };
  const accepted = { id: 'r1', status: 'Accepted' };
  const dto = toScoutAthlete(row, { now: NOW, request: accepted });
  const latest = dto.Evaluations.find((e) => e.id === 'e2');
  assert.deepEqual(latest.checklistData, { averages: { technical: 4 }, body: { heightCm: 178, weightKg: 66.5, sprint10m: 1.8, dominantFoot: 'Left' } }); // bleep 99 is implausible
  assert.ok(!JSON.stringify(dto).includes('private note'));

  // Height and weight are held back until the club accepts that scout's request; the other measurements are not.
  for (const request of [undefined, { id: 'r2', status: 'Pending' }, { id: 'r3', status: 'Declined', respondedAt: '2026-01-01' }]) {
    const hidden = toScoutAthlete(row, { now: NOW, request }).Evaluations.find((e) => e.id === 'e2');
    assert.deepEqual(hidden.checklistData.body, { sprint10m: 1.8, dominantFoot: 'Left' });
  }

  row.Evaluations[0].checklistData = { heightCm: 'tall', weightKg: 5, dominantFoot: 'Banana' };
  assert.equal(toScoutAthlete(row, { now: NOW, request: accepted }).Evaluations.find((e) => e.id === 'e2').checklistData, null);
});

test('an accepted request reveals the full name and the club contact, and nothing else changes', () => {
  const dto = toScoutAthlete(athlete(), { now: NOW, request: { id: 'r1', status: 'Accepted', responseNote: 'Call after 5pm' } });
  assert.equal(dto.displayName, 'Jean Paul Mugisha');
  assert.equal(dto.identityRevealed, true);
  assert.equal(dto.Club.contactEmail, 'info@stars.rw');
  assert.equal(dto.Club.contactPhone, '+250788000000');
  assert.deepEqual(dto.contactRequest, { id: 'r1', status: 'Accepted', responseNote: 'Call after 5pm', canRequestAgainAt: null });
  assert.ok(!JSON.stringify(dto).includes('2011-10-30')); // still no date of birth
});

test('pending and declined requests reveal nothing', () => {
  for (const status of ['Pending', 'Declined']) {
    const dto = toScoutAthlete(athlete(), { now: NOW, request: { id: 'r', status, responseNote: 'no' } });
    assert.equal(dto.displayName, 'Jean M.');
    assert.equal(dto.Club.contactEmail, undefined);
  }
  assert.equal(toScoutAthlete(athlete(), { now: NOW, request: { id: 'r', status: 'Pending', responseNote: 'x' } }).contactRequest.responseNote, null);
  assert.equal(toScoutAthlete(athlete(), { now: NOW }).contactRequest, null);
});

const docs = (userId) => [{ path: `${userId}/licence.pdf`, docType: 'Other', fileName: 'licence.pdf' }];

test('accreditation needs an organisation, a valid type and at least one document', () => {
  const ok = validateAccreditation({ organisation: '  Kigali  Scouts ', orgType: ORG_TYPES[0], licenceNumber: ' L-77 ', statement: 'Hello', documents: docs('u1') }, 'u1');
  assert.equal(ok.error, undefined);
  assert.equal(ok.organisation, 'Kigali Scouts');
  assert.equal(ok.licenceNumber, 'L-77');
  assert.equal(ok.documents[0].storagePath, 'u1/licence.pdf');

  assert.match(validateAccreditation({ orgType: ORG_TYPES[0], documents: docs('u1') }, 'u1').error, /organisation/);
  assert.match(validateAccreditation({ organisation: 'X', orgType: 'Wizard', documents: docs('u1') }, 'u1').error, /kind of scout/);
  assert.match(validateAccreditation({ organisation: 'X', orgType: ORG_TYPES[0], documents: [] }, 'u1').error, /at least one/);
  assert.match(validateAccreditation({ organisation: 'X', orgType: ORG_TYPES[0], documents: docs('someone-else') }, 'u1').error, /account folder/);
  assert.match(validateAccreditation({ organisation: 'x'.repeat(121), orgType: ORG_TYPES[0], documents: docs('u1') }, 'u1').error, /120/);
  assert.equal(validateAccreditation({ organisation: 'X', orgType: ORG_TYPES[0], documents: docs('u1') }, 'u1').licenceNumber, null);
});

test('the consent grace period only touches legacy athletes and lasts three days', async () => {
  let call;
  const Player = { update: async (values, options) => { call = { values, options }; return [7]; } };
  const count = await backfillConsentGrace(Player, { now: NOW });
  assert.equal(count, 7);
  assert.deepEqual(call.options.where, { consentStatus: null, consentGraceUntil: null });
  assert.equal(call.values.consentGraceUntil.toISOString(), '2026-11-01T12:00:00.000Z');
});

test('scout and contact emails say the right thing and never expose more than intended', () => {
  const admin = scoutRequestEmail({ scout: { username: 'Aline', email: 'a@x.co' }, profile: { organisation: 'Kigali Scouts', orgType: 'Agent', licenceNumber: 'L1' }, documentCount: 2 });
  assert.match(admin.subject, /Aline/);
  assert.match(admin.text, /Kigali Scouts/);
  assert.match(admin.text, /Verification Review > Scouts/);

  assert.match(scoutDecisionEmail({ decision: 'approve' }).subject, /approved/);
  assert.match(scoutDecisionEmail({ decision: 'reinstate' }).subject, /restored/);
  assert.match(scoutDecisionEmail({ decision: 'reject', reason: 'Licence unreadable' }).text, /Licence unreadable/);
  assert.match(scoutDecisionEmail({ decision: 'suspend', reason: 'Misuse' }).subject, /suspended/);

  const toClub = contactRequestEmail({ club: { name: 'Stars FC' }, athleteName: 'Jean Paul Mugisha', scout: { username: 'Aline' }, organisation: 'Kigali Scouts', message: 'We would like a trial.' });
  assert.match(toClub.text, /We would like a trial\./);
  assert.match(toClub.text, /Nothing about the athlete or your club is shared until you accept/);

  const accepted = contactResponseEmail({ decision: 'accept', athleteName: 'Jean M.', clubName: 'Stars FC', note: 'Call us' });
  assert.match(accepted.subject, /accepted/);
  assert.match(accepted.text, /Note from the club: Call us/);
  assert.match(contactResponseEmail({ decision: 'decline', athleteName: 'Jean M.', clubName: 'Stars FC' }).subject, /declined/);
});

test('the photo comes only from the signed link the server supplies', () => {
  const dto = toScoutAthlete(athlete(), { now: NOW, photoUrl: 'https://signed.example/abc?token=T' });
  assert.equal(dto.profilePhoto, 'https://signed.example/abc?token=T');
  assert.ok(!JSON.stringify(dto).includes('x/photo.jpg')); // the permanent stored value is not in the response
});

test('an administrator can hide an athlete from scouts, whatever their consent says', () => {
  assert.equal(isVisibleToScouts({ consentStatus: 'Recorded', scoutHidden: true }, NOW), false);
  assert.equal(isVisibleToScouts({ consentStatus: null, consentGraceUntil: new Date('2026-12-01'), scoutHidden: true }, NOW), false);
  assert.equal(isVisibleToScouts({ consentStatus: 'Recorded', scoutHidden: false }, NOW), true);
  assert.equal(isVisibleToScouts({ consentStatus: 'Recorded', scoutHidden: null }, NOW), true);
});

test('after a decline the scout must wait 30 days, counted from the answer', () => {
  assert.equal(CONTACT_COOLDOWN_DAYS, 30);
  const declined = { status: 'Declined', respondedAt: '2026-10-20T12:00:00Z' };
  assert.equal(contactCooldownEnds(declined, NOW).toISOString(), '2026-11-19T12:00:00.000Z');
  assert.equal(contactCooldownEnds({ ...declined, respondedAt: '2026-09-01T00:00:00Z' }, NOW), null); // long ago
  assert.equal(contactCooldownEnds({ status: 'Accepted', respondedAt: '2026-10-20T12:00:00Z' }, NOW), null);
  assert.equal(contactCooldownEnds({ status: 'Pending' }, NOW), null);
  assert.equal(contactCooldownEnds(null, NOW), null);
});

test('the DTO tells the app when it may ask again', () => {
  const declined = { id: 'r9', status: 'Declined', responseNote: 'Not now', respondedAt: '2026-10-20T12:00:00Z' };
  assert.equal(toScoutAthlete(athlete(), { now: NOW, request: declined }).contactRequest.canRequestAgainAt, '2026-11-19T12:00:00.000Z');
  const old = { ...declined, respondedAt: '2026-08-01T00:00:00Z' };
  assert.equal(toScoutAthlete(athlete(), { now: NOW, request: old }).contactRequest.canRequestAgainAt, null);
});

test('the access log keeps 90 days and deletes the rest', async () => {
  let options;
  const model = { destroy: async (o) => { options = o; return 12; } };
  assert.equal(await pruneAccessLog(model, { now: NOW }), 12);
  assert.equal(options.where.createdAt[Op.lt].toISOString(), '2026-07-31T12:00:00.000Z');
});
