import { createAdminProxyHandler } from "@nkps/shared/lib/admin-proxy";
import type { FeatureKey } from "@nkps/shared/lib/permissions";

// ERP-side admin DB proxy. Tables here are the ones ERP pages write through
// adminApi(). CMS-only tables (gallery_events, disclosure_*, section_cards)
// have their own /api/admin route on apps/cms.
const TABLE_FEATURE_KEY: Record<string, FeatureKey> = {
  students: "students",
  student_enrollments: "students",
  classes: "classes",
  class_subjects: "classes",
  streams: "classes",
  stream_subjects: "classes",
  subjects: "subjects",
  student_elective_picks: "students",
  elective_slot_options: "subjects",
  academic_years: "academic_years",
  fee_structures: "fees",
  fee_payments: "fees",
  bus_stops: "transport",
  bus_stop_fees: "transport",
  buses: "transport",
  bus_route_stops: "transport",
  transport_change_requests: "transport",
  exam_types: "exam_types",
  calendar_events: "calendar",
  timetable_periods: "timetable",
  timetable_templates: "timetable",
  timetable_template_periods: "timetable",
  attendance: "attendance",
  results: "results",
};

const ALLOWED_COLUMNS: Record<string, string[]> = {
  students: ["id", "admission_no", "full_name", "father_name", "mother_name", "date_of_birth", "gender", "address", "phone", "email", "blood_group", "category", "aadhar_number", "previous_school", "is_active", "created_at", "updated_at"],
  classes: ["id", "name", "section", "academic_year_id", "class_teacher_id", "stream_id", "sort_order", "created_at"],
  subjects: ["id", "name", "code", "nickname", "category", "is_active", "is_elective", "created_at"],
  academic_years: ["id", "name", "start_date", "end_date", "is_current", "created_at"],
  class_subjects: ["id", "class_id", "subject_id", "teacher_id", "created_at"],
  student_enrollments: ["id", "student_id", "class_id", "stream_id", "roll_number", "roll_number_manual", "enrollment_date", "status", "has_transport", "pickup_address", "bus_stop_id", "bus_id", "transport_direction", "transport_fee_override", "updated_at"],
  fee_structures: ["id", "academic_year_id", "class_name", "class_level", "stream_id", "fee_type", "amount", "due_date", "frequency", "is_active", "description", "late_fee_percent", "late_fee_fixed_amount", "late_fee_per_day", "late_fee_max", "created_at", "updated_at"],
  fee_payments: ["id", "student_id", "fee_structure_id", "amount_paid", "payment_date", "payment_method", "receipt_number", "month", "status", "recorded_by", "remarks", "cheque_number", "cheque_date", "bank_name", "payer_name", "transaction_ref", "payment_provider", "created_at"],
  exam_types: ["id", "name", "academic_year_id", "max_marks", "weightage", "sort_order", "kind", "upper_header", "class_level", "created_at"],
  calendar_events: ["id", "title", "description", "event_type", "start_date", "end_date", "class_id", "is_public", "is_school_wide", "created_by", "created_at"],
  timetable_periods: ["id", "class_id", "subject_id", "teacher_id", "day_of_week", "period_number", "start_time", "end_time", "room", "created_at"],
  attendance: ["id", "student_id", "class_id", "date", "status", "marked_by", "remarks", "created_at"],
  results: ["id", "student_id", "class_id", "subject_id", "exam_type_id", "marks_obtained", "max_marks", "grade", "remarks", "entered_by", "created_at"],
  streams: ["id", "name", "code", "is_active", "sort_order", "created_at"],
  stream_subjects: ["id", "stream_id", "subject_id", "is_mandatory", "requirement_type", "sort_order"],
  student_elective_picks: ["id", "student_id", "slot", "subject_id", "created_at", "updated_at"],
  elective_slot_options: ["id", "slot", "subject_id", "label", "applies_to_classes", "sort_order", "is_active", "created_at"],
  timetable_templates: ["id", "name", "code", "description", "teaching_period_count", "is_active", "is_system", "created_at", "updated_at"],
  timetable_template_periods: ["id", "template_id", "position", "kind", "label", "start_time", "end_time"],
  bus_stops: ["id", "name", "area", "lat", "lng", "is_active", "sort_order", "created_at", "updated_at"],
  bus_stop_fees: ["id", "bus_stop_id", "academic_year_id", "amount", "frequency", "is_active", "created_at", "updated_at"],
  buses: ["id", "bus_number", "registration_number", "capacity", "driver_id", "conductor_id", "is_active", "notes", "created_at", "updated_at"],
  bus_route_stops: ["id", "bus_id", "bus_stop_id", "sort_order", "created_at"],
  transport_change_requests: ["id", "enrollment_id", "change_type", "previous_bus_id", "amended_bus_id", "previous_stop_id", "amended_stop_id", "direction", "effective_from", "effective_to", "reason_code", "reason_note", "application_url", "source", "status", "requested_by", "reviewed_by", "reviewed_at", "review_note", "created_at", "updated_at"],
};

// Editor-restricted actions. Editors with the matching feature key can
// still INSERT (create new rows) but cannot UPDATE or DELETE these tables
// directly — they must file a fee_change_request that an admin approves.
// Admins are unaffected. This is the lock-in that prevents a fees-editor
// from silently fixing a wrong-amount payment they recorded themselves.
const EDITOR_RESTRICTED_ACTIONS = {
  fee_payments: ["update", "delete"],
} as const;

export const POST = createAdminProxyHandler({
  tableFeatureKey: TABLE_FEATURE_KEY,
  allowedColumns: ALLOWED_COLUMNS,
  editorRestrictedActions: EDITOR_RESTRICTED_ACTIONS,
});
