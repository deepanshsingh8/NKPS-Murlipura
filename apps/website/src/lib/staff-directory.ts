import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import type { StaffMember } from "@nkps/shared/types";

const PUBLIC_STAFF_CATEGORIES = [
  "management",
  "pgt",
  "tgt",
  "prt",
  "motherTeachers",
  "admin",
] as const;

export type PublicStaffMember = Pick<
  StaffMember,
  "id" | "name" | "subject" | "category" | "photo_url" | "qualifications" | "sort_order"
>;

/**
 * Public faculty list for /academics, grouped by category.
 * Returns null on error or when no rows exist so the page falls back to the
 * STAFF constants.
 *
 * Reads public_staff_directory, not staff_members: the base table also holds
 * date_of_birth, address, phone, email and license_number. The view (migration
 * 098) exposes only these columns and active staff. Columns are listed
 * explicitly so widening the view can never silently widen this page.
 */
export async function getPublicStaffDirectory(): Promise<Record<
  string,
  PublicStaffMember[]
> | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("public_staff_directory")
      .select("id, name, subject, category, photo_url, qualifications, sort_order")
      .in("category", PUBLIC_STAFF_CATEGORIES as unknown as string[])
      .order("sort_order")
      .order("name");

    if (error || !data || data.length === 0) return null;

    const grouped: Record<string, PublicStaffMember[]> = {};
    for (const member of data as PublicStaffMember[]) {
      if (!grouped[member.category]) grouped[member.category] = [];
      grouped[member.category].push(member);
    }
    return grouped;
  } catch {
    // Fall back to constants
    return null;
  }
}
