import type { Settings } from '@/types';

/**
 * How stale a backup is.
 *
 * All data lives in this browser and clearing site data erases it, so a stale
 * backup is the one genuine risk the app can warn about without nagging.
 */

const DAY_MS = 86_400_000;

export function daysSinceBackup(lastBackupAt?: number): number | undefined {
  if (!lastBackupAt) return undefined;
  return Math.floor((Date.now() - lastBackupAt) / DAY_MS);
}

export function describeLastBackup(lastBackupAt?: number): string {
  const days = daysSinceBackup(lastBackupAt);
  if (days === undefined) return 'You have never backed up on this device.';
  if (days === 0) return 'Last backed up today.';
  if (days === 1) return 'Last backed up yesterday.';
  return `Last backed up ${days} days ago.`;
}

/**
 * True once a backup is overdue. A profile created moments ago has nothing
 * worth backing up, so the nudge waits out the reminder window either way.
 */
export function backupOverdue(settings: Settings, profileCreatedAt?: number): boolean {
  const window = settings.backupRemindDays ?? 14;
  if (window <= 0) return false;

  if (!settings.lastBackupAt) {
    if (!profileCreatedAt) return false;
    return Date.now() - profileCreatedAt > window * DAY_MS;
  }
  return Date.now() - settings.lastBackupAt > window * DAY_MS;
}
