export interface GalleryImage {
  id: string;
  src: string;
  alt: string;
  category: "academics" | "sports" | "cultural" | "campus" | "events";
  gallery_event_id: string | null;
  sort_order: number;
  created_at: string;
}

export interface GalleryEvent {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  academic_year: string | null;
  cover_image_url: string | null;
  is_public: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TransferCertificate {
  id: string;
  student_name: string;
  admission_no: string | null;
  student_dob: string | null;
  file_url: string;
  academic_year: string;
  upload_date: string;
  created_at: string;
  student_id: string | null;
  tc_number: string | null;
  issue_date: string | null;
  last_attended_date: string | null;
  reason_for_leaving: string | null;
  conduct: string | null;
  class_last_attended: string | null;
  remarks: string | null;
  is_generated: boolean;
}

export interface SiteMedia {
  id: string;
  slot: string;
  page: string;
  section: string;
  label: string;
  current_url: string;
  default_url: string;
  alt_text: string;
  sort_order: number;
  updated_at: string;
  created_at: string;
}

export type StaffCategory = 'management' | 'admin' | 'pgt' | 'tgt' | 'prt' | 'motherTeachers' | 'prePrimaryCoordinator' | 'primaryCoordinator' | 'middleCoordinator' | 'seniorCoordinator' | 'additionalStaff' | 'busDriver' | 'peon';

export interface StaffMember {
  id: string;
  name: string;
  subject: string;
  category: StaffCategory;
  photo_url: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  address: string | null;
  qualifications: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type SectionCardType = 'hero_slider' | 'testimonials' | 'latest_updates' | 'facilities_preview' | 'leadership' | 'legacy_timeline' | 'why_choose_us' | 'activities' | 'annual_events' | 'campus_facilities';

export interface SectionCard {
  id: string;
  section: SectionCardType;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  quote: string | null;
  name: string | null;
  role: string | null;
  initials: string | null;
  date: string | null;
  cta_text: string | null;
  cta_link: string | null;
  icon: string | null;
  link: string | null;
  image_url: string | null;
  designation: string | null;
  message: string | null;
  year: string | null;
  season: string | null;
  sort_order: number;
  is_active: boolean;
  is_default: boolean;
  default_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ContactSubmission {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface Article {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  cover_image_url: string | null;
  author_name: string | null;
  meta_description: string | null;
  tags: string[];
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================
// ERP System Types
// =============================================================

export type UserRole = 'admin' | 'staff' | 'teacher' | 'student' | 'parent';

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
  must_change_password: boolean;
  teacher_id: string | null;
  student_id: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================
// Teachers (dedicated entity table)
// =============================================================

export interface Teacher {
  id: string;
  employee_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  date_of_joining: string | null;
  date_of_birth: string | null;
  gender: Gender | null;
  qualifications: string | null;
  specialization: string | null;
  address: string | null;
  aadhar_number: string | null;
  photo_url: string | null;
  is_active: boolean;
  staff_member_id: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================
// Students (standalone entity, no auth required)
// =============================================================

export type Gender = 'male' | 'female' | 'other';
export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';

export interface Student {
  id: string;
  admission_no: string;
  full_name: string;
  father_name: string | null;
  mother_name: string | null;
  date_of_birth: string | null;
  gender: Gender | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  blood_group: BloodGroup | null;
  category: string | null;
  aadhar_number: string | null;
  religion: string | null;
  nationality: string | null;
  photo_url: string | null;
  previous_school: string | null;
  admission_date: string;
  admission_class: string | null;
  is_active: boolean;
  is_alumni: boolean;
  alumni_passing_year: string | null;
  alumni_academic_year_id: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================
// Parents (dedicated entity table)
// =============================================================

export type ParentRelationship = 'father' | 'mother' | 'guardian';

export interface Parent {
  id: string;
  full_name: string;
  email: string | null;
  phone: string;
  alternate_phone: string | null;
  occupation: string | null;
  address: string | null;
  relationship: ParentRelationship;
  aadhar_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StudentParent {
  id: string;
  student_id: string;
  parent_id: string;
  relationship: ParentRelationship;
  is_primary_contact: boolean;
  created_at: string;
}

// =============================================================
// Academic Structure
// =============================================================

export interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  created_at: string;
}

export interface Stream {
  id: string;
  name: string;
  code: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface Class {
  id: string;
  name: string;
  section: string;
  academic_year_id: string;
  class_teacher_id: string | null;
  stream_id: string | null;
  sort_order: number;
  room: string | null;
  created_at: string;
}

export type SubjectCategory = 'languages' | 'academic' | 'co_curricular';

export const SUBJECT_CATEGORY_LABELS: Record<SubjectCategory, string> = {
  languages: 'Languages',
  academic: 'Academic Subjects',
  co_curricular: 'Co-curricular Subjects',
};

export interface Subject {
  id: string;
  name: string;
  /** CBSE numeric code (e.g. "301" for English Core). Mandatory for classes 9–12. */
  code: string | null;
  /** Short label for compact UI (e.g. timetable). */
  nickname: string | null;
  category: SubjectCategory | null;
  is_active: boolean;
  is_elective: boolean;
  created_at: string;
}

export type StreamSubjectRequirement = 'compulsory' | 'elective';

export interface StreamSubject {
  id: string;
  stream_id: string;
  subject_id: string;
  /** Legacy mirror of requirement_type === 'compulsory'. */
  is_mandatory: boolean;
  requirement_type: StreamSubjectRequirement | null;
  sort_order: number;
}

export interface ClassSubject {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string | null;
}

// =============================================================
// Enrollments
// =============================================================

export type EnrollmentStatus = 'active' | 'passed' | 'failed' | 'terminated' | 'exited';

export interface StudentEnrollment {
  id: string;
  student_id: string;
  class_id: string;
  academic_year_id: string;
  stream_id: string | null;
  roll_number: number | null;
  roll_number_manual: boolean;
  enrollment_date: string;
  status: EnrollmentStatus;
  has_transport: boolean;
  transport_slab_id: string | null;
  updated_at: string;
}

// =============================================================
// Attendance
// =============================================================

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'half_day';

export interface Attendance {
  id: string;
  student_id: string;
  class_id: string;
  date: string;
  status: AttendanceStatus;
  marked_by: string;
  remarks: string | null;
  created_at: string;
}

// =============================================================
// Exams & Results
// =============================================================

export type ExamKind = "term_exam" | "class_test" | "practical";
export type ExamClassLevel =
  | "all"
  | "nursery_ukg"
  | "i_v"
  | "vi_viii"
  | "ix_x"
  | "xi_xii";

export interface ExamType {
  id: string;
  name: string;
  academic_year_id: string;
  max_marks: number;
  weightage: number | null;
  sort_order: number;
  kind: ExamKind;
  upper_header: string | null;
  class_level: ExamClassLevel;
}

export interface Result {
  id: string;
  student_id: string;
  class_id: string;
  subject_id: string;
  exam_type_id: string;
  marks_obtained: number;
  max_marks: number;
  grade: string | null;
  remarks: string | null;
  entered_by: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

// =============================================================
// Result Master (Phase 3 — admin-configurable per-class/year rules)
// =============================================================

export type ResultMasterPassMarkMode = 'percentage' | 'raw_marks';
export type ResultMasterPassCriteriaType =
  | 'all_main_subjects'
  | 'overall_percentage'
  | 'main_and_overall'
  | 'pass_n_subjects'
  | 'allow_one_fail';
export type ResultMasterRoundingMode = 'none' | 'half_up' | 'half_down' | 'ceil' | 'floor';
export type ResultMasterGraceCondition = 'failing_only' | 'any_subject';
export type ResultMasterNonScholasticPlacement = 'below' | 'above' | 'separate_page';
export type ResultMasterSubjectRole = 'main' | 'optional';
export type ResultMasterDivisionScheme = 'cbse';
export type FinalResultDivision = 'first' | 'second' | 'third' | null;

export interface ResultMaster {
  id: string;
  class_id: string;
  academic_year_id: string;
  pass_mark_mode: ResultMasterPassMarkMode;
  pass_mark_value: number;
  // `string` fallback keeps the door open for new criteria types registered
  // purely in the resolver without a DB migration.
  pass_criteria_type: ResultMasterPassCriteriaType | string;
  pass_criteria_config: Record<string, unknown>;
  show_rank: boolean;
  show_extra_separately: boolean;
  include_non_scholastic: boolean;
  non_scholastic_placement: ResultMasterNonScholasticPlacement;
  grade_scale_id: string | null;
  grace_marks_per_subject_max: number;
  grace_marks_total_max: number;
  grace_marks_condition: ResultMasterGraceCondition;
  rounding_mode: ResultMasterRoundingMode;
  rounding_precision: number;
  round_raw_marks: boolean;
  class_test_best_of: number | null;
  practical_best_of: number | null;
  // Phase 8 — supplementary settings (nullable thresholds default to "off")
  min_for_supplementary: number | null;
  max_supplementary_subjects: number;
  supplementary_pass_action: "cap_at_pass_mark" | "use_retest_marks";
  // Phase 9 — division labels on the year-end report card (CBSE-style)
  show_division: boolean;
  division_scheme: ResultMasterDivisionScheme;
  created_at: string;
  updated_at: string;
}

export interface ResultMasterSubject {
  id: string;
  result_master_id: string;
  subject_id: string;
  role: ResultMasterSubjectRole;
  pass_mark_value_override: number | null;
  sort_order: number;
  created_at: string;
}

export interface FinalSubjectExamContribution {
  exam_type_id: string;
  exam_name: string;
  marks_obtained: number;      // post raw-round if round_raw_marks=true
  marks_obtained_pre_round: number; // audit field — always the DB value
  max_marks: number;
  pct: number;
  weight: number;
}

export interface FinalSubject {
  subject_id: string;
  subject_name: string;
  role: ResultMasterSubjectRole;
  exam_contributions: FinalSubjectExamContribution[];
  raw_pct: number;         // pre-grace, pre-rounding (weighted average of exam pcts)
  grace_applied: number;   // percentage points added by the grace pass
  final_pct: number;       // rounded, post-grace
  effective_pass_mark_pct: number;
  grade: string | null;
  passed: boolean;
}

export interface FinalResultOverall {
  main_total_pct: number;      // rounded
  main_total_pct_raw: number;  // pre-rounding, for debugging
  grade: string | null;
  passed: boolean;
  pass_reason: string;
  grace_applied_total: number;
  // CBSE division derived from main_total_pct: First (≥60), Second (≥45),
  // Third (≥33), null when failing or when show_division is false.
  division: FinalResultDivision;
}

export interface FinalResultConfigApplied {
  result_master_id: string;
  grade_scale_name: string | null;
  best_of_applied: boolean;
  rounding_summary: string;
}

export interface FinalResult {
  student_id: string;
  class_id: string;
  academic_year_id: string;
  main_subjects: FinalSubject[];
  optional_subjects: FinalSubject[];
  overall: FinalResultOverall;
  rank?: number | null;
  config_applied: FinalResultConfigApplied;
}

// =============================================================
// Fees & Payments
// =============================================================

export type FeeFrequency = 'monthly' | 'quarterly' | 'annual' | 'one_time';
export type FeeClassLevel = 'all' | 'nursery_ukg' | 'i_v' | 'vi_viii' | 'ix_x' | 'xi_xii';

export interface FeeStructure {
  id: string;
  academic_year_id: string;
  class_name: string;
  class_level: FeeClassLevel;
  stream_id: string | null;
  fee_type: string;
  amount: number;
  due_date: string | null;
  frequency: FeeFrequency;
  is_active: boolean;
  description: string | null;
  late_fee_percent: number;
  late_fee_fixed_amount: number;
  created_at: string;
  updated_at: string;
}

export interface TransportFareSlab {
  id: string;
  academic_year_id: string;
  name: string;
  distance_km_min: number | null;
  distance_km_max: number | null;
  amount: number;
  frequency: FeeFrequency;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Synthetic fee line for the student's transport slab. Shaped like
// FeeStructure so existing UI/dues code can iterate over a unified array of
// `EffectiveFeeLine` entries. `kind` distinguishes the two so consumers that
// need to record payments know which FK to send.
export interface TransportFeeLine {
  kind: 'transport_slab';
  id: string;                 // slab id (used as React key + payment FK)
  fee_type: 'Transport';
  amount: number;
  frequency: FeeFrequency;
  due_date: null;
  late_fee_percent: 0;
  late_fee_fixed_amount: 0;
  stream_id: null;
  slab_name: string;          // for UI label, e.g. "0–5 km"
}

export type EffectiveFeeLine =
  | (FeeStructure & { kind: 'fee_structure' })
  | TransportFeeLine;

export type PaymentMethod = 'cash' | 'online' | 'cheque' | 'bank_transfer' | 'upi' | 'gateway' | 'waiver';
export type PaymentStatus = 'pending' | 'processing' | 'paid' | 'partial' | 'failed' | 'refunded';

export interface FeePayment {
  id: string;
  student_id: string;
  fee_structure_id: string | null;
  transport_slab_id: string | null;
  amount_paid: number;
  payment_date: string;
  payment_method: PaymentMethod;
  receipt_number: string | null;
  month: string | null;
  academic_year_id: string | null;
  status: PaymentStatus;
  payment_order_id: string | null;
  gateway_payment_id: string | null;
  gateway_receipt: string | null;
  recorded_by: string | null;
  remarks: string | null;
  // M9 — waiver / refund metadata
  waiver_amount: number;
  waiver_reason: string | null;
  refund_amount: number | null;
  refund_reason: string | null;
  refunded_at: string | null;
  refunded_by: string | null;
  // Migration 044 — per-method reconciliation fields. Only some are
  // populated on any given row, based on payment_method.
  cheque_number: string | null;
  cheque_date: string | null;
  bank_name: string | null;
  payer_name: string | null;
  transaction_ref: string | null;
  payment_provider: string | null;
  created_at: string;
  updated_at: string;
}

export type PaymentGateway = 'razorpay' | 'stripe' | 'manual';
export type PaymentOrderStatus = 'created' | 'attempted' | 'paid' | 'failed' | 'refunded' | 'expired';

export interface PaymentOrder {
  id: string;
  student_id: string;
  parent_id: string | null;
  fee_structure_id: string;
  amount: number;
  currency: string;
  gateway: PaymentGateway;
  gateway_order_id: string | null;
  gateway_payment_id: string | null;
  gateway_signature: string | null;
  status: PaymentOrderStatus;
  month: string | null;
  notes: Record<string, unknown>;
  callback_url: string | null;
  webhook_verified: boolean;
  ip_address: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

// =============================================================
// Timetable
// =============================================================

export interface TimetablePeriod {
  id: string;
  class_id: string;
  subject_id: string | null;
  teacher_id: string | null;
  day_of_week: number;
  period_number: number;
  start_time: string;
  end_time: string;
  room: string | null;
  is_break: boolean;
}

// ── Timetable templates (§2/§3) ──
export type TimetableTemplatePeriodKind = 'teaching' | 'lunch' | 'break';

export interface TimetableTemplate {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  teaching_period_count: number;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface TimetableTemplatePeriod {
  id: string;
  template_id: string;
  position: number;
  kind: TimetableTemplatePeriodKind;
  label: string | null;
  start_time: string;
  end_time: string;
}

// ── §5 Per-student elective picks ──
// Dedicated table; the legacy student_subjects join was removed by the ERP
// redesign because subjects are inferred from class enrollment + class_subjects.
export interface StudentElectivePick {
  id: string;
  student_id: string;
  /** 5 = "Elective 5", 6 = "Elective 6" (extensible 1..9). */
  slot: number;
  subject_id: string;
  created_at: string;
  updated_at: string;
}

export interface ElectiveSlotOption {
  id: string;
  slot: number;
  subject_id: string;
  label: string | null;
  applies_to_classes: string[];
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

// =============================================================
// Calendar
// =============================================================

export type CalendarEventType = 'exam' | 'holiday' | 'event' | 'pta_meeting' | 'sports' | 'cultural' | 'other';

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  event_type: CalendarEventType;
  start_date: string;
  end_date: string | null;
  is_school_wide: boolean;
  class_id: string | null;
  academic_year_id: string | null;
  created_by: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

// =============================================================
// Registration Requests
// =============================================================

export type RegistrationStatus = 'pending' | 'approved' | 'rejected';

export interface RegistrationRequest {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: 'teacher' | 'student' | 'parent';
  student_admission_no: string | null;
  relationship: ParentRelationship | null;
  status: RegistrationStatus;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

// =============================================================
// Notifications
// =============================================================

export type NotificationType = 'info' | 'warning' | 'success' | 'fee_reminder' | 'result_published' | 'attendance_alert' | 'announcement';

export interface Notification {
  id: string;
  recipient_id: string;
  title: string;
  message: string;
  type: NotificationType;
  related_entity_type: string | null;
  related_entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

// =============================================================
// Mandatory Public Disclosure
// =============================================================

export type DisclosureSection = 'general' | 'result_academics' | 'staff' | 'infrastructure';

export interface DisclosureItem {
  id: string;
  section: DisclosureSection;
  field_key: string;
  label: string;
  value: string;
  sort_order: number;
  updated_at: string;
}

export interface DisclosureDocument {
  id: string;
  doc_key: string;
  label: string;
  file_url: string | null;
  file_name: string | null;
  sort_order: number;
  updated_at: string;
}

export type ExamClass = 'X' | 'XII';

export interface DisclosureBoardResult {
  id: string;
  exam_class: ExamClass;
  academic_year: string;
  registered: number;
  passed: number;
  pass_percentage: number;
  remarks: string | null;
  sort_order: number;
  updated_at: string;
}

export interface StudentWithClass extends Student {
  class_name?: string;
  section?: string;
  roll_number?: number | null;
  enrollment_id?: string;
  class_id?: string;
}

export interface TeacherWithProfile extends Teacher {
  profile_id?: string;
  avatar_url?: string | null;
}

export interface ClassWithTeacher extends Class {
  class_teacher?: Teacher | null;
  student_count?: number;
}

export interface ClassSubjectWithDetails extends ClassSubject {
  subject?: Subject;
  teacher?: Teacher | null;
}

// =============================================================
// Phase 4+ tables — grade master, PDF templates, exam schedules,
// admit-card templates, result master subjects/non-scholastic,
// class tests, marksheet snapshots
// =============================================================

export type GradeScaleScope = 'scholastic' | 'non_scholastic';

export interface GradeScale {
  id: string;
  name: string;
  scope: GradeScaleScope;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface GradeBand {
  id: string;
  grade_scale_id: string;
  label: string;
  min_pct: number;
  max_pct: number;
  remark: string | null;
  sort_order: number;
  created_at: string;
}

export interface ClassGradeScale {
  class_id: string;
  grade_scale_id: string;
  updated_at: string;
}

export interface ClassExamConfig {
  id: string;
  class_id: string;
  exam_type_id: string;
  is_applicable: boolean;
  weightage: number | null;
  max_marks_override: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PdfHeaderConfig {
  id: string;
  template_key: string;
  school_name: string;
  address_line: string;
  affiliation: string | null;
  affiliation_number: string | null;
  logo_url: string | null;
  motto: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PdfFooterConfig {
  id: string;
  template_key: string;
  disclaimer_text: string | null;
  show_signatures: boolean;
  signature_labels: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExamSchedule {
  id: string;
  exam_type_id: string;
  class_id: string;
  subject_id: string;
  exam_date: string;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  invigilator_teacher_id: string | null;
  sort_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type AdmitCardOrientation = 'portrait' | 'landscape';

export interface AdmitCardTemplate {
  id: string;
  name: string;
  is_default: boolean;
  orientation: AdmitCardOrientation;
  background_image_url: string | null;
  show_photo: boolean;
  show_admission_no: boolean;
  show_roll_no: boolean;
  show_class_section: boolean;
  show_father_name: boolean;
  show_mother_name: boolean;
  show_dob: boolean;
  show_phone: boolean;
  show_address: boolean;
  show_schedule: boolean;
  show_instructions: boolean;
  instructions_text: string | null;
  signature_labels: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NonScholasticSubject {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NonScholasticSubSubject {
  id: string;
  parent_subject_id: string;
  name: string;
  grade_scale_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NonScholasticAssessment {
  id: string;
  student_id: string;
  class_id: string;
  exam_type_id: string;
  sub_subject_id: string;
  grade_label: string;
  remarks: string | null;
  entered_by: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClassTest {
  id: string;
  class_id: string;
  subject_id: string;
  name: string;
  test_date: string | null;
  max_marks: number;
  weightage: number | null;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassTestResult {
  id: string;
  class_test_id: string;
  student_id: string;
  marks_obtained: number;
  max_marks: number;
  grade: string | null;
  remarks: string | null;
  entered_by: string | null;
  created_at: string;
  updated_at: string;
}

export type MarksheetPublicationKind = 'per_exam' | 'year_final';

export interface MarksheetPublication {
  id: string;
  student_id: string;
  class_id: string;
  exam_type_id: string | null;
  academic_year_id: string | null;
  kind: MarksheetPublicationKind;
  version: number;
  snapshot: Record<string, unknown>;
  schema_version: string;
  published_at: string;
  published_by: string | null;
  unpublished_at: string | null;
  unpublish_reason: string | null;
  unpublished_by: string | null;
  created_at: string;
}

export type PublishEventType =
  | 'publish_results'
  | 'unpublish_results'
  | 'finalize_marksheet'
  | 'unpublish_marksheet'
  | 're_finalize_marksheet'
  | 'finalize_year_final'
  | 'unpublish_year_final'
  | 're_finalize_year_final';

export interface PublishEvent {
  id: string;
  event_type: PublishEventType;
  class_id: string | null;
  exam_type_id: string | null;
  student_id: string | null;
  actor_id: string | null;
  acted_at: string;
  note: string | null;
}

export type SupplementaryPassAction = 'cap_at_pass_mark' | 'use_retest_marks';

export interface SupplementaryAttempt {
  id: string;
  student_id: string;
  parent_exam_type_id: string;
  subject_id: string;
  class_id: string;
  retest_date: string | null;
  marks_obtained: number;
  max_marks: number;
  passed: boolean;
  entered_by: string | null;
  created_at: string;
  updated_at: string;
}

export type PtmAttendance = 'present' | 'absent';

export interface PtmNote {
  id: string;
  student_id: string;
  exam_type_id: string | null;
  meeting_date: string;
  attendance: PtmAttendance;
  teacher_remarks: string | null;
  parent_remarks: string | null;
  action_points: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PtmFormat {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  intro_text: string | null;
  closing_text: string | null;
  show_student_details: boolean;
  show_photo: boolean;
  show_father_name: boolean;
  show_mother_name: boolean;
  show_performance_snapshot: boolean;
  show_teacher_remarks_section: boolean;
  teacher_remarks_lines: number;
  show_parent_signature: boolean;
  signature_labels: string[];
  created_at: string;
  updated_at: string;
}

export interface SchoolMeetingCount {
  id: string;
  academic_year_id: string;
  exam_type_id: string | null;
  class_id: string | null;
  total_meetings: number;
  updated_at: string;
}
