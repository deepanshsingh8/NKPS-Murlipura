"use client";

import { useState, useEffect } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Button } from "@nkps/shared/components/ui/button";
import { Loader2, KeyRound, CheckCircle } from "lucide-react";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // The auth callback route exchanges the code server-side and sets session
  // cookies before redirecting here. We just need to verify the session exists.
  useEffect(() => {
    const url = new URL(window.location.href);
    const errorDescription = url.searchParams.get("error_description");

    if (errorDescription) {
      setLinkError(errorDescription);
      return;
    }

    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
      } else {
        setLinkError("Invalid or expired reset link. Please request a new one.");
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();

      // One server route sets the password and clears must_change_password.
      // Keeping them together is what stops the flag being cleared by someone
      // who never changed the password; the flag column is locked against
      // browser writes (migration 061) in any case.
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        toast.error("Your reset link has expired. Please request a new one.");
        return;
      }

      const res = await fetch("/api/portal/complete-password-change", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ newPassword }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "Couldn't reset your password. Please try again.");
        return;
      }

      await supabase.auth.signOut();
      setSuccess(true);
      toast.success("Password reset successfully!");
      setTimeout(() => router.push("/portal/login"), 2000);
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-cream-50 dark:bg-background px-6">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-card rounded-2xl shadow-xl border border-gray-100 dark:border-border p-8">
          {success ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/30">
                <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
                Password Reset!
              </h2>
              <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                Your password has been reset successfully. Redirecting to login...
              </p>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gold-500/10">
                  <KeyRound className="h-8 w-8 text-gold-600 dark:text-gold-400" />
                </div>
                <h2 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
                  Set New Password
                </h2>
                <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                  Enter your new password below.
                </p>
              </div>

              {linkError ? (
                <div className="text-center py-6">
                  <p className="text-sm text-red-600 dark:text-red-400 mb-4">{linkError}</p>
                  <Button
                    onClick={() => router.push("/portal/forgot-password")}
                    variant="outline"
                    className="w-full"
                  >
                    Request a new link
                  </Button>
                </div>
              ) : !sessionReady ? (
                <div className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-navy-900 dark:text-white mx-auto mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">Verifying your reset link...</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="new-password" className="text-navy-900 dark:text-white font-medium">
                      New Password
                    </Label>
                    <Input
                      id="new-password"
                      type="password"
                      placeholder="At least 6 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="h-11 border-gray-200 dark:border-border focus:border-navy-900 focus:ring-navy-900 dark:focus:border-gold-500 dark:focus:ring-gold-500"
                      required
                      minLength={6}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm-password" className="text-navy-900 dark:text-white font-medium">
                      Confirm Password
                    </Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      placeholder="Re-enter your password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-11 border-gray-200 dark:border-border focus:border-navy-900 focus:ring-navy-900 dark:focus:border-gold-500 dark:focus:ring-gold-500"
                      required
                      minLength={6}
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full h-11 bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900 font-medium"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Resetting...
                      </>
                    ) : (
                      "Reset Password"
                    )}
                  </Button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
