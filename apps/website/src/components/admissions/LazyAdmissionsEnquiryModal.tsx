"use client";

import dynamic from "next/dynamic";

// Loaded after hydration so the pop-up's form libraries (react-hook-form + zod)
// stay off the /admissions critical rendering path. It renders nothing until
// the visitor scrolls, so there is no server HTML to lose.
export const LazyAdmissionsEnquiryModal = dynamic(
  () =>
    import("./AdmissionsEnquiryModal").then((m) => m.AdmissionsEnquiryModal),
  { ssr: false }
);
