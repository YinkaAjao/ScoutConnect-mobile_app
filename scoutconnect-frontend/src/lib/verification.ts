// src/lib/verification.ts
import { supabase } from './supabase';
import { MAX_FILE_BYTES, contentTypeFor, withExtension } from './documents';

export const VERIFICATION_BUCKET = 'verification-docs';
export { MAX_FILE_BYTES, ALLOWED_MIME_TYPES, isPdf, withExtension, verificationLabel } from './documents';

// Must match DOC_TYPES in scoutconnect-backend/lib/verification.js
export const DOC_TYPES = ['Registration Certificate', 'Federation Letter', 'Coach ID', 'Club Photo', 'Other'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export type VerificationStatus = 'Unverified' | 'Submitted' | 'Verified' | 'Rejected';

export interface ChecklistItem { key: string; label: string; done: boolean; }

export interface VerificationInfo {
  status: VerificationStatus;
  rejectionReason: string | null;
  statement: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  checklist: ChecklistItem[];
  canRequest: boolean;
  isOwner: boolean;
  documents: { id: string; docType: string; fileName: string | null }[];
  history: { action: string; note: string | null; at: string }[];
}

/**
 * Uploads a document photo to the private bucket under the signed-in user's own folder and returns its storage path.
 * Needs the `verification-docs` bucket and policies from the setup SQL.
 */
export async function uploadVerificationDocument(userId: string, uri: string, fileName: string): Promise<string> {
  const storedName = withExtension(fileName);
  const safeName = storedName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `${userId}/${Date.now()}-${safeName}`;

  const response = await fetch(uri); // local file:// or content:// URI
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`${fileName} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);

  const { error } = await supabase.storage.from(VERIFICATION_BUCKET).upload(path, bytes, {
    contentType: contentTypeFor(storedName),
    upsert: false,
  });
  if (error) throw new Error(`Could not upload ${fileName}: ${error.message}`);
  return path;
}

/** Short-lived link a reviewer can open; only works for admins (and the file's owner) under the bucket policies. */
export async function getDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(VERIFICATION_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not open this document.');
  return data.signedUrl;
}

/** A document the user has picked but not uploaded yet. */
export interface Attachment {
  uri: string;
  fileName: string;
  docType: DocType;
}

/** Uploads every attachment to the private bucket (in the signed-in user's folder) and returns what the server needs. */
export async function uploadAttachments(
  userId: string,
  attachments: Attachment[]
): Promise<{ path: string; docType: DocType; fileName: string }[]> {
  const documents = [];
  for (const attachment of attachments) {
    const path = await uploadVerificationDocument(userId, attachment.uri, attachment.fileName);
    documents.push({ path, docType: attachment.docType, fileName: attachment.fileName });
  }
  return documents;
}
