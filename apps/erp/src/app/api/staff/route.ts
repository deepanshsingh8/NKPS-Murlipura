import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { createPortalUser } from "@nkps/shared/lib/create-portal-user";
import { mirrorStaffToTeacher, promoteStaffToTeacher } from "@/lib/staff-teacher-sync";
import { staffPortalRole } from "@nkps/shared/lib/staff-roles";
import { staffCreateSchema, staffUpdateSchema } from "@nkps/shared/lib/validations";
import { extractStoragePath } from "@nkps/shared/lib/storage-paths";

export async function POST(request: NextRequest) {
  const admin = await verifyAdminOrEditor("staff");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = staffCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const {
      name,
      subject,
      category,
      photo_url,
      sort_order,
      email,
      phone,
      date_of_birth,
      address,
      qualifications,
      license_number,
    } = parsed.data;

    const { data, error: insertError } = await admin
      .from("staff_members")
      .insert({
        name,
        subject,
        category,
        photo_url: photo_url || null,
        sort_order: sort_order ?? 0,
        email: email || null,
        phone: phone || null,
        date_of_birth: date_of_birth || null,
        address: address || null,
        qualifications: qualifications || null,
        license_number: license_number || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Staff DB insert error:", insertError);
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: `A staff member named "${name}" already exists in the ${category} category` },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to save staff member" },
        { status: 500 }
      );
    }

    const portalRole = staffPortalRole(category);

    // Teaching staff are ERP teachers regardless of whether they ever get a
    // login, so create (or reuse) their linked teachers record on add — that's
    // what makes them assignable to classes/timetable/attendance. This is
    // decoupled from the email/login step below so an emailless teacher still
    // becomes a usable teacher record without needing the manual convert action.
    let teacherId: string | undefined;
    if (portalRole === "teacher") {
      const promo = await promoteStaffToTeacher(admin, data.id);
      if (!("error" in promo)) teacherId = promo.teacher_id;
    }

    // Auto-provision a login only when there's an email, with the role their
    // category maps to: teaching → 'teacher' (linked to the record above),
    // office → 'staff', drivers/peons → no login. See lib/staff-roles.
    let userCreated = false;
    if (email?.trim()) {
      if (portalRole === "teacher" && teacherId) {
        const result = await createPortalUser({
          email: email.trim(),
          fullName: name.trim(),
          role: "teacher",
          phone: phone || null,
          teacherId,
        });
        userCreated = result.success;
      } else if (portalRole === "staff") {
        const result = await createPortalUser({
          email: email.trim(),
          fullName: name.trim(),
          role: "staff",
          phone: phone || null,
        });
        userCreated = result.success;
      }
    }

    return NextResponse.json({ success: true, data, userCreated });
  } catch (err) {
    console.error("[Staff Create Error]", err);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await verifyAdminOrEditor("staff");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = staffUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { id, old_photo_url, ...updates } = parsed.data;

    // If photo is being replaced, delete old one from storage. L2 — derive
    // the path via extractStoragePath so cache-buster query strings and
    // nested folders don't silently no-op the delete.
    if (updates.photo_url && old_photo_url) {
      const path = extractStoragePath(old_photo_url, "staff-photos");
      if (path) await admin.storage.from("staff-photos").remove([path]);
    }

    const { error } = await admin
      .from("staff_members")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("Staff update error:", error);
      return NextResponse.json(
        { error: "Failed to update staff member" },
        { status: 500 }
      );
    }

    // M23 — keep the linked teachers row in sync. Helper no-ops when no
    // teacher is linked to this staff_member.
    await mirrorStaffToTeacher(admin, id);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await verifyAdminOrEditor("staff");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Bulk delete: { ids: string[] }
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const ids: string[] = body.ids;

      // Fetch photo URLs for cleanup
      const { data: rows } = await admin
        .from("staff_members")
        .select("id, photo_url")
        .in("id", ids);

      const photoFiles = (rows ?? [])
        .map((r) => extractStoragePath(r.photo_url as string | null, "staff-photos"))
        .filter((p): p is string => !!p);

      if (photoFiles.length > 0) {
        await admin.storage.from("staff-photos").remove(photoFiles);
      }

      const { error } = await admin
        .from("staff_members")
        .delete()
        .in("id", ids);

      if (error) {
        console.error("Bulk staff delete error:", error);
        return NextResponse.json(
          { error: "Failed to delete staff members" },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, deleted: ids.length });
    }

    // Single delete: { id, photo_url }
    const { id, photo_url } = body;

    // Remove photo from storage if exists.
    if (photo_url) {
      const path = extractStoragePath(photo_url, "staff-photos");
      if (path) await admin.storage.from("staff-photos").remove([path]);
    }

    const { error } = await admin
      .from("staff_members")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Staff delete error:", error);
      return NextResponse.json(
        { error: "Failed to delete staff member" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
