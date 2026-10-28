// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';

// SecureStore rejects values over ~2KB, and a Supabase session can exceed that, so values are chunked.
const CHUNK_SIZE = 1800;
const safeKey = (key: string) => key.replace(/[^a-zA-Z0-9._-]/g, '_');

const SecureStorage = {
  async getItem(key: string): Promise<string | null> {
    const k = safeKey(key);
    const count = await SecureStore.getItemAsync(`${k}.n`);
    if (!count) return null;
    let value = '';
    for (let i = 0; i < Number(count); i++) {
      const part = await SecureStore.getItemAsync(`${k}.${i}`);
      if (part === null) return null;
      value += part;
    }
    return value;
  },
  async setItem(key: string, value: string): Promise<void> {
    const k = safeKey(key);
    await SecureStorage.removeItem(key);
    const parts = value.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'gs')) || [''];
    for (let i = 0; i < parts.length; i++) {
      await SecureStore.setItemAsync(`${k}.${i}`, parts[i]);
    }
    await SecureStore.setItemAsync(`${k}.n`, String(parts.length));
  },
  async removeItem(key: string): Promise<void> {
    const k = safeKey(key);
    const count = Number((await SecureStore.getItemAsync(`${k}.n`)) || 0);
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${k}.${i}`);
    await SecureStore.deleteItemAsync(`${k}.n`);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** Returns a non-expired access token (refreshing if needed), or null when signed out. */
export async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
