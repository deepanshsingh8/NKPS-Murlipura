import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { staffBulkUploadSchema } from "@nkps/shared/lib/validations";
import { createPortalUser } from "@nkps/shared/lib/create-portal-user";
import { staffPortalRole } from "@nkps/shared/lib/staff-roles";
import { promoteStaffToTeacher } from "@/lib/staff-teacher-sync";

const VALID_CATEGORIES = [
  "management", "admin", "pgt", "tgt", "prt",
  "motherTeachers", "prePrimaryCoordinator", "primaryCoordinator",
  "middleCoordinator", "seniorCoordinator",
  "additionalStaff", "busDriver", "peon",
];

export async function POST(request: Request) {
  const admin = await verifyAdminOrEditor("staff");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = staffBulkUploadSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid data", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { category: globalCategory, staff } = result.data;

    // Validate: either a global category or every row must have a category
    const perRowMode = staff.some((s) => s.category);
    if (!perRowMode && (!globalCategory || !VALID_CATEGORIES.includes(globalCategory))) {
      return NextResponse.json(
        { error: "Invalid or missing category" },
        { status: 400 }
      );
    }
    if (perRowMode) {
      const invalidCats = staff
        .filter((s) => !s.category || !VALID_CATEGORIES.includes(s.category))
        .map((s) => s.name);
      if (invalidCats.length > 0) {
        return NextResponse.json(
          { error: `Invalid category for: ${invalidCats.slice(0, 5).join(", ")}` },
          { status: 400 }
        );
      }
    }

    let inserted = 0;
    const errors: { name: string; error: string }[] = [];
    // Successfully-inserted rows (with their new ids + category) so we can
    // provision the right login role per staff member after the inserts.
    type InsertedRow = {
      id: string;
      name: string;
      category: string;
      email: string | null;
      phone: string | null;
    };
    const insertedRows: InsertedRow[] = [];

    // Get current max sort_order per category
    const categoriesToQuery = perRowMode
      ? [...new Set(staff.map((s) => s.category!))]
      : [globalCategory!];

    const sortOrderMap: Record<string, number> = {};
    for (const cat of categoriesToQuery) {
      const { data: maxRow } = await admin
        .from("staff_members")
        .select("sort_order")
        .eq("category", cat)
        .order("sort_order", { ascending: false })
        .limit(1)
        .single();
      sortOrderMap[cat] = (maxRow?.sort_order ?? -1) + 1;
    }

    // Process in batches of 50
    const BATCH_SIZE = 50;
    for (let i = 0; i < staff.length; i += BATCH_SIZE) {
      const batch = staff.slice(i, i + BATCH_SIZE);

      const records = batch.map((s) => {
        const cat = (perRowMode ? s.category : globalCategory)!;
        const dob = s.date_of_birth?.trim() || null;
        const validDob = dob && /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : null;
        const order = sortOrderMap[cat]++;
        return {
          name: s.name.trim(),
          subject: s.subject.trim(),
          category: cat,
          email: s.email?.trim() || null,
          phone: s.phone?.trim() || null,
          date_of_birth: validDob,
          address: s.address?.trim() || null,
          qualifications: s.qualifications?.trim() || null,
          // License applies only to bus drivers; ignore it for other rows so a
          // stray value in the sheet can't attach a licence to a non-driver.
          license_number:
            cat === "busDriver" ? s.license_number?.trim() || null : null,
          sort_order: order,
        };
      });

      const { data: insData, error: insertError } = await admin
        .from("staff_members")
        .insert(records)
        .select("id, name, category, email, phone");

      if (insertError) {
        // If batch fails, try individually
        for (const record of records) {
          const { data: singleData, error: singleError } = await admin
            .from("staff_members")
            .insert(record)
            .select("id, name, category, email, phone")
            .single();

          if (singleError) {
            console.error("Staff bulk single-insert failed:", singleError);
            const friendly =
              singleError.code === "23505"
                ? "A staff member with this name + category already exists"
                : "Failed to insert this row";
            errors.push({ name: record.name, error: friendly });
          } else {
            inserted++;
            if (singleData) insertedRows.push(singleData as InsertedRow);
          }
        }
        continue;
      }

      inserted += batch.length;
      if (insData) insertedRows.push(...(insData as InsertedRow[]));
    }

    // For each inserted staff row: teaching staff always get a linked teachers
    // record (regardless of email, so they're immediately assignable), and a
    // login is additionally provisioned when an email is present — teaching →
    // teacher, office → staff, drivers/peons → no login.
    let usersCreated = 0;
    for (const s of insertedRows) {
      const portalRole = staffPortalRole(s.category);

      let teacherId: string | undefined;
      if (portalRole === "teacher") {
        const promo = await promoteStaffToTeacher(admin, s.id);
        if (!("error" in promo)) teacherId = promo.teacher_id;
      }

      if (!s.email?.trim()) continue;
      if (portalRole === "teacher" && teacherId) {
        const userResult = await createPortalUser({
          email: s.email.trim(),
          fullName: s.name.trim(),
          role: "teacher",
          phone: s.phone || null,
          teacherId,
        });
        if (userResult.success) usersCreated++;
      } else if (portalRole === "staff") {
        const userResult = await createPortalUser({
          email: s.email.trim(),
          fullName: s.name.trim(),
          role: "staff",
          phone: s.phone || null,
        });
        if (userResult.success) usersCreated++;
      }
    }

    // Nothing inserted + at least one error = total failure; surface it as
    // non-2xx so a caller checking only res.ok doesn't read it as success.
    const allFailed = inserted === 0 && errors.length > 0;
    return NextResponse.json(
      {
        success: !allFailed,
        ...(allFailed ? { error: "No staff were imported — every row failed." } : {}),
        inserted,
        usersCreated,
        errors,
        total: staff.length,
      },
      { status: allFailed ? 400 : 200 }
    );
  } catch (err) {
    console.error("Bulk staff upload error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
