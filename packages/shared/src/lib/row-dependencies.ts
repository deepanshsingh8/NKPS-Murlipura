import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a master row is holding up before it is deleted.
 *
 * Background: deleting a master row (a subject, a class, an academic year)
 * fans out through a dozen foreign keys. Most are ON DELETE CASCADE, so the
 * delete silently takes dependent rows with it; a few are the Postgres default
 * (NO ACTION), so the delete fails outright with a 23503 the UI used to render
 * as a bare "Failed to delete subject".
 *
 * Both halves are bugs. This module is the single place that says, per master
 * table, which tables point at it and what each one means:
 *
 *  - `blocking` — academic records we refuse to destroy on a delete, no matter
 *    what the FK says. Marks and attempts are the school's record of a
 *    student's year; the correct action for a subject that has them is
 *    Deactivate, not Delete.
 *  - `cascade` — structural links the delete legitimately removes. We still
 *    count them so the confirmation can name what is about to go.
 *
 * Kept in `packages/shared` because the admin proxy (server-side gate) and the
 * pre-flight endpoint (what the UI shows before asking to confirm) must never
 * disagree about the list.
 */

export type DependencySeverity = "blocking" | "cascade";

export interface DependencySpec {
  /** Dependent table holding the reference. */
  table: string;
  /** FK column on that table pointing back at the master row. */
  column: string;
  /** Human label used verbatim in the messages the admin reads. */
  label: string;
  severity: DependencySeverity;
}

export interface DependencyCount extends DependencySpec {
  count: number;
}

export interface DependencyReport {
  blocking: DependencyCount[];
  cascade: DependencyCount[];
  /** Total rows across `blocking`. Non-zero means the delete must be refused. */
  blockingTotal: number;
  /** Total rows across `cascade`. Removed with the master row. */
  cascadeTotal: number;
}

/**
 * Every FK that points at a master table we let admins delete.
 *
 * Adding a table here is what makes the proxy protect it, so it must stay in
 * step with the schema: a new `*_id uuid references subjects(id)` column needs
 * a line here too, or its rows get cascaded away with no warning.
 */
export const ROW_DEPENDENCIES: Record<string, DependencySpec[]> = {
  subjects: [
    // Blocking — a student's academic record.
    { table: "results", column: "subject_id", label: "exam result", severity: "blocking" },
    { table: "class_tests", column: "subject_id", label: "class test", severity: "blocking" },
    {
      table: "supplementary_attempts",
      column: "subject_id",
      label: "supplementary attempt",
      severity: "blocking",
    },
    // Cascade — structure and scheduling, rebuilt from the subject list.
    { table: "class_subjects", column: "subject_id", label: "class assignment", severity: "cascade" },
    { table: "stream_subjects", column: "subject_id", label: "stream link", severity: "cascade" },
    {
      table: "teacher_subjects",
      column: "subject_id",
      label: "teacher qualification",
      severity: "cascade",
    },
    {
      table: "timetable_periods",
      column: "subject_id",
      label: "timetable period",
      severity: "cascade",
    },
    { table: "exam_schedules", column: "subject_id", label: "datesheet row", severity: "cascade" },
    {
      table: "result_master_subjects",
      column: "subject_id",
      label: "result-master row",
      severity: "cascade",
    },
    {
      table: "elective_slot_options",
      column: "subject_id",
      label: "elective option",
      severity: "cascade",
    },
    {
      table: "student_elective_picks",
      column: "subject_id",
      label: "student elective pick",
      severity: "cascade",
    },
  ],
  streams: [
    // Blocking — these FKs are ON DELETE SET NULL, so a delete does not fail,
    // it quietly strands every class, enrolment and fee row that pointed at
    // the stream. The Streams tab of /academics/subjects shows its own usage
    // counts, but they are only a summary of what that page can read under
    // RLS — the rule that decides deletability belongs here, on the server.
    { table: "classes", column: "stream_id", label: "class", severity: "blocking" },
    {
      table: "student_enrollments",
      column: "stream_id",
      label: "student enrolment",
      severity: "blocking",
    },
    {
      table: "fee_structures",
      column: "stream_id",
      label: "fee structure",
      severity: "blocking",
    },
    { table: "stream_subjects", column: "stream_id", label: "subject link", severity: "cascade" },
  ],
  classes: [
    // Blocking — deleting a class with enrolments or marks wipes a cohort's
    // whole year through the cascades below it.
    {
      table: "student_enrollments",
      column: "class_id",
      label: "student enrolment",
      severity: "blocking",
    },
    { table: "results", column: "class_id", label: "exam result", severity: "blocking" },
    { table: "attendance", column: "class_id", label: "attendance record", severity: "blocking" },
    // Cascade — setup that belongs to the class and goes with it.
    { table: "class_subjects", column: "class_id", label: "subject assignment", severity: "cascade" },
    {
      table: "timetable_periods",
      column: "class_id",
      label: "timetable period",
      severity: "cascade",
    },
    { table: "exam_schedules", column: "class_id", label: "datesheet row", severity: "cascade" },
    { table: "calendar_events", column: "class_id", label: "calendar event", severity: "cascade" },
  ],
  // Teachers are never deleted from the UI — People → Staff offers Retire
  // only, because these three FKs have no ON DELETE rule and a delete either
  // fails with 23503 or erases who taught what. So every entry here is
  // `blocking`: the map's job for this table is to power the impact preview on
  // the retire dialog, telling the admin what work is about to lose its owner.
  // (migration 116)
  teachers: [
    {
      table: "timetable_periods",
      column: "teacher_id",
      label: "timetable period",
      severity: "blocking",
    },
    {
      table: "class_subjects",
      column: "teacher_id",
      label: "subject assignment",
      severity: "blocking",
    },
    {
      table: "classes",
      column: "class_teacher_id",
      label: "class teachership",
      severity: "blocking",
    },
  ],
  academic_years: [
    // Blocking — a year is the spine of every record filed under it.
    { table: "classes", column: "academic_year_id", label: "class", severity: "blocking" },
    {
      table: "student_enrollments",
      column: "academic_year_id",
      label: "student enrolment",
      severity: "blocking",
    },
    {
      table: "fee_payments",
      column: "academic_year_id",
      label: "fee payment",
      severity: "blocking",
    },
    {
      table: "fee_structures",
      column: "academic_year_id",
      label: "fee structure",
      severity: "blocking",
    },
    { table: "exam_types", column: "academic_year_id", label: "exam type", severity: "blocking" },
    {
      table: "calendar_events",
      column: "academic_year_id",
      label: "calendar event",
      severity: "cascade",
    },
  ],
};

/** Pluralise a label for the counts we print ("3 class tests", "1 exam result"). */
export function pluralise(label: string, count: number) {
  return count === 1 ? label : `${label}s`;
}

/** "45 exam results, 3 class tests" — the phrasing used in every message. */
export function describeDependencies(rows: DependencyCount[]) {
  return rows
    .filter((r) => r.count > 0)
    .map((r) => `${r.count} ${pluralise(r.label, r.count)}`)
    .join(", ");
}

/**
 * Counts every dependent row for one master row.
 *
 * Must be given the service-role client: several dependent tables (results,
 * attendance, class_tests) are behind RLS policies that an editor cannot read
 * through, and a policy-filtered count of 0 would read as "safe to delete".
 *
 * A table that errors (typically because a deployment hasn't run the migration
 * that creates it) is reported as `count: 0` rather than failing the whole
 * report — a missing table has no rows to strand.
 */
export async function countRowDependencies(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  masterTable: string,
  id: string
): Promise<DependencyReport> {
  const specs = ROW_DEPENDENCIES[masterTable] ?? [];

  const counted = await Promise.all(
    specs.map(async (spec): Promise<DependencyCount> => {
      const { count, error } = await admin
        .from(spec.table)
        .select(spec.column, { count: "exact", head: true })
        .eq(spec.column, id);
      if (error) {
        console.error(
          `[row-dependencies] count failed table=${spec.table} column=${spec.column}:`,
          error
        );
        return { ...spec, count: 0 };
      }
      return { ...spec, count: count ?? 0 };
    })
  );

  const blocking = counted.filter((c) => c.severity === "blocking");
  const cascade = counted.filter((c) => c.severity === "cascade");

  return {
    blocking,
    cascade,
    blockingTotal: blocking.reduce((sum, c) => sum + c.count, 0),
    cascadeTotal: cascade.reduce((sum, c) => sum + c.count, 0),
  };
}
