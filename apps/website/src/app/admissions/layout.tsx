import type { ReactNode } from "react";
import { LazyAdmissionsEnquiryModal } from "@/components/admissions/LazyAdmissionsEnquiryModal";

/**
 * Segment layout for /admissions. Renders the page as-is and overlays the
 * admissions enquiry pop-up (which self-manages: opens once per session after
 * the visitor scrolls, dismissible). Keeping it here means the CTAs simply link to /admissions and
 * the enquiry modal appears on top — the page stays fully browsable whether or
 * not the visitor fills the form.
 */
export default function AdmissionsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <LazyAdmissionsEnquiryModal />
    </>
  );
}
