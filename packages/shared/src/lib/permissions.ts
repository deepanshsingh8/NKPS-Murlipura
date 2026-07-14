// Single source of truth for editor-grantable admin features.
// Used by:
//  - apps/erp middleware (page-level access check)
//  - verifyAdminOrEditor (API-level access check)
//  - cms / erp sidebars (hide links the editor can't access)
//  - admin permissions UI (render checkboxes)
//
// Admins bypass all of this — they always have full access.
// Module dashboards (apps/cms / apps/erp roots) are always allowed for
// editors who have any feature in that module. /people/users is admin-only
// forever (preventing self-elevation).
//
// hrefs are app-relative (no /cms or /erp prefix). Each app serves its
// own subdomain so the URLs are unambiguous within an app.

export type FeatureKey =
  | "gallery"
  | "articles"
  | "transfer_certificates"
  | "contact"
  | "site_media"
  | "disclosure"
  | "prospectus"
  | "holiday_homework"
  | "staff"
  | "students"
  | "classes"
  | "subjects"
  | "academic_years"
  | "exam_types"
  | "exam_timetable"
  | "admit_cards"
  | "fees"
  | "timetable"
  | "calendar"
  | "attendance"
  | "results"
  | "non_scholastic_entry"
  | "class_tests"
  | "publish_results"
  | "blank_marks_list"
  | "white_sheet"
  | "green_sheet"
  | "ptm_notes"
  | "ptm_format"
  | "supplementary_exams"
  | "teacher_substitutions";

export type FeatureGroup = "cms" | "erp";

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  href: string;
  group: FeatureGroup;
}

export const FEATURE_CATALOG: readonly FeatureDef[] = [
  // CMS hrefs are app-relative (apps/cms serves these directly).
  { key: "gallery", label: "Gallery", href: "/gallery", group: "cms" },
  { key: "articles", label: "Articles", href: "/articles", group: "cms" },
  { key: "transfer_certificates", label: "Transfer Certificates", href: "/transfer-certificates", group: "cms" },
  { key: "contact", label: "Contact Messages", href: "/contact", group: "cms" },
  { key: "site_media", label: "Site Media", href: "/site-media", group: "cms" },
  { key: "disclosure", label: "Disclosure", href: "/disclosure", group: "cms" },
  { key: "prospectus", label: "Prospectus", href: "/prospectus", group: "cms" },
  { key: "holiday_homework", label: "Holiday Homework", href: "/holiday-homework", group: "cms" },
  // ERP hrefs are app-relative (apps/erp serves these directly).
  { key: "staff", label: "Staff", href: "/people/staff", group: "erp" },
  { key: "students", label: "Students", href: "/people/students", group: "erp" },
  { key: "classes", label: "Classes", href: "/academics/classes", group: "erp" },
  { key: "subjects", label: "Subjects", href: "/academics/subjects", group: "erp" },
  { key: "academic_years", label: "Academic Years", href: "/academics/years", group: "erp" },
  { key: "exam_types", label: "Exam Types", href: "/exams/types", group: "erp" },
  { key: "exam_timetable", label: "Exam Timetable", href: "/exams/timetable", group: "erp" },
  { key: "admit_cards", label: "Admit Cards", href: "/exams/admit-cards", group: "erp" },
  { key: "fees", label: "Fees", href: "/fees", group: "erp" },
  { key: "timetable", label: "Timetable", href: "/timetable", group: "erp" },
  { key: "calendar", label: "Calendar", href: "/calendar", group: "erp" },
  { key: "attendance", label: "Attendance", href: "/attendance", group: "erp" },
  { key: "results", label: "Results", href: "/exams/results", group: "erp" },
  { key: "non_scholastic_entry", label: "Non-Scholastic Entry", href: "/exams/non-scholastic-assessments", group: "erp" },
  { key: "class_tests", label: "Class Tests", href: "/exams/class-tests", group: "erp" },
  { key: "publish_results", label: "Publish & Finalize", href: "/exams/publish", group: "erp" },
  { key: "blank_marks_list", label: "Blank Marks List", href: "/exams/blank-marks-list", group: "erp" },
  { key: "white_sheet", label: "White Sheet", href: "/exams/white-sheet", group: "erp" },
  { key: "green_sheet", label: "Green Sheet", href: "/exams/green-sheet", group: "erp" },
  { key: "ptm_notes", label: "PTM Notes", href: "/exams/ptm-notes", group: "erp" },
  { key: "ptm_format", label: "PTM Format", href: "/exams/ptm-format", group: "erp" },
  { key: "supplementary_exams", label: "Supplementary Exams", href: "/exams/supplementary", group: "erp" },
  { key: "teacher_substitutions", label: "Substitutions", href: "/timetable/substitutions", group: "erp" },
] as const;

export const FEATURE_KEYS: readonly FeatureKey[] = FEATURE_CATALOG.map((f) => f.key);

export type ProfileRole = "admin" | "staff" | "teacher" | "student" | "parent";

// Roles that may hold editor capability (i.e., be granted feature_keys in
// editor_permissions). Admins bypass capability checks entirely; students and
// parents cannot be granted editor features. Used by the API that grants
// permissions and by the users-page UI that decides whether to render the
// "Permissions" button.
export function canHoldEditorCapability(role: string): boolean {
  return role === "staff" || role === "teacher";
}

const FEATURE_KEY_SET = new Set<string>(FEATURE_KEYS);

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && FEATURE_KEY_SET.has(value);
}

// Routes editors can never access in apps/erp, regardless of permissions.
// (Prevents self-elevation via /people/users; locks down master config screens.)
export const ADMIN_ONLY_PREFIXES = [
  "/people/users",
  "/registrations",
  "/exams/grade-master",
  "/exams/header-footer",
  "/exams/non-scholastic-masters",
  "/exams/result-master",
] as const;

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

// Map an app-relative URL to its feature_key.
// Returns null for the dashboard root (/), login (/login), and admin-only
// paths (handled separately by isAdminOnlyPath). The caller is responsible
// for filtering by FeatureGroup based on which app it lives in.
export function featureKeyForPath(pathname: string): FeatureKey | null {
  if (pathname === "/" || pathname === "/login") return null;
  if (isAdminOnlyPath(pathname)) return null;

  // Match longest prefix first (some hrefs share roots like /exams/...).
  const sorted = [...FEATURE_CATALOG].sort((a, b) => b.href.length - a.href.length);
  for (const f of sorted) {
    if (pathname === f.href || pathname.startsWith(`${f.href}/`)) {
      return f.key;
    }
  }
  return null;
}
