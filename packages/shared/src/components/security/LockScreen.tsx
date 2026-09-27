"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Fingerprint, Loader2, LogOut, ScanFace } from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { useSession } from "@nkps/shared/components/providers/SessionProvider";
import { Input } from "@nkps/shared/components/ui/input";
import { Button } from "@nkps/shared/components/ui/button";
import {
  authenticateBiometric,
  listBiometricFactors,
  type BiometricFactor,
} from "@nkps/shared/lib/security/biometrics";

// The screen that covers the app once App Lock trips.
//
// Two ways past it, both verified by the server rather than by this component:
// a Face ID / fingerprint check against a registered WebAuthn factor, or the
// account password. There is deliberately no third, weaker option — a 6-digit
// PIN would mean storing a new low-entropy secret and building the hashing,
// rate limiting and lockout to go with it, to save typing a password on the
// rare occasions biometrics are unavailable.
//
// It renders into <body> so it covers the app bar, the drawer and anything a
// page has pinned of its own.

export function LockScreen({
  onUnlock,
  logoutRedirect,
}: {
  onUnlock: () => void;
  /** Module-specific login page — the CMS has no /portal routes. */
  logoutRedirect: string;
}) {
  const { profile, user } = useSession();
  const [mounted, setMounted] = useState(false);
  const [factors, setFactors] = useState<BiometricFactor[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const promptedRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let active = true;
    listBiometricFactors().then((f) => {
      if (active) setFactors(f);
    });
    return () => {
      active = false;
    };
  }, []);

  // The whole point of the app lock on a phone is that coming back to the app
  // puts up Face ID, not a form. Auto-prompting once does that; if the user
  // dismisses it, the button is still there and we do not nag.
  const runBiometric = useCallback(
    async (factorId: string) => {
      setBusy(true);
      setError(null);
      const result = await authenticateBiometric(factorId);
      setBusy(false);
      if (result.ok) {
        onUnlock();
        return;
      }
      if (result.reason === "cancelled") return;
      if (result.reason === "not-enabled") {
        // The factor is registered but the project can no longer verify it, so
        // the Unlock button cannot succeed however many times it is pressed.
        // Someone staring at a lock screen needs a way in, not a diagnosis:
        // drop straight to the password field.
        setShowPassword(true);
        setError("Face ID can't be used right now. Enter your password to unlock.");
        return;
      }
      setError(result.message);
    },
    [onUnlock]
  );

  useEffect(() => {
    if (promptedRef.current) return;
    if (!factors || factors.length === 0) return;
    promptedRef.current = true;
    void runBiometric(factors[0].id);
  }, [factors, runBiometric]);

  // Lock the page behind the overlay. Without this the body keeps scrolling
  // under the lock screen, which makes it look like a banner rather than a gate.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) {
      setError("This account has no email address to verify against.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // Supabase verifies this and applies its own rate limiting — there is no
    // local attempt counter to get wrong, and no new endpoint to protect.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
    });
    setBusy(false);
    if (signInError) {
      setError("That password doesn't match.");
      return;
    }
    setPassword("");
    onUnlock();
  };

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    document.cookie = "x-user-role=; path=/; max-age=0";
    window.location.href = logoutRedirect;
  };

  if (!mounted) return null;

  const initials = profile?.full_name
    ? profile.full_name
        .split(" ")
        .slice(0, 2)
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : "?";

  const hasBiometrics = (factors?.length ?? 0) > 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="App locked"
      className="fixed inset-0 z-[100] flex flex-col bg-navy-900"
    >
      {/* Soft brand wash, same as the login panel — the lock screen should
          look like part of the app, not like an error page. */}
      <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-gold-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-blue-600/15 blur-3xl" />

      <div className="app-safe-t app-safe-b relative flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <div className="w-full max-w-xs text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-white/10 text-lg font-bold text-white ring-1 ring-white/20">
            {profile?.avatar_url ? (
              <Image
                src={profile.avatar_url}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 object-cover"
              />
            ) : (
              initials
            )}
          </div>

          <h1 className="font-heading text-2xl font-bold text-white">
            {profile?.full_name?.split(" ")[0]
              ? `Welcome back, ${profile.full_name.split(" ")[0]}`
              : "Welcome back"}
          </h1>
          <p className="mt-1.5 text-sm text-white/60">
            {hasBiometrics
              ? "Unlock to pick up where you left off."
              : "Enter your password to unlock."}
          </p>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
            >
              {error}
            </p>
          )}

          {hasBiometrics && !showPassword && (
            <button
              type="button"
              onClick={() => factors && runBiometric(factors[0].id)}
              disabled={busy}
              className={cn(
                "mt-7 flex w-full items-center justify-center gap-2.5 rounded-2xl bg-gold-500 px-4 py-4 text-base font-semibold text-navy-900 transition-transform",
                busy ? "opacity-70" : "active:scale-[0.98]"
              )}
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ScanFace className="h-5 w-5" />
              )}
              Unlock
            </button>
          )}

          {(showPassword || !hasBiometrics) && (
            <form onSubmit={submitPassword} className="mt-7 space-y-3 text-left">
              <Input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                aria-label="Password"
                className="h-12 border-white/15 bg-white/5 text-base text-white placeholder:text-white/40 focus:border-gold-500"
              />
              <Button
                type="submit"
                disabled={busy || password.length === 0}
                className="h-12 w-full bg-gold-500 text-base font-semibold text-navy-900 hover:bg-gold-400"
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Unlock
              </Button>
            </form>
          )}

          <div className="mt-6 flex flex-col items-center gap-3">
            {hasBiometrics && (
              <button
                type="button"
                onClick={() => {
                  setShowPassword((v) => !v);
                  setError(null);
                }}
                className="inline-flex items-center gap-1.5 text-sm text-white/60 transition-colors hover:text-white"
              >
                <Fingerprint className="h-4 w-4" />
                {showPassword ? "Use Face ID instead" : "Use password instead"}
              </button>
            )}
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-1.5 text-sm text-white/40 transition-colors hover:text-white/70"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
