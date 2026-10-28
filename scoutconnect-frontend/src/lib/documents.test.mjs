import test from 'node:test';
import assert from 'node:assert/strict';
import { isPdf, withExtension, contentTypeFor, verificationLabel, MAX_FILE_BYTES } from './documents.ts';

test('isPdf is case-insensitive and checks the end of the name', () => {
  assert.equal(isPdf('cert.pdf'), true);
  assert.equal(isPdf('CERT.PDF'), true);
  assert.equal(isPdf('user-1/12345-cert.pdf'), true);
  assert.equal(isPdf('cert.pdf.png'), false);
  assert.equal(isPdf('cert'), false);
});

test('withExtension keeps valid names and adds one from the mime type otherwise', () => {
  assert.equal(withExtension('scan.jpeg'), 'scan.jpeg');
  assert.equal(withExtension('scan.PDF'), 'scan.PDF');
  assert.equal(withExtension('IMG_001', 'image/png'), 'IMG_001.png');
  assert.equal(withExtension('letter', 'application/pdf'), 'letter.pdf');
  assert.equal(withExtension('IMG_002'), 'IMG_002.jpg');
  assert.equal(withExtension('notes.txt', 'application/pdf'), 'notes.txt.pdf');
});

test('the upload content type follows the corrected file name (a PDF without an extension stays a PDF)', () => {
  assert.equal(contentTypeFor(withExtension('letter', 'application/pdf')), 'application/pdf');
  assert.equal(contentTypeFor('a.png'), 'image/png');
  assert.equal(contentTypeFor('a.jpg'), 'image/jpeg');
  assert.equal(contentTypeFor('a.jpeg'), 'image/jpeg');
});

test('size limit is 10 MB', () => {
  assert.equal(MAX_FILE_BYTES, 10485760);
});

test('verificationLabel reflects review progress', () => {
  assert.equal(verificationLabel({ isVerified: true }), 'Verified');
  assert.equal(verificationLabel({ verificationStatus: 'Submitted' }), 'Under Review');
  assert.equal(verificationLabel({ verificationStatus: 'Rejected' }), 'Verification Declined');
  assert.equal(verificationLabel({ verificationStatus: 'Unverified' }), 'Not Verified');
  assert.equal(verificationLabel(null), 'Not Verified');
});
