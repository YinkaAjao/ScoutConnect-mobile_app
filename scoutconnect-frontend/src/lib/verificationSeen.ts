// src/lib/verificationSeen.ts
import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';
import { apiFetch } from './api';
import { decisionKey } from './verificationKey';

// Tiny shared store behind the Club tab's badge: the tab (in the layout) and the cards (on the screen) need the same numbers.
let unseenDecision = false; // an admin decision on the club's verification that the owner hasn't looked at
let pendingRequests = 0; // scout contact requests waiting for the owner's answer
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

const setUnseen = (value: boolean) => {
  if (unseenDecision === value) return;
  unseenDecision = value;
  emit();
};

/** Called by the contact-requests card whenever it knows how many are waiting. */
export const setPendingContactRequests = (count: number) => {
  if (pendingRequests === count) return;
  pendingRequests = count;
  emit();
};

/** Number to show on the Club tab: a new verification decision counts as one, plus every waiting scout request. */
export const useClubTabBadge = (): number =>
  useSyncExternalStore(
    (onChange) => { listeners.add(onChange); return () => { listeners.delete(onChange); }; },
    () => (unseenDecision ? 1 : 0) + pendingRequests,
    () => 0
  );

// One entry per account, so two coaches sharing a phone never hide each other's news.
const storageKey = async (): Promise<string | null> => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ? `verification-seen-${session.user.id}` : null;
};

/** Looks for news the club owner hasn't seen: a new verification decision, and scout requests waiting for an answer. */
export async function refreshVerificationCue(): Promise<void> {
  const key = await storageKey().catch(() => null);
  if (!key) {
    setUnseen(false);
    setPendingContactRequests(0);
    return;
  }

  try {
    const info = await apiFetch('/club/verification', { retries: 0, timeoutMs: 15000 });
    const latest = decisionKey(info.history);
    setUnseen(!!latest && latest !== (await SecureStore.getItemAsync(key)));
  } catch {
    // The badge is a nicety: if the check fails (offline, pending membership…), stay quiet.
  }

  try {
    // Only the club owner may list requests; for everyone else this answers 403, which just means "none to show".
    const waiting = await apiFetch('/club/contact-requests?status=Pending', { retries: 0, timeoutMs: 15000 });
    setPendingContactRequests(Array.isArray(waiting) ? waiting.length : 0);
  } catch {
    setPendingContactRequests(0);
  }
}

/** Call when the owner is looking at the verification card: remembers the latest decision and clears that part of the badge. */
export async function markVerificationSeen(history?: { action: string; at: string }[] | null): Promise<void> {
  try {
    const key = await storageKey();
    const latest = decisionKey(history);
    if (key && latest) await SecureStore.setItemAsync(key, latest);
  } catch {
    // Failing to remember only means the badge may reappear once; never block the screen.
  }
  setUnseen(false);
}
