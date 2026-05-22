"use client";

import { useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Image from "next/image";
import Link from "next/link";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Button } from "@nkps/shared/components/ui/button";
import { Loader2, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { getWebsiteUrl } from "@nkps/shared/lib/cross-app";
import {
  FEATURE_CATALOG,
  type FeatureGroup,
  type FeatureKey,
} from "@nkps/shared/lib/permissions";

const FEATURE_GROUP_BY_KEY: Record<FeatureKey, FeatureGroup> = Object.fromEntries(
  FEATURE_CATALOG.map((f) => [f.key, f.group])
) as Record<FeatureKey, FeatureGroup>;

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

type RoleBadge = { label: string; color: string };

type LoginCardProps = {
  // Card branding shown to the user.
  formTitle: string;            // e.g. "Sign in to ERP"
  formSubtitle: string;         // helper text under title
  brandHeadline: string;        // big headline on the left panel
  brandTagline: string;         // tagline under headline
  roleBadges: RoleBadge[];      // role chips on the left panel
  // Where each role lands post-login. Roles not in this map are rejected
  // unless `editorAccess` matches.
  redirectByRole: Record<string, string>;
  // Editor capability gate. When set, a teacher (or staff) signing in is
  // checked against editor_permissions filtered to this FeatureGroup; if they
  // hold any matching grant, they're redirected to `href` instead of the
  // role-default. This lets the CMS login admit teachers with CMS grants and
  // lets the ERP /admin login send teacher-editors to the admin dashboard
  // rather than dropping them on /teacher.
  editorAccess?: { group: FeatureGroup; href: string };
  // Optional: link to a registration page (only used by /portal/login).
  registerHref?: string;
  // Optional override for the forgot-password link (defaults to portal flow).
  forgotPasswordHref?: string;
};

export function LoginCard({
  formTitle,
  formSubtitle,
  brandHeadline,
  brandTagline,
  roleBadges,
  redirectByRole,
  editorAccess,
  registerHref,
  forgotPasswordHref = "/portal/forgot-password",
}: LoginCardProps) {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);

    try {
      const supabase = createClient();
      const { data: authData, error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, must_change_password")
        .eq("id", authData.user.id)
        .single();

      if (profileError) {
        toast.error("Unable to fetch user profile. Please contact administration.");
        return;
      }

      const role = profile?.role || "student";

      // Decide where to redirect:
      //   1. If `editorAccess` is set and the user holds at least one grant in
      //      that FeatureGroup, send them to the editor landing href. This is
      //      what lets a teacher with CMS grants enter the CMS, and lets a
      //      teacher with ERP grants land on the ERP admin dashboard instead
      //      of /teacher when they sign in via the admin login page.
      //   2. Otherwise, fall back to the role-default in `redirectByRole`.
      //   3. If neither matches, the account has no access to this module.
      let dashboard: string | undefined;
      if (editorAccess && (role === "teacher" || role === "staff")) {
        const { data: grants } = await supabase
          .from("editor_permissions")
          .select("feature_key")
          .eq("editor_id", authData.user.id);
        const hasGroupGrant = (grants ?? []).some((g) => {
          const key = g.feature_key as FeatureKey | undefined;
          return key ? FEATURE_GROUP_BY_KEY[key] === editorAccess.group : false;
        });
        if (hasGroupGrant) dashboard = editorAccess.href;
      }
      if (!dashboard) dashboard = redirectByRole[role];
      if (!dashboard) {
        await supabase.auth.signOut();
        toast.error("Your account does not have access to this module.");
        return;
      }

      if (profile?.must_change_password) {
        toast.success("Please set a new password to continue");
        // Hard navigation so the middleware sees the fresh auth cookies and
        // server components re-render with the new session.
        window.location.assign("/portal/change-password");
        return;
      }

      toast.success("Logged in successfully");
      // Hard navigation so the middleware sees the fresh auth cookies and
      // server components re-render with the new session. router.push keeps
      // the client-side cache from before login, leaving the destination
      // looking signed-out until a manual reload.
      window.location.assign(dashboard);
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex min-h-screen">
      {/* Left Panel — Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-navy-900 relative flex-col items-center justify-center px-12 text-white overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full opacity-10">
          <div className="absolute top-10 left-10 w-72 h-72 bg-gold-500 rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-10 w-96 h-96 bg-blue-600 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 text-center max-w-md">
          <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-white/20">
            <Image
              src="/images/logo.png"
              alt="NK Public School Logo"
              width={96}
              height={96}
              className="h-24 w-24 rounded-full object-contain"
              priority
            />
          </div>

          <h1 className="font-heading text-4xl font-bold mb-4">
            {brandHeadline}
          </h1>
          <div className="w-16 h-1 bg-gold-500 mx-auto mb-6 rounded-full" />
          <p className="text-lg text-white/70 leading-relaxed">
            {brandTagline}
          </p>

          {roleBadges.length > 0 && (
            <div className="mt-12 flex flex-col gap-3 text-sm text-white/50">
              {roleBadges.map((b) => (
                <div key={b.label} className="flex items-center justify-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${b.color}`} />
                  <span>{b.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel — Login Form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-cream-50 px-6 py-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-8">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-navy-900/10 overflow-hidden">
              <Image
                src="/images/logo.png"
                alt="NK Public School Logo"
                width={64}
                height={64}
                className="h-16 w-16 rounded-full object-contain"
                priority
              />
            </div>
            <h1 className="font-heading text-2xl font-bold text-navy-900">
              {brandHeadline}
            </h1>
          </div>

          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
            <div className="mb-8">
              <h2 className="font-heading text-2xl font-bold text-navy-900">
                {formTitle}
              </h2>
              <p className="text-gray-500 mt-1 text-sm">{formSubtitle}</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-navy-900 font-medium">
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@nkps.edu.in"
                  {...register("email")}
                  className="h-11 border-gray-200 focus:border-navy-900 focus:ring-navy-900"
                />
                {errors.email && (
                  <p className="text-red-500 text-xs mt-1">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-navy-900 font-medium">
                    Password
                  </Label>
                  <Link
                    href={forgotPasswordHref}
                    className="text-xs text-gold-600 hover:text-gold-500 font-medium transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    {...register("password")}
                    className="h-11 border-gray-200 focus:border-navy-900 focus:ring-navy-900 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-navy-900 transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-red-500 text-xs mt-1">
                    {errors.password.message}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-navy-900 hover:bg-navy-800 text-white font-medium transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>
          </div>

          {registerHref && (
            <div className="mt-4 text-center">
              <Link
                href={registerHref}
                className="text-sm text-gold-600 hover:text-gold-500 font-medium transition-colors"
              >
                Don&apos;t have an account? Register here
              </Link>
            </div>
          )}

          <div className="mt-3 text-center">
            <Link
              href={getWebsiteUrl("/")}
              className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-navy-900 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to website
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
