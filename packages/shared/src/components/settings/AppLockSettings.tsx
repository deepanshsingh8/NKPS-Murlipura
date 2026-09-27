"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Lock, ScanFace, Trash2 } from "lucide-react";
import { Button } from "@nkps/shared/components/ui/button";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSwitch,
} from "@nkps/shared/components/settings/SettingsPrimitives";
import { useAppLock } from "@nkps/shared/components/security/AppLockProvider";
import { AUTO_LOCK_OPTIONS } from "@nkps/shared/lib/security/app-lock";
import {
  describeThisDevice,
  isBiometricCapable,
  listBiometricFactors,
  registerBiometric,
  removeBiometric,
  type BiometricFactor,
} from "@nkps/shared/lib/security/biometrics";

// The App Lock controls.
//
// Kept in @nkps/shared rather than in the ERP's settings page because the CMS
// mounts the same lock and will want the same switches; the settings page is
// ERP-hosted today only because that is where the /portal routes live.

export function AppLockSettings() {
  const { settings, update, lock } = useAppLock();
  const [capable, setCapable] = useState<boolean | null>(null);
  // Set once a registration comes back saying WebAuthn MFA is off for the
  // project. The device check above cannot see this — it only knows the phone
  // has a sensor — so it is discoverable only by trying.
  const [notEnabled, setNotEnabled] = useState(false);
  const [factors, setFactors] = useState<BiometricFactor[] | null>(null);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    setFactors(await listBiometricFactors());
  }, []);

  useEffect(() => {
    isBiometricCapable().then(setCapable);
    void refresh();
  }, [refresh]);

  const addDevice = async () => {
    setWorking(true);
    const result = await registerBiometric(describeThisDevice());
    setWorking(false);
    if (result.ok) {
      toast.success("This device can now unlock the app");
      // Registering is also a good moment to turn the lock on — nobody sets up
      // Face ID for an app that never locks.
      if (!settings.enabled) update({ enabled: true });
      await refresh();
      return;
    }
    if (result.reason === "cancelled") return;
    if (result.reason === "not-enabled") {
      // Nothing the person holding the phone can do, and tapping again gets the
      // same 422. Record it so the row explains itself and the button stops
      // inviting a second identical failure.
      setNotEnabled(true);
      toast.error("Face ID isn't switched on for this account yet.");
      return;
    }
    toast.error(
      result.reason === "unsupported"
        ? "This device can't be registered from here. It needs a secure (https) connection and a built-in fingerprint or face sensor."
        : result.message
    );
  };

  const forget = async (factor: BiometricFactor) => {
    setWorking(true);
    const result = await removeBiometric(factor.id);
    setWorking(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`${factor.friendlyName} removed`);
    await refresh();
  };

  const registered = factors ?? [];

  return (
    <SettingsGroup
      id="security-lock"
      title="App Lock"
      icon={Lock}
      description="Covers the app when you've been away, so a phone left on a desk doesn't show a school's records to whoever picks it up. This setting applies to this device only."
    >
      <SettingsRow
        label="Lock this device"
        hint={
          settings.enabled
            ? "Unlock with Face ID, a fingerprint, or your password."
            : "Off — the app stays open until you sign out."
        }
        control={
          <SettingsSwitch
            label="Lock this device"
            checked={settings.enabled}
            onChange={(next) => update({ enabled: next })}
          />
        }
      />

      {settings.enabled && (
        <>
          <SettingsRow
            label="Lock after"
            hint="Counted from when you last used the app, or last left it."
            stacked
            control={
              <div className="erp-scroll-x -mx-1 px-1">
                <div className="flex gap-2">
                  {AUTO_LOCK_OPTIONS.map((option) => {
                    const active = settings.timeoutMs === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => update({ timeoutMs: option.value })}
                        className={
                          active
                            ? "shrink-0 rounded-xl border border-navy-900 bg-navy-900 px-3 py-2 text-xs font-semibold text-white dark:border-gold-500 dark:bg-gold-500 dark:text-navy-900"
                            : "shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 dark:border-border dark:text-gray-300"
                        }
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            }
          />

          <SettingsRow
            label="Lock now"
            hint="Put the lock screen up straight away."
            control={
              <Button variant="outline" size="sm" onClick={lock}>
                Lock
              </Button>
            }
          />
        </>
      )}

      {/* Face ID / fingerprint */}
      <SettingsRow
        label="Face ID & fingerprint"
        hint={
          notEnabled
            ? "Face ID hasn't been enabled for the school's account yet. An administrator needs to switch on WebAuthn (passkeys) for the Supabase project — for both enrolment and verification — before any device can be registered. Your password still unlocks the app."
            : capable === false
              ? "This device doesn't offer a built-in face or fingerprint sensor, or the page isn't on a secure connection."
              : registered.length > 0
                ? "Registered devices can unlock the app without a password."
                : "Register this device to unlock with Face ID or a fingerprint instead of typing your password."
        }
        stacked
        control={
          <div className="space-y-2">
            {registered.map((factor) => (
              <div
                key={factor.id}
                className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2.5 dark:border-border"
              >
                <ScanFace className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-navy-900 dark:text-white">
                    {factor.friendlyName}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    Added{" "}
                    {new Date(factor.createdAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => forget(factor)}
                  disabled={working}
                  aria-label={`Remove ${factor.friendlyName}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}

            <Button
              variant="outline"
              className="w-full"
              onClick={addDevice}
              disabled={working || capable === false || notEnabled}
            >
              {working ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ScanFace className="mr-2 h-4 w-4" />
              )}
              {notEnabled
                ? "Not available yet"
                : registered.length > 0
                  ? "Register another device"
                  : "Set up on this device"}
            </Button>
          </div>
        }
      />
    </SettingsGroup>
  );
}
