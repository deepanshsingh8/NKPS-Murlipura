// Single source of truth for how a staff_members.category maps to a portal
// login role. Consumed by every place that provisions a login for a staff
// member (auto-create on add, bulk staff upload, the "Create login" action,
// and convert-to-teacher gating) so the rules never drift between them.
//
// - Teaching categories become "teacher" and get a linked `teachers` record.
// - Office/back-office categories become "staff" (ERP back-office role; empty
//   sidebar until an admin grants editor_permissions).
// - The rest (bus drivers, peons) get no login at all.

export type StaffPortalRole = "teacher" | "staff";

// Categories whose members teach and therefore need a linked teachers record.
// Keep in sync with staffCategoryEnum in validations.ts.
const TEACHING_CATEGORIES = new Set<string>([
  "pgt",
  "tgt",
  "prt",
  "motherTeachers",
  "prePrimaryCoordinator",
  "primaryCoordinator",
  "middleCoordinator",
  "seniorCoordinator",
]);

// Non-teaching categories that still warrant a back-office login.
const OFFICE_CATEGORIES = new Set<string>([
  "management",
  "admin",
  "additionalStaff",
]);

export function isTeachingStaffCategory(category: string): boolean {
  return TEACHING_CATEGORIES.has(category);
}

/**
 * The portal role a login for this staff category should receive, or `null`
 * when the category should not get a login (e.g. busDriver, peon).
 */
export function staffPortalRole(category: string): StaffPortalRole | null {
  if (TEACHING_CATEGORIES.has(category)) return "teacher";
  if (OFFICE_CATEGORIES.has(category)) return "staff";
  return null;
}
