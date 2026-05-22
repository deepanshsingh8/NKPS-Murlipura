"use client";

import { LoginCard } from "@nkps/shared/components/auth/LoginCard";
import { getErpUrl } from "@nkps/shared/lib/cross-app";

export default function CmsLoginPage() {
  return (
    <LoginCard
      formTitle="Sign in to CMS"
      formSubtitle="Manage gallery, articles, transfer certificates, and site content"
      brandHeadline="NKPS Content"
      brandTagline="Welcome to the NKPS Content Management System. Sign in to update photos, articles, and public-facing content."
      roleBadges={[
        { label: "Administrators", color: "bg-gold-500" },
        { label: "Staff", color: "bg-blue-400" },
      ]}
      // Admins/staff always land on the CMS root. Teachers (and staff
      // without explicit role redirect) are admitted only if they hold at
      // least one editor_permissions row in the CMS feature group — see
      // editorAccess below. A teacher with no CMS grants gets the "no access"
      // message and is steered back toward the right portal.
      redirectByRole={{
        admin: "/",
        staff: "/",
      }}
      editorAccess={{ group: "cms", href: "/" }}
      // CMS doesn't host its own forgot-password flow — point at the ERP
      // app, which owns /portal/forgot-password and the email/reset chain.
      forgotPasswordHref={getErpUrl("/portal/forgot-password")}
    />
  );
}
