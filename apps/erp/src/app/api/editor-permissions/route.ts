import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import {
  isFeatureKey,
  canHoldEditorCapability,
  type FeatureKey,
} from "@nkps/shared/lib/permissions";

// GET /api/editor-permissions?editor_id=<uuid>
// Returns the list of feature_keys currently granted to that editor.
export async function GET(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const editorId = request.nextUrl.searchParams.get("editor_id");
  if (!editorId) {
    return NextResponse.json({ error: "editor_id required" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("editor_permissions")
    .select("feature_key")
    .eq("editor_id", editorId);

  if (error) {
    console.error("Fetch editor permissions error:", error);
    return NextResponse.json({ error: "Failed to fetch permissions" }, { status: 500 });
  }

  return NextResponse.json({
    feature_keys: (data ?? []).map((r) => r.feature_key),
  });
}

// PUT /api/editor-permissions
// Body: { editor_id: string, feature_keys: FeatureKey[] }
// Atomically replaces that editor's permissions with the given set.
export async function PUT(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const editorId = body.editor_id as string | undefined;
    const rawKeys = body.feature_keys;

    if (!editorId) {
      return NextResponse.json({ error: "editor_id required" }, { status: 400 });
    }
    if (!Array.isArray(rawKeys)) {
      return NextResponse.json(
        { error: "feature_keys must be an array" },
        { status: 400 }
      );
    }

    // Silently drop keys that aren't in the current FEATURE_CATALOG. This
    // covers two real cases: (1) the dialog round-trips stale grants from
    // the DB after a feature_key was retired, (2) a future client sends an
    // unknown key. Rejecting outright would lock the admin out of saving
    // until they manually purged the old row.
    const validKeys: FeatureKey[] = [];
    for (const k of rawKeys) {
      if (!isFeatureKey(k)) continue;
      if (!validKeys.includes(k)) validKeys.push(k);
    }

    // Editor capability is meaningful only for staff and teachers. Admins
    // bypass capability checks entirely (granting them features is harmless
    // but pointless); students and parents cannot hold any.
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", editorId)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (!canHoldEditorCapability(profile.role)) {
      return NextResponse.json(
        { error: "Editor capability can only be granted to staff or teachers" },
        { status: 400 }
      );
    }

    // Identify the admin making the change so we can record it.
    const {
      data: { user },
    } = await admin.auth.getUser(
      (request.headers.get("authorization") ?? "").slice(7)
    );

    // Self-elevation guard: even though `verifyAdmin()` rules out editors
    // calling this today, an admin (or future code path) editing their own
    // row can lock themselves out of the admin role or grant their second
    // editor identity unbounded power. Block it; admins manage their own
    // role via /api/users.
    if (user?.id && user.id === editorId) {
      return NextResponse.json(
        { error: "You cannot modify your own permissions" },
        { status: 400 }
      );
    }

    // Replace: delete existing rows, then insert new set.
    const { error: delError } = await admin
      .from("editor_permissions")
      .delete()
      .eq("editor_id", editorId);

    if (delError) {
      console.error("Delete editor permissions error:", delError);
      return NextResponse.json(
        { error: "Failed to update permissions" },
        { status: 500 }
      );
    }

    if (validKeys.length > 0) {
      const rows = validKeys.map((feature_key) => ({
        editor_id: editorId,
        feature_key,
        granted_by: user?.id ?? null,
      }));
      const { error: insError } = await admin
        .from("editor_permissions")
        .insert(rows);

      if (insError) {
        console.error("Insert editor permissions error:", insError);
        return NextResponse.json(
          { error: "Failed to save permissions" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, feature_keys: validKeys });
  } catch (err) {
    console.error("Editor permissions PUT error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
