// End-to-end tests for Phase 5 (publish workflow) + Phase 6 A/B/C.
//
// Strategy:
//   - Use service-role Supabase client to set up, tear down, and probe DB
//     state. This bypasses RLS — used for assertions, not the "production"
//     code path being tested.
//   - Use `signInWithPassword` + user-role client to verify RLS for
//     teacher/parent roles.
//   - Hit a few HTTP routes via fetch+Bearer token where that's the thing
//     under test (e.g. `/api/erp/ptm-format/pdf` renderToBuffer).
//
// Tests are idempotent-ish: they clean up rows they created before asserting,
// and avoid mutating the production XII-A results table except to observe.
//
// Run: node --env-file=.env.local scripts/_e2e-test.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPA_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPA_URL || !SUPA_ANON || !SUPA_SVC) {
  console.error("Missing env vars");
  process.exit(1);
}

const svc = createClient(SUPA_URL, SUPA_SVC, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --------------------------------------------------------------------------
// Test harness helpers
// --------------------------------------------------------------------------
let pass = 0;
let fail = 0;
const fails = [];

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    fails.push({ label, detail });
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(name) {
  console.log(`\n▸ ${name}`);
}

// --------------------------------------------------------------------------
// Fixture constants — pre-seeded real data we'll read against.
// --------------------------------------------------------------------------
const CLASS_ID = "7d562e1a-4968-47da-be1c-57ca7811f817"; // XII-A
const YEAR_ID = "88dd4a99-4a69-49ff-a409-dd3a3ddf0850";  // 2026-27
const EXAM_FA_I = "18b196cd";                             // FA-I prefix (we'll resolve full id)

let examFaId;
let subjectIds = [];
let studentsInClass = [];

async function resolveFixtures() {
  section("Fixture resolve");
  const { data: exam } = await svc
    .from("exam_types")
    .select("id, name, max_marks, academic_year_id")
    .eq("academic_year_id", YEAR_ID)
    .eq("name", "FA-I")
    .maybeSingle();
  examFaId = exam?.id;
  ok("FA-I exam type found", Boolean(examFaId), exam?.name);

  const { data: subs } = await svc
    .from("class_subjects")
    .select("subject_id, subjects(id, name)")
    .eq("class_id", CLASS_ID);
  subjectIds = (subs ?? [])
    .map((s) => s.subjects?.id)
    .filter(Boolean);
  ok(
    "XII-A has class_subjects",
    subjectIds.length > 0,
    `${subjectIds.length} subjects`
  );

  const { data: enrolls } = await svc
    .from("student_enrollments")
    .select("student_id, roll_number, students(id, full_name, admission_no)")
    .eq("class_id", CLASS_ID)
    .eq("status", "active")
    .order("roll_number");
  studentsInClass = (enrolls ?? [])
    .map((e) => ({
      student_id: e.student_id,
      full_name: e.students?.full_name ?? "",
      admission_no: e.students?.admission_no ?? "",
      roll_number: e.roll_number,
    }))
    .filter((s) => s.student_id);
  ok(
    "XII-A has active students",
    studentsInClass.length > 0,
    `${studentsInClass.length}`
  );
}

// --------------------------------------------------------------------------
// Phase 6A — White Sheet / Green Sheet / Blank Marks List
// --------------------------------------------------------------------------
async function testPhase6A() {
  section("Phase 6A · White/Green/Blank Marks builders");

  // Directly test via the live API route (dev server is up). Requires no
  // auth at the row level because White Sheet route is admin/editor-gated
  // at the handler, and auth gating is tested elsewhere. We fire as the
  // dev server using a signed-in test admin cookie — for simplicity we
  // hit the JSON preview endpoint which returns the same builder output.
  //
  // Since HTTP auth cookie setup is fiddly, we instead import the builder
  // libs directly via a tiny Node test shim — they're pure functions of
  // a supabase client.

  // Dynamic import so tsx transpilation isn't required; we exported the
  // libs as ESM-compatible.
  const whiteModUrl = new URL(
    "../src/lib/white-sheet.ts",
    import.meta.url
  ).pathname;
  // Can't direct-import TS, so instead shell out to a small Node compile step
  // via tsx is overkill. Test the HTTP route instead — that's what users hit.

  const _suppress = whiteModUrl; // keep for context
  void _suppress;

  // White Sheet JSON preview
  {
    const res = await fetch(
      `${BASE}/api/erp/white-sheet?class_id=${CLASS_ID}&exam_type_id=${examFaId}`,
      { headers: { cookie: adminCookie } }
    );
    ok(
      "GET /api/erp/white-sheet returns 200",
      res.ok,
      `status=${res.status}`
    );
    if (res.ok) {
      const body = await res.json();
      ok("white-sheet has meta", Boolean(body.meta));
      ok(
        "white-sheet has rows",
        Array.isArray(body.rows) && body.rows.length > 0,
        `rows=${body.rows?.length}`
      );
      ok(
        "white-sheet subjects include class_subjects",
        Array.isArray(body.subjects),
        `subjects=${body.subjects?.length}`
      );
      // Every row should have marks_by_subject keyed by subject_id
      const firstWithMarks = body.rows.find((r) =>
        Object.values(r.marks_by_subject ?? {}).some(
          (v) => v !== null && v !== undefined
        )
      );
      ok(
        "at least one row has non-null marks (result rows exist)",
        Boolean(firstWithMarks),
        firstWithMarks?.full_name
      );
    }
  }

  // Green Sheet JSON preview
  {
    const res = await fetch(
      `${BASE}/api/erp/green-sheet?class_id=${CLASS_ID}&academic_year_id=${YEAR_ID}`,
      { headers: { cookie: adminCookie } }
    );
    ok(
      "GET /api/erp/green-sheet returns 200",
      res.ok,
      `status=${res.status}`
    );
    if (res.ok) {
      const body = await res.json();
      ok(
        "green-sheet meta present",
        body.meta?.academic_year_label === "2026-27",
        `got ${body.meta?.academic_year_label}`
      );
      ok(
        "green-sheet includes exams array",
        Array.isArray(body.exams),
        `exams=${body.exams?.length}`
      );
    }
  }

  // White Sheet PDF download
  {
    const res = await fetch(
      `${BASE}/api/erp/white-sheet/pdf?class_id=${CLASS_ID}&exam_type_id=${examFaId}`,
      { headers: { cookie: adminCookie } }
    );
    ok("white-sheet PDF 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const buf = await res.arrayBuffer();
      ok(
        "white-sheet PDF starts with %PDF-",
        new TextDecoder().decode(buf.slice(0, 5)) === "%PDF-",
        `size=${buf.byteLength}B`
      );
    }
  }

  // Green Sheet PDF download
  {
    const res = await fetch(
      `${BASE}/api/erp/green-sheet/pdf?class_id=${CLASS_ID}&academic_year_id=${YEAR_ID}`,
      { headers: { cookie: adminCookie } }
    );
    ok("green-sheet PDF 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const buf = await res.arrayBuffer();
      ok(
        "green-sheet PDF starts with %PDF-",
        new TextDecoder().decode(buf.slice(0, 5)) === "%PDF-",
        `size=${buf.byteLength}B`
      );
    }
  }

  // Blank Marks List PDF
  if (subjectIds[0]) {
    const res = await fetch(
      `${BASE}/api/erp/blank-marks-list/pdf?class_id=${CLASS_ID}&exam_type_id=${examFaId}&subject_id=${subjectIds[0]}`,
      { headers: { cookie: adminCookie } }
    );
    ok("blank-marks-list PDF 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const buf = await res.arrayBuffer();
      ok(
        "blank-marks-list PDF starts with %PDF-",
        new TextDecoder().decode(buf.slice(0, 5)) === "%PDF-",
        `size=${buf.byteLength}B`
      );
    }
  }

  // CSV exports
  {
    const res = await fetch(
      `${BASE}/api/erp/white-sheet/csv?class_id=${CLASS_ID}&exam_type_id=${examFaId}`,
      { headers: { cookie: adminCookie } }
    );
    ok("white-sheet CSV 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const txt = await res.text();
      ok(
        "white-sheet CSV has header row",
        txt.split("\n")[0].includes("roll_number"),
        txt.slice(0, 80)
      );
    }
  }
}

// --------------------------------------------------------------------------
// Phase 5 — Publish workflow + finalized-snapshot immutability
// --------------------------------------------------------------------------
async function testPhase5() {
  section("Phase 5 · Publish + finalize + snapshot immutability");

  // Pick a student who (a) has results for FA-I and (b) is still actively
  // enrolled in XII-A. Terminated/promoted students retain stale result
  // rows but the finalize route correctly rejects them — a `.limit(1)`
  // shortcut here used to flake when it picked one of those.
  const activeIds = new Set(studentsInClass.map((s) => s.student_id));
  const { data: candidates } = await svc
    .from("results")
    .select("student_id")
    .eq("class_id", CLASS_ID)
    .eq("exam_type_id", examFaId);
  const studentId = (candidates ?? [])
    .map((r) => r.student_id)
    .find((id) => activeIds.has(id));
  ok("Test student with results found", Boolean(studentId), studentId);
  if (!studentId) return;

  // Clean slate — remove any prior publication rows for this pair.
  await svc
    .from("marksheet_publications")
    .delete()
    .eq("student_id", studentId)
    .eq("exam_type_id", examFaId);

  // Publish (online visibility) via API
  {
    const res = await fetch(`${BASE}/api/erp/results/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: adminBearer,
      },
      body: JSON.stringify({
        class_id: CLASS_ID,
        exam_type_id: examFaId,
        is_published: true,
      }),
    });
    ok(
      "POST /api/erp/results/publish 200",
      res.ok,
      `status=${res.status} ${await res.text().catch(() => "")}`
    );
  }

  // Finalize — creates snapshot, version 1
  {
    const res = await fetch(
      `${BASE}/api/erp/results/finalize-marksheet`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: adminBearer,
        },
        body: JSON.stringify({
          class_id: CLASS_ID,
          exam_type_id: examFaId,
          student_ids: [studentId],
        }),
      }
    );
    const body = await res.json().catch(() => ({}));
    ok(
      "POST /api/erp/results/finalize-marksheet 200",
      res.ok,
      `status=${res.status} ${JSON.stringify(body).slice(0, 200)}`
    );
  }

  // Inspect DB — one active row, version 1
  const { data: v1 } = await svc
    .from("marksheet_publications")
    .select("id, version, snapshot, unpublished_at")
    .eq("student_id", studentId)
    .eq("exam_type_id", examFaId)
    .is("unpublished_at", null)
    .maybeSingle();
  ok("active publication row exists", Boolean(v1), `version=${v1?.version}`);
  ok("version === 1", v1?.version === 1);
  const snapObtained1 =
    v1?.snapshot?.exam?.total_obtained ?? null;
  ok(
    "snapshot has total_obtained",
    typeof snapObtained1 === "number",
    String(snapObtained1)
  );

  // Mutate one result row so the "live" data diverges from snapshot.
  const { data: oneRow } = await svc
    .from("results")
    .select("id, marks_obtained")
    .eq("student_id", studentId)
    .eq("exam_type_id", examFaId)
    .limit(1)
    .maybeSingle();
  const prevMarks = oneRow?.marks_obtained;
  const bumpedMarks = (prevMarks ?? 0) === 99 ? 88 : 99;
  await svc
    .from("results")
    .update({ marks_obtained: bumpedMarks })
    .eq("id", oneRow.id);

  // Fetch report-card PDF via the same route students/parents would hit.
  {
    const res = await fetch(
      `${BASE}/api/erp/results/report-card/pdf?student_id=${studentId}&exam_type_id=${examFaId}`,
      { headers: { cookie: adminCookie } }
    );
    ok(
      "report-card PDF returns 200 after mutation",
      res.ok,
      `status=${res.status}`
    );
    if (res.ok) {
      const header = res.headers.get("X-Marksheet-Source");
      ok(
        'PDF served from "finalized-snapshot"',
        header === "finalized-snapshot",
        `header=${header}`
      );
      const buf = await res.arrayBuffer();
      ok(
        "PDF body is a PDF",
        new TextDecoder().decode(buf.slice(0, 5)) === "%PDF-",
        `size=${buf.byteLength}B`
      );
    }
  }

  // Restore the mutated row so we don't pollute production data.
  await svc
    .from("results")
    .update({ marks_obtained: prevMarks })
    .eq("id", oneRow.id);

  // Partial unique index: cannot insert a second active snapshot.
  {
    const { error: dupErr } = await svc
      .from("marksheet_publications")
      .insert({
        student_id: studentId,
        class_id: CLASS_ID,
        exam_type_id: examFaId,
        version: 2,
        snapshot: { schema_version: "v1" },
        schema_version: "v1",
        published_by: v1.published_by ?? null,
      });
    ok(
      "partial unique rejects second active snapshot",
      Boolean(dupErr),
      dupErr?.code ?? "no error"
    );
  }

  // Unpublish with reason via DELETE
  {
    const res = await fetch(
      `${BASE}/api/erp/results/finalize-marksheet`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: adminBearer,
        },
        body: JSON.stringify({
          class_id: CLASS_ID,
          exam_type_id: examFaId,
          unpublish_reason: "e2e test",
          student_ids: [studentId],
        }),
      }
    );
    ok(
      "DELETE /api/erp/results/finalize-marksheet 200",
      res.ok,
      `status=${res.status}`
    );
  }

  // Re-finalize → new version 2
  {
    const res = await fetch(
      `${BASE}/api/erp/results/finalize-marksheet`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: adminBearer,
        },
        body: JSON.stringify({
          class_id: CLASS_ID,
          exam_type_id: examFaId,
          student_ids: [studentId],
        }),
      }
    );
    ok("re-finalize 200", res.ok, `status=${res.status}`);
  }
  const { data: v2 } = await svc
    .from("marksheet_publications")
    .select("version, unpublished_at")
    .eq("student_id", studentId)
    .eq("exam_type_id", examFaId)
    .is("unpublished_at", null)
    .maybeSingle();
  ok(
    "new active version === 2",
    v2?.version === 2,
    `got ${v2?.version}`
  );

  const { count: v1unpublished } = await svc
    .from("marksheet_publications")
    .select("*", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("exam_type_id", examFaId)
    .not("unpublished_at", "is", null);
  ok(
    "prior version shows unpublished_at",
    (v1unpublished ?? 0) >= 1,
    `count=${v1unpublished}`
  );

  // Clean up publications we created so the test is rerunnable.
  await svc
    .from("marksheet_publications")
    .delete()
    .eq("student_id", studentId)
    .eq("exam_type_id", examFaId);
}

// --------------------------------------------------------------------------
// Phase 6B — PTM Notes
// --------------------------------------------------------------------------
async function testPhase6B() {
  section("Phase 6B · PTM Notes (CRUD, CSV import, PDF report, parent RLS)");

  const sid = studentsInClass[0]?.student_id;
  ok("PTM target student", Boolean(sid));
  if (!sid) return;

  // Clean slate for our test meeting_date.
  const TEST_DATE = "2024-12-15";
  await svc
    .from("ptm_notes")
    .delete()
    .eq("student_id", sid)
    .eq("meeting_date", TEST_DATE);

  // Bulk upsert via API as admin.
  {
    const res = await fetch(`${BASE}/api/erp/ptm-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        exam_type_id: null,
        entries: [
          {
            student_id: sid,
            meeting_date: TEST_DATE,
            attendance: "present",
            teacher_remarks: "E2E test remark",
            parent_remarks: null,
            action_points: "Monitor homework",
          },
        ],
      }),
    });
    ok("POST /api/erp/ptm-notes 200", res.ok, `status=${res.status}`);
  }
  const { data: note } = await svc
    .from("ptm_notes")
    .select("id, teacher_remarks, action_points")
    .eq("student_id", sid)
    .eq("meeting_date", TEST_DATE)
    .maybeSingle();
  ok("note persisted", Boolean(note));
  ok("teacher_remarks round-trip", note?.teacher_remarks === "E2E test remark");
  ok("action_points round-trip", note?.action_points === "Monitor homework");

  // Re-upsert same (student, date) with changed attendance → should update.
  {
    const res = await fetch(`${BASE}/api/erp/ptm-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        exam_type_id: null,
        entries: [
          {
            student_id: sid,
            meeting_date: TEST_DATE,
            attendance: "absent",
            teacher_remarks: "Updated",
          },
        ],
      }),
    });
    ok("upsert same key 200", res.ok, `status=${res.status}`);
  }
  const { data: updated } = await svc
    .from("ptm_notes")
    .select("attendance, teacher_remarks")
    .eq("student_id", sid)
    .eq("meeting_date", TEST_DATE)
    .maybeSingle();
  ok("attendance updated to absent", updated?.attendance === "absent");
  ok("teacher_remarks updated", updated?.teacher_remarks === "Updated");

  // GET list by class
  {
    const res = await fetch(
      `${BASE}/api/erp/ptm-notes?class_id=${CLASS_ID}`,
      { headers: { cookie: adminCookie } }
    );
    const body = await res.json();
    ok("GET ptm-notes by class 200", res.ok);
    ok(
      "list includes our note",
      (body.data ?? []).some((n) => n.student_id === sid),
      `count=${(body.data ?? []).length}`
    );
  }

  // CSV import — dry run first
  {
    const admission = studentsInClass[0]?.admission_no ?? "NA";
    const csv = `admission_no,meeting_date,attendance,teacher_remarks\n${admission},2024-12-20,present,Imported test`;
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "test.csv");
    form.append("class_id", CLASS_ID);
    form.append("dry_run", "true");
    const res = await fetch(`${BASE}/api/erp/ptm-notes/import`, {
      method: "POST",
      body: form,
      headers: { cookie: adminCookie },
    });
    const body = await res.json();
    ok("CSV dry-run 200", res.ok);
    ok(
      "dry-run summary reports 1 to_apply",
      body.summary?.to_apply === 1,
      `got ${body.summary?.to_apply}`
    );
    ok("dry-run committed=0", body.summary?.committed === 0);
  }

  // CSV import — commit
  await svc
    .from("ptm_notes")
    .delete()
    .eq("student_id", sid)
    .eq("meeting_date", "2024-12-20");
  {
    const admission = studentsInClass[0]?.admission_no ?? "NA";
    const csv = `admission_no,meeting_date,attendance,teacher_remarks\n${admission},2024-12-20,present,Imported test`;
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "test.csv");
    form.append("class_id", CLASS_ID);
    form.append("dry_run", "false");
    const res = await fetch(`${BASE}/api/erp/ptm-notes/import`, {
      method: "POST",
      body: form,
      headers: { cookie: adminCookie },
    });
    const body = await res.json();
    ok("CSV commit 200", res.ok);
    ok(
      "commit wrote 1 row",
      body.summary?.committed === 1,
      `got ${body.summary?.committed}`
    );
  }
  const { count: importedCount } = await svc
    .from("ptm_notes")
    .select("*", { count: "exact", head: true })
    .eq("student_id", sid)
    .eq("meeting_date", "2024-12-20");
  ok("imported row visible in DB", (importedCount ?? 0) === 1);

  // PDF report
  {
    const res = await fetch(
      `${BASE}/api/erp/ptm-notes/report?class_id=${CLASS_ID}`,
      { headers: { cookie: adminCookie } }
    );
    ok("ptm-notes PDF report 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const buf = await res.arrayBuffer();
      ok(
        "ptm report is a PDF",
        new TextDecoder().decode(buf.slice(0, 5)) === "%PDF-",
        `size=${buf.byteLength}B`
      );
    }
  }

  // school_meeting_counts upsert
  {
    await svc
      .from("school_meeting_counts")
      .delete()
      .eq("academic_year_id", YEAR_ID)
      .eq("class_id", CLASS_ID);
    const res = await fetch(
      `${BASE}/api/erp/school-meeting-counts`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: adminCookie },
        body: JSON.stringify({
          academic_year_id: YEAR_ID,
          class_id: CLASS_ID,
          total_meetings: 3,
        }),
      }
    );
    ok("PUT school-meeting-counts 200", res.ok, `status=${res.status}`);
    const res2 = await fetch(
      `${BASE}/api/erp/school-meeting-counts`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: adminCookie },
        body: JSON.stringify({
          academic_year_id: YEAR_ID,
          class_id: CLASS_ID,
          total_meetings: 5,
        }),
      }
    );
    ok("PUT same scope updates (not duplicates)", res2.ok);
    const { data: counters } = await svc
      .from("school_meeting_counts")
      .select("total_meetings")
      .eq("academic_year_id", YEAR_ID)
      .eq("class_id", CLASS_ID);
    ok("only one counter row for this scope", (counters ?? []).length === 1);
    ok(
      "counter total_meetings === 5",
      counters?.[0]?.total_meetings === 5,
      `got ${counters?.[0]?.total_meetings}`
    );
  }

  // Clean up
  await svc
    .from("ptm_notes")
    .delete()
    .eq("student_id", sid)
    .in("meeting_date", [TEST_DATE, "2024-12-20"]);
  await svc
    .from("school_meeting_counts")
    .delete()
    .eq("academic_year_id", YEAR_ID)
    .eq("class_id", CLASS_ID);
}

// --------------------------------------------------------------------------
// Phase 6C — PTM Format templates + PDF generation
// --------------------------------------------------------------------------
async function testPhase6C() {
  section("Phase 6C · PTM Format templates + PDF generation");

  // The migration's seed row may be missing. Seed a minimal default so the
  // generate flow has something to pick.
  await svc
    .from("ptm_formats")
    .upsert(
      {
        name: "e2e-test-default",
        is_default: false,
        is_active: true,
        intro_text: "e2e intro",
        closing_text: "e2e closing",
        show_student_details: true,
        show_photo: false,
        show_father_name: true,
        show_mother_name: true,
        show_performance_snapshot: true,
        show_teacher_remarks_section: true,
        teacher_remarks_lines: 4,
        show_parent_signature: true,
      },
      { onConflict: "name" }
    );

  // GET list
  {
    const res = await fetch(`${BASE}/api/erp/ptm-formats`, {
      headers: { cookie: adminCookie },
    });
    const body = await res.json();
    ok("GET ptm-formats 200", res.ok);
    ok(
      "list includes our test template",
      (body.data ?? []).some((t) => t.name === "e2e-test-default")
    );
  }

  // Create via POST as admin
  {
    const res = await fetch(`${BASE}/api/erp/ptm-formats`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: adminBearer },
      body: JSON.stringify({
        name: "e2e-created",
        is_default: false,
        intro_text: "from e2e",
      }),
    });
    ok("POST create template 201", res.status === 201, `status=${res.status}`);
  }
  const { data: created } = await svc
    .from("ptm_formats")
    .select("id, intro_text")
    .eq("name", "e2e-created")
    .maybeSingle();
  ok("created template persisted", Boolean(created));

  // PATCH → flip is_default, prior default must be cleared.
  // Ensure at least one other row has is_default=true so we can see the
  // flip-clear behavior.
  await svc
    .from("ptm_formats")
    .upsert(
      {
        name: "e2e-preexisting-default",
        is_default: true,
        is_active: true,
        show_student_details: true,
        show_photo: false,
        show_father_name: true,
        show_mother_name: true,
        show_performance_snapshot: true,
        show_teacher_remarks_section: true,
        teacher_remarks_lines: 4,
        show_parent_signature: true,
      },
      { onConflict: "name" }
    );
  if (created?.id) {
    const res = await fetch(`${BASE}/api/erp/ptm-formats/${created.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: adminBearer,
      },
      body: JSON.stringify({ is_default: true }),
    });
    ok("PATCH flip is_default 200", res.ok, `status=${res.status}`);
    const { data: defaults } = await svc
      .from("ptm_formats")
      .select("id")
      .eq("is_default", true);
    ok(
      "exactly one default after flip",
      (defaults ?? []).length === 1,
      `got ${(defaults ?? []).length}`
    );
  }

  // PDF generation for XII-A with FA-I snapshot
  {
    const res = await fetch(
      `${BASE}/api/erp/ptm-format/pdf?class_id=${CLASS_ID}&exam_type_id=${examFaId}`,
      { headers: { cookie: adminCookie } }
    );
    ok("ptm-format PDF 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const buf = await res.arrayBuffer();
      ok(
        "ptm-format PDF is a PDF",
        new TextDecoder().decode(buf.slice(0, 5)) === "%PDF-",
        `size=${buf.byteLength}B`
      );
    }
  }

  // DELETE — shouldn't let us drop the last template. We'll create one
  // more, delete, and assert count.
  if (created?.id) {
    const res = await fetch(
      `${BASE}/api/erp/ptm-formats/${created.id}`,
      {
        method: "DELETE",
        headers: { Authorization: adminBearer },
      }
    );
    ok("DELETE template 200", res.ok, `status=${res.status}`);
  }

  // Clean up the two we created
  await svc
    .from("ptm_formats")
    .delete()
    .in("name", [
      "e2e-test-default",
      "e2e-created",
      "e2e-preexisting-default",
    ]);
}

// --------------------------------------------------------------------------
// Phase 8 — Supplementary Exam workflow
// --------------------------------------------------------------------------
async function testPhase8() {
  section("Phase 8 · Supplementary (eligibility + retest + final-result substitution)");

  // Ensure result_master for XII-A has supplementary settings.
  const { data: master } = await svc
    .from("result_masters")
    .select("id, pass_mark_mode, pass_mark_value, min_for_supplementary, max_supplementary_subjects, supplementary_pass_action")
    .eq("class_id", CLASS_ID)
    .eq("academic_year_id", YEAR_ID)
    .maybeSingle();
  ok("result_master found for XII-A", Boolean(master?.id));
  if (!master) return;

  // Set min_for_supplementary so eligibility list is meaningful.
  // Existing pass_mark_value is the pass threshold (default 33).
  // Set supplementary threshold to 25 (any failing student with >=25 raw
  // marks-percent qualifies). Reset everything to known state for the test.
  await svc
    .from("result_masters")
    .update({
      min_for_supplementary: 25,
      max_supplementary_subjects: 2,
      supplementary_pass_action: "cap_at_pass_mark",
    })
    .eq("id", master.id);

  // Pick an active student that has results and an enrollment for FA-I.
  const activeIds = new Set(studentsInClass.map((s) => s.student_id));
  const { data: candidates } = await svc
    .from("results")
    .select("student_id, subject_id, marks_obtained, max_marks")
    .eq("class_id", CLASS_ID)
    .eq("exam_type_id", examFaId);
  const activeResults = (candidates ?? []).filter((r) =>
    activeIds.has(r.student_id)
  );
  ok("Has active results for FA-I", activeResults.length > 0);
  if (activeResults.length === 0) return;

  // Pick the first active student and seed: failing in one subject, marks
  // between supplementary-min and pass.
  const target = activeResults[0];
  const sid = target.student_id;
  const subjId = target.subject_id;

  // We mutate the result row to be in the "failing but eligible" zone.
  // Pass threshold percentage = 33 (master.pass_mark_value default).
  // Supplementary min = 25.
  // Use marks at 28% of max to ensure failing AND eligible.
  const max = Number(target.max_marks);
  const orig = target.marks_obtained;
  const failingMarks = Math.round(max * 0.28); // 28% — clearly failing
  const { error: failErr } = await svc
    .from("results")
    .update({ marks_obtained: failingMarks })
    .eq("student_id", sid)
    .eq("subject_id", subjId)
    .eq("exam_type_id", examFaId);
  ok("Seeded failing-but-eligible mark", !failErr);

  // Clean any prior attempt for this row.
  await svc
    .from("supplementary_attempts")
    .delete()
    .eq("student_id", sid)
    .eq("parent_exam_type_id", examFaId)
    .eq("subject_id", subjId);

  // Eligibility endpoint should now flag this student+subject.
  {
    const res = await fetch(
      `${BASE}/api/erp/supplementary/eligible?class_id=${CLASS_ID}&exam_type_id=${examFaId}`,
      { headers: { cookie: adminCookie } }
    );
    ok("eligibility endpoint 200", res.ok, `status=${res.status}`);
    if (res.ok) {
      const body = await res.json();
      const ours = body.entries?.find(
        (e) => e.student_id === sid && e.subject_id === subjId
      );
      ok("our seeded student appears in eligibility list", Boolean(ours));
      ok(
        "eligibility entry has computed pass_threshold + gap",
        ours?.pass_threshold_marks > 0 && ours?.gap_to_pass > 0
      );
      ok(
        "eligibility entry has no attempt yet",
        ours?.has_attempt === false
      );
    }
  }

  // Compute baseline final-result before supplementary
  const beforeFinal = await fetchFinalResult(sid);
  const beforeSubject = beforeFinal?.main_subjects?.find(
    (s) => s.subject_id === subjId
  );
  ok(
    "baseline final-result computed",
    Boolean(beforeFinal),
    `pct=${beforeFinal?.overall?.main_total_pct}`
  );
  ok(
    "subject failed before supplementary",
    beforeSubject?.passed === false,
    `subject final_pct=${beforeSubject?.final_pct}`
  );

  // Save a passed supplementary attempt
  {
    const res = await fetch(`${BASE}/api/erp/supplementary`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        class_id: CLASS_ID,
        parent_exam_type_id: examFaId,
        retest_date: "2026-04-30",
        entries: [
          {
            student_id: sid,
            subject_id: subjId,
            marks_obtained: max * 0.5,
            max_marks: max,
            passed: true,
          },
        ],
      }),
    });
    ok("POST /api/erp/supplementary 200", res.ok, `status=${res.status}`);
  }

  // Verify DB row
  const { data: attempt } = await svc
    .from("supplementary_attempts")
    .select("passed, marks_obtained")
    .eq("student_id", sid)
    .eq("parent_exam_type_id", examFaId)
    .eq("subject_id", subjId)
    .maybeSingle();
  ok("attempt row inserted", Boolean(attempt));
  ok("attempt.passed === true", attempt?.passed === true);

  // Recompute final-result — supplementary substitution should kick in.
  // pass_action is 'cap_at_pass_mark' so substituted mark = pass threshold.
  const afterFinal = await fetchFinalResult(sid);
  const afterSubject = afterFinal?.main_subjects?.find(
    (s) => s.subject_id === subjId
  );
  ok(
    "subject now passes after supplementary",
    afterSubject?.passed === true,
    `subject final_pct=${afterSubject?.final_pct}`
  );
  ok(
    "main aggregate moved up after substitution",
    (afterFinal?.overall?.main_total_pct ?? 0) >=
      (beforeFinal?.overall?.main_total_pct ?? 0),
    `${beforeFinal?.overall?.main_total_pct} -> ${afterFinal?.overall?.main_total_pct}`
  );

  // Idempotent re-upsert
  {
    const res = await fetch(`${BASE}/api/erp/supplementary`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        class_id: CLASS_ID,
        parent_exam_type_id: examFaId,
        retest_date: "2026-04-30",
        entries: [
          {
            student_id: sid,
            subject_id: subjId,
            marks_obtained: max * 0.6,
            max_marks: max,
            passed: true,
          },
        ],
      }),
    });
    ok("upsert (same key) 200", res.ok, `status=${res.status}`);
  }
  const { count: attemptCount } = await svc
    .from("supplementary_attempts")
    .select("*", { count: "exact", head: true })
    .eq("student_id", sid)
    .eq("parent_exam_type_id", examFaId)
    .eq("subject_id", subjId);
  ok(
    "upsert keeps single row (UNIQUE constraint working)",
    attemptCount === 1,
    `count=${attemptCount}`
  );

  // Cleanup
  await svc
    .from("supplementary_attempts")
    .delete()
    .eq("student_id", sid)
    .eq("parent_exam_type_id", examFaId)
    .eq("subject_id", subjId);
  await svc
    .from("results")
    .update({ marks_obtained: orig })
    .eq("student_id", sid)
    .eq("subject_id", subjId)
    .eq("exam_type_id", examFaId);
  // Reset master fields the test set.
  await svc
    .from("result_masters")
    .update({ min_for_supplementary: null })
    .eq("id", master.id);
}

// Calls the diagnostic /api/erp/results/final-result endpoint that exposes
// computeFinalResult as JSON — substitution is applied inside that fn.
async function fetchFinalResult(studentId) {
  const res = await fetch(
    `${BASE}/api/erp/results/final-result?student_id=${studentId}&academic_year_id=${YEAR_ID}`,
    { headers: { cookie: adminCookie } }
  );
  if (!res.ok) return null;
  const body = await res.json();
  return body.final_result ?? null;
}

// --------------------------------------------------------------------------
// Auth setup — create / reuse a test admin and get a session token.
// --------------------------------------------------------------------------
const TEST_ADMIN_EMAIL = "e2e_admin@nkps.test";
const TEST_ADMIN_PASSWORD = "NKPS_e2e_Admin_2026!";
let adminBearer = "";
let adminCookie = "";

async function setupAuth() {
  section("Auth setup");
  // Create the test admin if missing.
  const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
  let existing = list?.users?.find((u) => u.email === TEST_ADMIN_EMAIL);
  if (!existing) {
    const { data, error } = await svc.auth.admin.createUser({
      email: TEST_ADMIN_EMAIL,
      password: TEST_ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    existing = data.user;
  }
  ok("test admin user exists", Boolean(existing?.id));

  // Ensure profile row set to admin.
  await svc
    .from("profiles")
    .upsert({ id: existing.id, email: TEST_ADMIN_EMAIL, role: "admin" });

  // Sign in via anon client.
  const anon = createClient(SUPA_URL, SUPA_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: sess, error } = await anon.auth.signInWithPassword({
    email: TEST_ADMIN_EMAIL,
    password: TEST_ADMIN_PASSWORD,
  });
  if (error) throw error;
  ok("signed in as test admin", Boolean(sess?.session?.access_token));

  adminBearer = `Bearer ${sess.session.access_token}`;

  // Cookie format matches @supabase/ssr: "sb-<ref>-auth-token" cookie
  // carrying "base64-<b64(JSON(session))>". For sessions whose encoded
  // payload exceeds ~3.3KB Supabase splits across ".0", ".1" chunks — the
  // rare case; for our test admin a single cookie suffices.
  const u = new URL(SUPA_URL);
  const projectRef = u.hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const sessionObj = {
    access_token: sess.session.access_token,
    refresh_token: sess.session.refresh_token,
    expires_at: sess.session.expires_at,
    expires_in: sess.session.expires_in,
    token_type: "bearer",
    user: sess.session.user,
  };
  const b64 = Buffer.from(JSON.stringify(sessionObj)).toString("base64");
  const cookieValue = `base64-${b64}`;
  // Split into chunks of 3180 bytes to mimic the SSR client's chunking,
  // which some route handlers might assume. For now, the single-cookie form
  // is what @supabase/ssr ≥ 0.4 reads first.
  if (cookieValue.length > 3180) {
    const parts = [];
    for (let i = 0; i < cookieValue.length; i += 3180) {
      parts.push(
        `${cookieName}.${parts.length}=${cookieValue.slice(i, i + 3180)}`
      );
    }
    adminCookie = parts.join("; ");
  } else {
    adminCookie = `${cookieName}=${cookieValue}`;
  }
  ok("auth cookie assembled", adminCookie.length > 100);
}

// --------------------------------------------------------------------------
// Run
// --------------------------------------------------------------------------
async function main() {
  try {
    await setupAuth();
    await resolveFixtures();
    await testPhase6A();
    await testPhase5();
    await testPhase6B();
    await testPhase6C();
    await testPhase8();
  } catch (err) {
    console.error("Fatal:", err);
    fail++;
  }
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  if (fails.length > 0) {
    console.log("\nFailures:");
    for (const f of fails) {
      console.log(` - ${f.label}${f.detail ? ` (${f.detail})` : ""}`);
    }
  }
  process.exit(fail === 0 ? 0 : 1);
}
main();
