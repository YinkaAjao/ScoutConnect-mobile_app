// lib/verification.js
const { normaliseName, isValidEmail } = require('./profile');

const DOC_TYPES = ['Registration Certificate', 'Federation Letter', 'Coach ID', 'Club Photo', 'Other'];
const MAX_DOCUMENTS = 5;
const MAX_STATEMENT = 1000;
const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png']; // matches the bucket's allowed_mime_types

/** The status the app should show: `isVerified` wins, so clubs verified before this feature existed still read as Verified. */
const verificationStatusOf = (club) => (club.isVerified ? 'Verified' : club.verificationStatus || 'Unverified');

/** What a club must have filled in before it can ask for review. */
const readinessChecklist = (club, athleteCount) => [
  { key: 'contactEmail', label: 'Official contact email', done: isValidEmail(club.contactEmail) },
  { key: 'contactPhone', label: 'Contact phone', done: !!normaliseName(club.contactPhone) },
  { key: 'region', label: 'District / region', done: !!normaliseName(club.region) },
  { key: 'entityType', label: 'Entity classification', done: !!normaliseName(club.entityType) },
  { key: 'athletes', label: 'At least one athlete on the roster', done: athleteCount > 0 },
];

const canRequestVerification = (club, athleteCount) =>
  ['Unverified', 'Rejected'].includes(verificationStatusOf(club)) && readinessChecklist(club, athleteCount).every((item) => item.done);

/**
 * Validates an owner's verification request. Document paths must sit inside the submitter's own storage folder, so a
 * request can never point the reviewer at somebody else's file.
 * Returns { error } or { statement, documents }.
 */
function validateSubmission(body, userId) {
  const statement = normaliseName(body?.statement);
  if (statement.length > MAX_STATEMENT) return { error: `The statement must be ${MAX_STATEMENT} characters or fewer.` };

  const documents = Array.isArray(body?.documents) ? body.documents : [];
  if (documents.length === 0) return { error: 'Attach at least one supporting document.' };
  if (documents.length > MAX_DOCUMENTS) return { error: `You can attach at most ${MAX_DOCUMENTS} documents.` };

  const clean = [];
  for (const doc of documents) {
    const path = typeof doc?.path === 'string' ? doc.path : '';
    if (!path.startsWith(`${userId}/`) || path.includes('..') || path.length > 255) {
      return { error: 'A document is not stored in your account folder. Please upload it again.' };
    }
    if (!DOC_TYPES.includes(doc.docType)) return { error: 'A document has an invalid type.' };
    const extension = path.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) return { error: 'Documents must be PDF, JPG or PNG files.' };
    clean.push({ docType: doc.docType, storagePath: path, fileName: normaliseName(doc.fileName).slice(0, 120) || null });
  }
  return { statement: statement || null, documents: clean };
}

module.exports = { ALLOWED_EXTENSIONS, DOC_TYPES, MAX_DOCUMENTS, MAX_STATEMENT, verificationStatusOf, readinessChecklist, canRequestVerification, validateSubmission };
