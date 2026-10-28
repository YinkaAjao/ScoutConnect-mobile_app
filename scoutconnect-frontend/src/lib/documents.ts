// src/lib/documents.ts
// Pure helpers (no React Native imports) so they can be unit-tested with plain Node.

/** Must match the bucket's file_size_limit and ALLOWED_EXTENSIONS in the backend. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export const isPdf = (nameOrPath: string): boolean => /\.pdf$/i.test(nameOrPath);

/** Picked files sometimes arrive without an extension; the server and bucket decide by extension, so add one. */
export const withExtension = (fileName: string, mimeType?: string | null): string => {
  if (/\.(pdf|jpe?g|png)$/i.test(fileName)) return fileName;
  const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg';
  return `${fileName}.${ext}`;
};

/** Content type to upload with, decided from the (already extension-corrected) file name. */
export const contentTypeFor = (fileName: string): string =>
  isPdf(fileName) ? 'application/pdf' : /\.png$/i.test(fileName) ? 'image/png' : 'image/jpeg';

/** Short label for a club's verification state, used wherever the app shows the verified badge. */
export const verificationLabel = (club?: { isVerified?: boolean; verificationStatus?: string | null } | null): string => {
  if (club?.isVerified) return 'Verified';
  if (club?.verificationStatus === 'Submitted') return 'Under Review';
  if (club?.verificationStatus === 'Rejected') return 'Verification Declined';
  return 'Not Verified';
};
