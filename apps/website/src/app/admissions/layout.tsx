import type { ReactNode } from "react";
import { AdmissionsEnquiryModal } from "@/components/admissions/AdmissionsEnquiryModal";

/**
 * Segment layout for /admissions. Renders the page as-is and overlays the
 * admissions enquiry pop-up (which self-manages: opens once per session,
 * dismissible). Keeping it here means the CTAs simply link to /admissions and
 * the enquiry modal appears on top — the page stays fully browsable whether or
 * not the visitor fills the form.
 */
export default function AdmissionsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AdmissionsEnquiryModal />
    </>
  );
}
