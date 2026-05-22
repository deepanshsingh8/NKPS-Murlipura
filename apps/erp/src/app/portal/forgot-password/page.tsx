"use client";

import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Button } from "@nkps/shared/components/ui/button";
import { Loader2, ArrowLeft, Mail, CheckCircle } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Our own API route generates a Supabase recovery link and sends a
      // branded email via Resend instead of Supabase's default plain template.
      const res = await fetch("/api/portal/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(payload.error || "Something went wrong. Please try again.");
      } else {
        setSent(true);
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-cream-50 px-6">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
          {sent ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="font-heading text-2xl font-bold text-navy-900">
                Check Your Email
              </h2>
              <p className="text-gray-500 mt-3 text-sm leading-relaxed">
                We&apos;ve sent a password reset link to{" "}
                <span className="font-medium text-navy-900">{email}</span>.
                Click the link in the email to set a new password.
              </p>
              <p className="text-gray-400 mt-2 text-xs">
                Didn&apos;t receive it? Check your spam folder or try again.
              </p>
              <div className="mt-6 space-y-3">
                <Button
                  onClick={() => setSent(false)}
                  variant="outline"
                  className="w-full"
                >
                  Try again
                </Button>
                <Link
                  href="/portal/login"
                  className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-navy-900 transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to login
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gold-500/10">
                  <Mail className="h-8 w-8 text-gold-600" />
                </div>
                <h2 className="font-heading text-2xl font-bold text-navy-900">
                  Forgot Password?
                </h2>
                <p className="text-gray-500 mt-2 text-sm">
                  Enter your email address and we&apos;ll send you a link to reset your password.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-navy-900 font-medium">
                    Email Address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@nkps.edu.in"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 border-gray-200 focus:border-navy-900 focus:ring-navy-900"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 bg-navy-900 hover:bg-navy-800 text-white font-medium"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  href="/portal/login"
                  className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-navy-900 transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to login
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
