"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSession } from "@nkps/shared/components/providers/SessionProvider";
import {
  DEFAULT_APP_LOCK,
  readAppLockSettings,
  readLockedFlag,
  writeAppLockSettings,
  writeLockedFlag,
  type AppLockSettings,
} from "@nkps/shared/lib/security/app-lock";
import { LockScreen } from "@nkps/shared/components/security/LockScreen";

// ── What App Lock is, and what it is not ────────────────────────────────────
//
// It is the screen your banking app puts up when you come back to it: the
// session is still alive, but the contents are covered until you prove you are
// still the one holding the phone. Getting past it needs a Face ID / fingerprint
// check that Supabase verifies server-side, or the account password, which
// Supabase also verifies.
//
// What it defends against: someone picking up an unlocked phone that is signed
// in to a school's records — every student's address, every parent's number.
// That is the realistic threat for a device carried around a school all day,
// and it is the one it handles well.
//
// What it does NOT defend against: an attacker with the unlocked device and
// developer tools. The overlay is client-side and the session cookie stays
// valid behind it, so it can be dismissed by anyone willing to open a console.
// Every app lock of this shape has that property; saying otherwise would be a
// lie told to someone making a decision about real data. Anyone who needs the
// stronger guarantee should sign out.
//
// The preference is per device (see lib/security/app-lock.ts).

interface AppLockContextValue {
  settings: AppLockSettings;
  /** Never null once the session has resolved and settings have been read. */
  ready: boolean;
  locked: boolean;
  /** Available to anything that wants a "Lock now" control. */
  lock: () => void;
  update: (next: Partial<AppLockSettings>) => void;
}

const AppLockContext = createContext<AppLockContextValue>({
  settings: DEFAULT_APP_LOCK,
  ready: false,
  locked: false,
  lock: () => {},
  update: () => {},
});

export function useAppLock() {
  return useContext(AppLockContext);
}

const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

export function AppLockProvider({
  children,
  logoutRedirect = "/portal/login",
}: {
  children: React.ReactNode;
  /** Where "Sign out" on the lock screen lands. */
  logoutRedirect?: string;
}) {
  const { user, loading: sessionLoading } = useSession();
  const userId = user?.id ?? null;

  const [settings, setSettings] = useState<AppLockSettings>(DEFAULT_APP_LOCK);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);

  const lastActiveRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read this account's preference once the session resolves. Until then
  // nothing is locked — there is nothing signed in to protect yet, and we do
  // not know whose settings to read.
  useEffect(() => {
    if (sessionLoading) return;
    if (!userId) {
      setSettings(DEFAULT_APP_LOCK);
      setLocked(false);
      setReady(true);
      return;
    }
    const stored = readAppLockSettings(userId);
    setSettings(stored);
    // A reload while locked comes back locked. Otherwise closing the tab would
    // be the way past the lock screen.
    setLocked(stored.enabled && readLockedFlag(userId));
    setReady(true);
  }, [sessionLoading, userId]);

  const lock = useCallback(() => {
    if (!userId) return;
    setLocked(true);
    writeLockedFlag(userId, true);
  }, [userId]);

  const unlock = useCallback(() => {
    if (!userId) return;
    setLocked(false);
    writeLockedFlag(userId, false);
    lastActiveRef.current = Date.now();
  }, [userId]);

  const update = useCallback(
    (next: Partial<AppLockSettings>) => {
      if (!userId) return;
      setSettings((prev) => {
        const merged = { ...prev, ...next };
        writeAppLockSettings(userId, merged);
        // Turning the lock off has to clear a pending locked flag too, or the
        // next reload would put up a lock screen for a disabled feature.
        if (!merged.enabled) writeLockedFlag(userId, false);
        return merged;
      });
      if (next.enabled === false) setLocked(false);
    },
    [userId]
  );

  // Idle timer. Rearmed on any sign of life; fires once the configured window
  // has passed with none.
  useEffect(() => {
    if (!ready || !settings.enabled || !userId || locked) return;

    const arm = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // "Immediately" means on leaving the app, not while using it — a zero
      // timer here would lock the screen out from under someone reading it.
      if (settings.timeoutMs <= 0) return;
      timerRef.current = setTimeout(lock, settings.timeoutMs);
    };

    const onActivity = () => {
      lastActiveRef.current = Date.now();
      arm();
    };

    arm();
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity);
      }
    };
  }, [ready, settings.enabled, settings.timeoutMs, userId, locked, lock]);

  // Backgrounding. The idle timer is not enough on its own: a phone that is
  // locked or switched to another app suspends timers, so the elapsed time has
  // to be measured on the way back in.
  useEffect(() => {
    if (!ready || !settings.enabled || !userId) return;

    const onHide = () => {
      lastActiveRef.current = Date.now();
    };
    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      const away = Date.now() - lastActiveRef.current;
      if (away >= settings.timeoutMs) lock();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
      else onShow();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, [ready, settings.enabled, settings.timeoutMs, userId, lock]);

  const value = useMemo(
    () => ({ settings, ready, locked, lock, update }),
    [settings, ready, locked, lock, update]
  );

  return (
    <AppLockContext.Provider value={value}>
      {children}
      {locked && user && (
        <LockScreen onUnlock={unlock} logoutRedirect={logoutRedirect} />
      )}
    </AppLockContext.Provider>
  );
}
