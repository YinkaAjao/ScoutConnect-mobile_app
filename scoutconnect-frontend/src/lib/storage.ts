// src/lib/storage.ts
import { supabase } from './supabase';

export const PHOTO_BUCKET = 'athlete-photos';

/**
 * Uploads a locally picked athlete photo to the PRIVATE `athlete-photos` bucket and returns its storage path.
 * The path (not a link) is what gets saved with the athlete: the server turns it into a short-lived signed link for
 * the people allowed to see it, so a photo link can never be passed around.
 * The path is derived from the record's clientId, so retrying a failed sync overwrites the same file.
 * Requires the private bucket and policies from the setup SQL.
 */
export async function uploadAthletePhoto(record: { userId: string; clientId: string; profilePhoto: string }): Promise<string> {
  const safeId = record.clientId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `${record.userId}/${safeId}.jpg`;

  const response = await fetch(record.profilePhoto); // reads the local file:// or content:// URI
  const bytes = await response.arrayBuffer();

  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);

  return path;
}
