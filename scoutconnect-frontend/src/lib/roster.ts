// src/lib/roster.ts
import { Alert } from 'react-native';
import { apiFetch } from './api';

/** Asks for confirmation, then deletes the athlete (and their records) from the coach's roster. */
export function confirmRemoveAthlete(athlete: { id: string; name: string }, onRemoved: () => void) {
  Alert.alert(
    'Remove Athlete',
    `Permanently remove ${athlete.name} from your roster? Their evaluations, match stats and achievements will be deleted too. This cannot be undone.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiFetch(`/club/players/${athlete.id}`, { method: 'DELETE' });
            onRemoved();
          } catch (error: any) {
            Alert.alert('Could not remove athlete', error?.message || String(error));
          }
        },
      },
    ]
  );
}

/** Same confirm-then-delete flow for a single evaluation, match record or achievement. */
export function confirmRemoveRecord(
  kind: 'evaluations' | 'match-stats' | 'achievements',
  id: string,
  label: string,
  onRemoved: () => void
) {
  Alert.alert('Remove Record', `Permanently remove ${label}? This cannot be undone.`, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Remove',
      style: 'destructive',
      onPress: async () => {
        try {
          await apiFetch(`/club/${kind}/${id}`, { method: 'DELETE' });
          onRemoved();
        } catch (error: any) {
          Alert.alert('Could not remove record', error?.message || String(error));
        }
      },
    },
  ]);
}
