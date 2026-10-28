const test = require('node:test');
const assert = require('node:assert/strict');
const { verificationStatusOf, readinessChecklist, canRequestVerification, validateSubmission } = require('../lib/verification');

const completeClub = { contactEmail: 'info@club.rw', contactPhone: '+250 788 000 000', region: 'Kigali', entityType: 'Registered Club' };

test('isVerified wins, so clubs verified before this feature still read as Verified', () => {
  assert.equal(verificationStatusOf({ isVerified: true, verificationStatus: 'Unverified' }), 'Verified');
  assert.equal(verificationStatusOf({ isVerified: false, verificationStatus: 'Submitted' }), 'Submitted');
  assert.equal(verificationStatusOf({ isVerified: false }), 'Unverified');
});

test('the checklist flags every missing detail', () => {
  const items = readinessChecklist({ contactEmail: 'not-an-email' }, 0);
  assert.deepEqual(items.map((i) => i.done), [false, false, false, false, false]);
  assert.ok(readinessChecklist(completeClub, 3).every((i) => i.done));
});

test('only unverified or rejected clubs with a complete checklist can request review', () => {
  assert.equal(canRequestVerification({ ...completeClub }, 1), true);
  assert.equal(canRequestVerification({ ...completeClub, verificationStatus: 'Rejected' }, 1), true);
  assert.equal(canRequestVerification({ ...completeClub, verificationStatus: 'Submitted' }, 1), false);
  assert.equal(canRequestVerification({ ...completeClub, isVerified: true }, 1), false);
  assert.equal(canRequestVerification({ ...completeClub }, 0), false); // no athletes
});

const doc = (path, docType = 'Registration Certificate') => ({ path, docType, fileName: ' cert.jpg ' });

test('a valid submission is cleaned and accepted', () => {
  const result = validateSubmission({ statement: '  We are   registered ', documents: [doc('user-1/a.jpg')] }, 'user-1');
  assert.equal(result.error, undefined);
  assert.equal(result.statement, 'We are registered');
  assert.deepEqual(result.documents, [{ docType: 'Registration Certificate', storagePath: 'user-1/a.jpg', fileName: 'cert.jpg' }]);
});

test('submissions need documents, and only from the submitter\'s own folder', () => {
  assert.match(validateSubmission({ documents: [] }, 'user-1').error, /at least one/);
  assert.match(validateSubmission({}, 'user-1').error, /at least one/);
  assert.match(validateSubmission({ documents: [doc('someone-else/a.jpg')] }, 'user-1').error, /account folder/);
  assert.match(validateSubmission({ documents: [doc('user-1/../other/a.jpg')] }, 'user-1').error, /account folder/);
  assert.match(validateSubmission({ documents: [doc('user-12/a.jpg')] }, 'user-1').error, /account folder/); // prefix must end at the slash
});

test('submissions reject unknown document types, too many files and over-long statements', () => {
  assert.match(validateSubmission({ documents: [doc('user-1/a.jpg', 'Selfie')] }, 'user-1').error, /invalid type/);
  const six = Array.from({ length: 6 }, (_, i) => doc(`user-1/${i}.jpg`));
  assert.match(validateSubmission({ documents: six }, 'user-1').error, /at most 5/);
  assert.match(validateSubmission({ statement: 'x'.repeat(1001), documents: [doc('user-1/a.jpg')] }, 'user-1').error, /1000/);
});

test('PDF, JPG and PNG are accepted; other file types are rejected', () => {
  for (const name of ['a.pdf', 'a.PDF', 'a.jpg', 'a.JPEG', 'a.png']) {
    assert.equal(validateSubmission({ documents: [doc(`user-1/${name}`)] }, 'user-1').error, undefined, name);
  }
  for (const name of ['a.exe', 'a.html', 'a.svg', 'a', 'a.pdf.exe']) {
    assert.match(validateSubmission({ documents: [doc(`user-1/${name}`)] }, 'user-1').error, /PDF, JPG or PNG/, name);
  }
});
