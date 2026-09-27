// Column registry for the server-side student export.
//
// The ~50 profile fields come from STUDENT_TEMPLATE_FIELDS rather than being
// restated: that registry is already the single source of truth for what each
// field is called and how it renders (bulk upload headers, form labels, the
// per-student xlsx), and a second hand-kept list would drift within a release.
//
// The enrollment- and join-derived columns are declared here because they have
// no template entry — they are not properties of a student, they are
// properties of a student *in a session*.

import {
  STUDENT_TEMPLATE_FIELDS,
  formatFieldValue,
  indianNationalFromNationality,
} from "@nkps/shared/lib/student-template";
import type { ExportColumn } from "@nkps/shared/lib/table-export";
import type { SessionRosterRow } from "@/lib/student-roster";

type Row = SessionRosterRow;

export interface StudentExportLookups {
  subjectNames: Map<string, string[]>;
  streamNameById: Map<string, string>;
  busNameById: Map<string, string>;
  stopNameById: Map<string, string>;
}

/** Ticked when the dialog opens — a readable roll, not fifty columns. */
const DEFAULT_FIELDS = [
  "admission_no",
  "full_name",
  "class",
  "section",
  "roll_number",
  "gender",
  "father_name",
  "enrollment_status",
];

function text(
  key: string,
  header: string,
  get: (row: Row) => unknown
): ExportColumn<Row> {
  return {
    key,
    header,
    format: "text",
    text: (row) => {
      const value = get(row);
      return value === null || value === undefined ? "" : String(value);
    },
  };
}

export function studentExportColumnMap({
  subjectNames,
  streamNameById,
  busNameById,
  stopNameById,
}: StudentExportLookups): {
  available: Record<string, ExportColumn<Row>>;
  defaults: string[];
} {
  const available: Record<string, ExportColumn<Row>> = {};

  // `class`, `section` and `subjects` are template keys whose values live on
  // the enrollment or a join, so they are declared below instead.
  const DERIVED_TEMPLATE_KEYS = new Set(["class", "section", "subjects", "stream"]);

  for (const field of STUDENT_TEMPLATE_FIELDS) {
    if (DERIVED_TEMPLATE_KEYS.has(field.key)) continue;
    available[field.key] = {
      key: field.key,
      header: field.label,
      format:
        field.kind === "date"
          ? "date"
          : field.kind === "number" || field.kind === "integer"
            ? "number"
            : "text",
      text: (row) =>
        field.key === "indian_national"
          ? formatFieldValue(
              field,
              indianNationalFromNationality(
                (row.nationality as string | null) ?? null
              )
            )
          : formatFieldValue(field, row[field.key]),
      raw: (row) => row[field.key] as string | number | null | undefined,
    };
  }

  Object.assign(available, {
    class: text("class", "Class", (row) => row.class_name),
    section: text("section", "Section", (row) => row.class_section),
    class_label: text("class_label", "Class & Section", (row) =>
      row.class_name
        ? `${row.class_name}${row.class_section ? `-${row.class_section}` : ""}`
        : ""
    ),
    stream: text("stream", "Stream", (row) =>
      row.stream_id ? (streamNameById.get(row.stream_id) ?? "") : ""
    ),
    roll_number: {
      key: "roll_number",
      header: "Roll No",
      format: "number",
      text: (row) => (row.roll_number === null ? "" : String(row.roll_number)),
      raw: (row) => row.roll_number,
    },
    enrollment_status: text("enrollment_status", "Status", (row) =>
      row.enrollment_status
        ? row.enrollment_status.charAt(0).toUpperCase() +
          row.enrollment_status.slice(1)
        : ""
    ),
    status_reason: text("status_reason", "Status Reason", (row) => row.status_reason),
    status_changed_at: {
      key: "status_changed_at",
      header: "Status Changed",
      format: "date",
      text: (row) => String(row.status_changed_at ?? ""),
      raw: (row) => (row.status_changed_at as string | null) ?? null,
    },
    // Joined, not stored: `student_subjects` has no year of its own, so this
    // is only correct because the fetch guards on the enrolled class.
    subjects: text("subjects", "Subjects", (row) =>
      (subjectNames.get(row.id) ?? []).join(", ")
    ),
    has_transport: text("has_transport", "Transport", (row) =>
      row.has_transport ? "Yes" : "No"
    ),
    bus_number: text("bus_number", "Bus", (row) =>
      row.bus_id ? (busNameById.get(row.bus_id) ?? "") : ""
    ),
    bus_stop: text("bus_stop", "Bus Stop", (row) =>
      row.bus_stop_id ? (stopNameById.get(row.bus_stop_id) ?? "") : ""
    ),
    transport_direction: text(
      "transport_direction",
      "Transport Direction",
      (row) => row.transport_direction
    ),
    pickup_address: text("pickup_address", "Pickup Address", (row) =>
      row.pickup_address
    ),
  } satisfies Record<string, ExportColumn<Row>>);

  return {
    available,
    defaults: DEFAULT_FIELDS.filter((key) => key in available),
  };
}
