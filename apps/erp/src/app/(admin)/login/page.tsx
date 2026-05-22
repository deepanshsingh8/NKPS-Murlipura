"use client";

import { LoginCard } from "@nkps/shared/components/auth/LoginCard";

export default function ErpLoginPage() {
  return (
    <LoginCard
      formTitle="Sign in to ERP"
      formSubtitle="Access your dashboard, records, results, fees and more"
      brandHeadline="NKPS ERP"
      brandTagline="Welcome to the NKPS school operations platform. Sign in to access your role-specific dashboard."
      roleBadges={[
        { label: "Administrators", color: "bg-gold-500" },
        { label: "Teachers", color: "bg-blue-400" },
        { label: "Students", color: "bg-emerald-400" },
        { label: "Parents", color: "bg-rose-400" },
      ]}
      redirectByRole={{
        admin: "/",
        staff: "/",
        teacher: "/teacher",
        student: "/student",
        parent: "/parent",
      }}
      // Teachers (and staff) with at least one ERP feature grant enter the
      // admin dashboard at "/" instead of /teacher — they used the admin
      // login page, so they intend to access admin tooling. Teachers with no
      // ERP grants still fall through to /teacher via redirectByRole.
      editorAccess={{ group: "erp", href: "/" }}
      registerHref="/portal/register"
    />
  );
}
