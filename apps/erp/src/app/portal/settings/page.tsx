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

interface ProfileData {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  avatar_url: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    const url = URL.createObjectURL(file);
    setAvatarCropSrc(url);
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
      if (from === "erp") return { url: "/", external: false };
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
      default: return { url: "/student", external: false };
    }
  };

  const goToDashboard = () => {
    const { url, external } = getDashboardPath();
    if (external) {
      window.location.href = url;
    } else {
      router.push(url);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-900/20 border-t-navy-900" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-50">
      <div className="mx-auto max-w-2xl px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={goToDashboard}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-navy-900 dark:hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Settings
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage your profile, security, and preferences
          </p>
        </div>

        <div className="space-y-6">
          {/* ── Profile Section ── */}
          <div className="bg-white dark:bg-card rounded-2xl border border-gray-200 dark:border-border shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              <User className="h-5 w-5 text-gray-400" />
              <h2 className="font-heading text-lg font-semibold text-navy-900 dark:text-white">
                Profile
              </h2>
            </div>

            {/* Avatar */}
            <div className="flex items-center gap-5 mb-6">
              <div className="relative group">
                {profile?.avatar_url ? (
                  <Image
                    src={profile.avatar_url}
                    alt={profile.full_name}
                    width={80}
                    height={80}
                    className="h-20 w-20 rounded-full object-cover ring-4 ring-gray-100 dark:ring-border"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-full bg-navy-900 dark:bg-gold-500/20 flex items-center justify-center text-white dark:text-gold-400 text-xl font-bold ring-4 ring-gray-100 dark:ring-border">
                    {profile?.full_name
                      .split(" ")
                      .slice(0, 2)
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()}
                  </div>
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  {uploadingAvatar ? (
                    <Loader2 className="h-5 w-5 text-white animate-spin" />
                  ) : (
                    <Camera className="h-5 w-5 text-white" />
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
              <div>
                <p className="font-semibold text-navy-900 dark:text-white">
                  {profile?.full_name}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{profile?.email}</p>
                <p className="text-xs text-gold-600 dark:text-gold-400 capitalize font-medium mt-0.5">
                  {profile?.role}
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-navy-900 dark:text-white">Full Name</Label>
                  <Input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="h-10"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-navy-900 dark:text-white">Phone</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Phone number"
                    className="h-10"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-gray-400">Email</Label>
                <Input
                  value={profile?.email ?? ""}
                  disabled
                  className="h-10 bg-gray-50 dark:bg-muted"
                />
                <p className="text-xs text-gray-400">Email cannot be changed. Contact admin for assistance.</p>
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={saving}
                  className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Save Changes
                </Button>
              </div>
            </form>
          </div>

          {/* ── Security Section ── */}
          <div className="bg-white dark:bg-card rounded-2xl border border-gray-200 dark:border-border shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              <Shield className="h-5 w-5 text-gray-400" />
              <h2 className="font-heading text-lg font-semibold text-navy-900 dark:text-white">
                Change Password
              </h2>
            </div>

            {passwordChanged && (
              <div className="mb-4 flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
                <CheckCircle className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                <p className="text-sm font-medium text-green-800 dark:text-green-300">
                  Password changed successfully
                </p>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-navy-900 dark:text-white">Current Password</Label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="h-10"
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-navy-900 dark:text-white">New Password</Label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="h-10"
                    required
                    minLength={6}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-navy-900 dark:text-white">Confirm New Password</Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="h-10"
                    required
                    minLength={6}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={changingPassword}
                  variant="outline"
                  className="border-navy-900 text-navy-900 hover:bg-navy-900 hover:text-white dark:border-gold-500 dark:text-gold-400 dark:hover:bg-gold-500 dark:hover:text-navy-900"
                >
                  {changingPassword && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Change Password
                </Button>
              </div>
            </form>
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
