"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Button } from "@nkps/shared/components/ui/button";
import {
  Loader2,
  Camera,
  User,
  Shield,
  ArrowLeft,
  Check,
  CheckCircle,
  Palette,
  Info,
  LogOut,
  Download,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@nkps/shared/components/ui/dialog";
import { ImageCropper } from "@nkps/shared/components/ImageCropper";
import { getCmsUrl } from "@nkps/shared/lib/cross-app";
import { validatePhotoFile } from "@nkps/shared/lib/photo-spec";
import { SessionProvider } from "@nkps/shared/components/providers/SessionProvider";
import { AppLockProvider } from "@nkps/shared/components/security/AppLockProvider";
import { ThemeToggle } from "@nkps/shared/components/ThemeToggle";
import {
  SettingsGroup,
  SettingsRow,
} from "@nkps/shared/components/settings/SettingsPrimitives";
import { AppLockSettings } from "@nkps/shared/components/settings/AppLockSettings";
import { useIsStandalone } from "@nkps/shared/hooks/useMediaQuery";

interface ProfileData {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  avatar_url: string | null;
}

const NAV = [
  { id: "account", label: "Account", icon: User },
  { id: "security-lock", label: "App Lock", icon: Shield },
  { id: "password", label: "Password", icon: Shield },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "about", label: "About", icon: Info },
] as const;

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const standalone = useIsStandalone();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Avatar crop state
  const [avatarCropSrc, setAvatarCropSrc] = useState<string | null>(null);

  // Profile form
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  useEffect(() => {
    async function fetchProfile() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/portal/login");
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone, role, avatar_url")
        .eq("id", user.id)
        .single();

      if (data) {
        setProfile(data as ProfileData);
        setFullName(data.full_name);
        setPhone(data.phone ?? "");
      }
      setLoading(false);
    }
    fetchProfile();
  }, [router]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    setSaving(true);
    const supabase = createClient();

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        phone: phone.trim() || null,
      })
      .eq("id", profile.id);

    if (error) {
      toast.error("Failed to update profile");
    } else {
      toast.success("Profile updated");
      setProfile({ ...profile, full_name: fullName.trim(), phone: phone.trim() || null });
    }
    setSaving(false);
  };

  const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const result = validatePhotoFile(file);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }

    setAvatarCropSrc(URL.createObjectURL(file));
  };

  const handleAvatarCropDone = async (croppedFile: File) => {
    if (avatarCropSrc) URL.revokeObjectURL(avatarCropSrc);
    setAvatarCropSrc(null);

    if (!profile) return;

    setUploadingAvatar(true);

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        toast.error("Session expired. Please log in again.");
        setUploadingAvatar(false);
        return;
      }

      const formData = new FormData();
      formData.append("file", croppedFile);

      const res = await fetch("/api/portal/avatar", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to upload avatar");
        setUploadingAvatar(false);
        return;
      }

      setProfile({ ...profile, avatar_url: data.avatarUrl });
      toast.success("Avatar updated");
    } catch {
      toast.error("Failed to upload avatar");
    }
    setUploadingAvatar(false);
  };

  const handleAvatarCropCancel = () => {
    if (avatarCropSrc) URL.revokeObjectURL(avatarCropSrc);
    setAvatarCropSrc(null);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 6) {
      toast.error("New password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setChangingPassword(true);
    const supabase = createClient();

    // Verify current password by re-authenticating
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: profile?.email ?? "",
      password: currentPassword,
    });

    if (signInError) {
      toast.error("Current password is incorrect");
      setChangingPassword(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      toast.error(error.message);
    } else {
      setPasswordChanged(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
    setChangingPassword(false);
  };

  const getDashboardPath = (): { url: string; external: boolean } => {
    // For admin/staff, honour the ?from=cms|erp hint set by the sidebar that
    // linked here so users return to the module they came from instead of
    // always being bounced to ERP. CMS lives in a separate app.
    if (profile?.role === "admin" || profile?.role === "staff") {
      const from = searchParams.get("from");
      if (from === "cms") return { url: getCmsUrl("/"), external: true };
      return { url: "/", external: false };
    }
    // Teachers — including those with editor capability — return to the
    // teacher portal. The ?from hint still applies for users who arrived
    // here via the AppSwitcher link from CMS/ERP admin.
    if (profile?.role === "teacher") {
      const from = searchParams.get("from");
      if (from === "cms") return { url: getCmsUrl("/"), external: true };
      if (from === "erp") return { url: "/", external: false };
      return { url: "/teacher", external: false };
    }
    switch (profile?.role) {
      case "parent": return { url: "/parent", external: false };
      default: return { url: "/student", external: false };
    }
  };

  const goToDashboard = () => {
    const { url, external } = getDashboardPath();
    if (external) window.location.href = url;
    else router.push(url);
  };

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    document.cookie = "x-user-role=; path=/; max-age=0";
    window.location.href = "/portal/login";
  };

  // The service worker holds a waiting version until something tells it to take
  // over. PWARegister shows a toast when it notices; this is the manual door.
  const checkForUpdates = async () => {
    if (!("serviceWorker" in navigator)) {
      toast.error("Updates aren't available in this browser");
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      toast.error("The app isn't installed on this device");
      return;
    }
    await registration.update();
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      toast.success("Updating…");
    } else {
      toast.success("You're on the latest version");
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50 dark:bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-900/20 border-t-navy-900 dark:border-white/20 dark:border-t-white" />
      </div>
    );
  }

  const initials = profile?.full_name
    ? profile.full_name
        .split(" ")
        .slice(0, 2)
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : "?";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-50 dark:bg-background">
      {/* App bar — sticky, safe-area aware, with a real back control. The old
          screen put "Back to Dashboard" inline at the top of the document, so
          it scrolled away and left no way out. */}
      <header className="app-safe-t sticky top-0 z-10 border-b border-navy-900/10 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-border dark:bg-card/95 dark:supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-2 sm:px-4">
          <button
            onClick={goToDashboard}
            aria-label="Back"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-navy-900 active:bg-navy-900/5 dark:text-white dark:active:bg-white/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="font-heading text-lg font-semibold text-navy-900 dark:text-white">
            Settings
          </h1>
        </div>
      </header>

      <div className="app-safe-x mx-auto max-w-3xl px-4 pb-[calc(3rem+env(safe-area-inset-bottom,0px))] pt-5 sm:px-6">
        {/* Identity card */}
        <div className="mb-6 flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-border dark:bg-card">
          <div className="relative shrink-0">
            {profile?.avatar_url ? (
              <Image
                src={profile.avatar_url}
                alt={profile.full_name}
                width={64}
                height={64}
                className="h-16 w-16 rounded-full object-cover ring-4 ring-gray-100 dark:ring-border"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-navy-900 text-lg font-bold text-white ring-4 ring-gray-100 dark:bg-gold-500/20 dark:text-gold-400 dark:ring-border">
                {initials}
              </div>
            )}
            {/* A always-visible badge, not a hover overlay: there is no hover on
                a phone, so the old control was invisible on the device most
                likely to be changing a photo. */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              aria-label="Change profile photo"
              className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-white shadow-md ring-2 ring-white dark:bg-gold-500 dark:text-navy-900 dark:ring-card"
            >
              {uploadingAvatar ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              className="hidden"
              onChange={handleAvatarFileSelect}
            />
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-navy-900 dark:text-white">
              {profile?.full_name}
            </p>
            <p className="truncate text-sm text-gray-500 dark:text-gray-400">
              {profile?.email}
            </p>
            <span className="mt-1 inline-block rounded-full bg-gold-500/15 px-2 py-0.5 text-[11px] font-medium capitalize text-gold-700 dark:text-gold-400">
              {profile?.role}
            </span>
          </div>
        </div>

        <div className="lg:flex lg:gap-8">
          {/* Section nav — desktop only. On a phone the page is short enough to
              scroll and a nav rail would just take the width the content needs. */}
          <nav className="hidden lg:block lg:w-44 lg:shrink-0">
            <div className="sticky top-20 space-y-0.5">
              {NAV.map(({ id, label, icon: Icon }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-white hover:text-navy-900 dark:text-gray-400 dark:hover:bg-card dark:hover:text-white"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </a>
              ))}
            </div>
          </nav>

          <div className="min-w-0 flex-1 space-y-7">
            {/* ── Account ── */}
            <SettingsGroup id="account" title="Account" icon={User}>
              <form onSubmit={handleSaveProfile}>
                <SettingsRow
                  label="Full name"
                  stacked
                  control={
                    <Input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="h-11"
                      required
                    />
                  }
                />
                <SettingsRow
                  label="Phone"
                  stacked
                  control={
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Phone number"
                      type="tel"
                      inputMode="tel"
                      className="h-11"
                    />
                  }
                />
                <SettingsRow
                  label="Email"
                  hint="Email can't be changed here — ask an admin."
                  stacked
                  control={
                    <Input
                      value={profile?.email ?? ""}
                      disabled
                      className="h-11 bg-gray-50 dark:bg-muted"
                    />
                  }
                />
                <div className="flex justify-end px-4 py-3">
                  <Button
                    type="submit"
                    disabled={saving}
                    className="h-11 bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    Save changes
                  </Button>
                </div>
              </form>
            </SettingsGroup>

            {/* ── App Lock ── */}
            <AppLockSettings />

            {/* ── Password ── */}
            <SettingsGroup id="password" title="Password" icon={Shield}>
              {passwordChanged && (
                <div className="flex items-center gap-3 border-b border-gray-100 bg-green-50 px-4 py-3 dark:border-border/70 dark:bg-green-900/20">
                  <CheckCircle className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">
                    Password changed successfully
                  </p>
                </div>
              )}
              <form onSubmit={handleChangePassword}>
                <SettingsRow
                  label="Current password"
                  stacked
                  control={
                    <Input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                      className="h-11"
                      required
                    />
                  }
                />
                <SettingsRow
                  label="New password"
                  hint="At least 6 characters."
                  stacked
                  control={
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500 dark:text-gray-400">
                          New password
                        </Label>
                        <Input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="h-11"
                          required
                          minLength={6}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500 dark:text-gray-400">
                          Confirm
                        </Label>
                        <Input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="h-11"
                          required
                          minLength={6}
                        />
                      </div>
                    </div>
                  }
                />
                <div className="flex justify-end px-4 py-3">
                  <Button
                    type="submit"
                    disabled={changingPassword}
                    variant="outline"
                    className="h-11"
                  >
                    {changingPassword && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Change password
                  </Button>
                </div>
              </form>
            </SettingsGroup>

            {/* ── Appearance ── */}
            <SettingsGroup id="appearance" title="Appearance" icon={Palette}>
              <SettingsRow
                label="Theme"
                hint="System follows your phone or computer, including its night schedule."
                stacked
                control={<ThemeToggle />}
              />
            </SettingsGroup>

            {/* ── About ── */}
            <SettingsGroup id="about" title="About" icon={Info}>
              <SettingsRow
                label="Installed app"
                hint={
                  standalone
                    ? "Running from your home screen."
                    : "Open in a browser. Add it to your home screen for a full-screen app."
                }
                control={
                  <Download
                    className={
                      standalone
                        ? "h-4 w-4 text-green-600 dark:text-green-400"
                        : "h-4 w-4 text-gray-400"
                    }
                  />
                }
              />
              <SettingsRow
                label="Check for updates"
                hint="Reloads the app if a newer version is ready."
                control={
                  <Button variant="outline" size="sm" onClick={checkForUpdates}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Check
                  </Button>
                }
              />
              <SettingsRow
                label="Sign out"
                hint="Ends this session on this device."
                control={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={signOut}
                    className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    <LogOut className="mr-1.5 h-3.5 w-3.5" />
                    Sign out
                  </Button>
                }
              />
            </SettingsGroup>
          </div>
        </div>
      </div>

      {/* Avatar crop dialog */}
      <Dialog open={!!avatarCropSrc} onOpenChange={(open) => { if (!open) handleAvatarCropCancel(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Crop Profile Photo</DialogTitle>
          </DialogHeader>
          {avatarCropSrc && (
            <ImageCropper
              imageSrc={avatarCropSrc}
              onCropComplete={handleAvatarCropDone}
              onCancel={handleAvatarCropCancel}
              fileName={`avatar-${Date.now()}.jpg`}
              cropShape="round"
              aspect={1}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// /portal has no layout of its own — its other routes are the signed-out auth
// screens, which must not be wrapped in a session or a lock. So this page
// mounts both itself: the App Lock switches need the provider to write to, and
// a settings screen left uncovered would be a way to sit on an unlocked app.
export default function SettingsPage() {
  return (
    <SessionProvider>
      <AppLockProvider>
        <SettingsContent />
      </AppLockProvider>
    </SessionProvider>
  );
}
