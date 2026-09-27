"use client";

// App Lock preferences.
//
// ── Why these live in localStorage and not in the database ──────────────────
// A screen lock is a property of the *device*, not the account. Someone may
// want the app locked on the phone they carry around a school and not on the
// desktop in a locked office, and a server-side setting cannot express that —
// it would force one answer onto every device they sign in from. iOS and
// Android app locks work the same way for the same reason.
//
// It also means this feature ships without a migration, which matters: the
// alternative was a table, RLS policies, two API routes and a rate limiter for
// a preference whose worst-case compromise is that someone with the phone in
// their hand and devtools open turns the lock off. See the threat model in
// AppLockProvider.

export const AUTO_LOCK_OPTIONS = [
  { value: 0, label: "Immediately" },
  { value: 60_000, label: "After 1 minute" },
  { value: 5 * 60_000, label: "After 5 minutes" },
  { value: 15 * 60_000, label: "After 15 minutes" },
  { value: 60 * 60_000, label: "After 1 hour" },
] as const;

export interface AppLockSettings {
  enabled: boolean;
  /** Idle/background time before the lock screen appears. */
  timeoutMs: number;
}

export const DEFAULT_APP_LOCK: AppLockSettings = {
  enabled: false,
  // Long enough to survive taking a phone call or checking a message, short
  // enough that a phone left on a desk locks before someone wanders past.
  timeoutMs: 5 * 60_000,
};

// Keyed by user id: two people sharing a tablet each get their own answer, and
// signing out of one account cannot leave the next one unlocked.
const settingsKey = (userId: string) => `nkps-applock:${userId}`;
const stateKey = (userId: string) => `nkps-applock-state:${userId}`;

export function readAppLockSettings(userId: string): AppLockSettings {
  try {
    const raw = localStorage.getItem(settingsKey(userId));
    if (!raw) return DEFAULT_APP_LOCK;
    const parsed = JSON.parse(raw) as Partial<AppLockSettings>;
    const timeout = AUTO_LOCK_OPTIONS.some((o) => o.value === parsed.timeoutMs)
      ? (parsed.timeoutMs as number)
      : DEFAULT_APP_LOCK.timeoutMs;
    return { enabled: parsed.enabled === true, timeoutMs: timeout };
  } catch {
    // Private mode, cleared storage, or something else wrote nonsense here.
    // Failing to the default (off) is right: a lock the user never configured
    // appearing over their work would look like a bug, not a feature.
    return DEFAULT_APP_LOCK;
  }
}

export function writeAppLockSettings(
  userId: string,
  settings: AppLockSettings
): void {
  try {
    localStorage.setItem(settingsKey(userId), JSON.stringify(settings));
  } catch {
    // Applies for this session and is not remembered. Nothing to recover.
  }
}

/** Whether the app was locked when the page was last alive. */
export function readLockedFlag(userId: string): boolean {
  try {
    return localStorage.getItem(stateKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function writeLockedFlag(userId: string, locked: boolean): void {
  try {
    if (locked) localStorage.setItem(stateKey(userId), "1");
    else localStorage.removeItem(stateKey(userId));
  } catch {
    // See above.
  }
}
