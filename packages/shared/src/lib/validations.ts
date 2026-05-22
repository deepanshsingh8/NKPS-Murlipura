import { z } from "zod";

// Indian mobile: 10 digits starting with 6-9. We accept either the bare 10
// digits or a `+91` / `0` / `91` prefix (then strip it for storage).
//
// Why we don't go fully E.164: the school's user base is 99% domestic, the
// rest of the app assumes 10-digit numbers, and a stricter regex would mass-
// reject existing rows. If international parents become a real cohort, swap
// in `libphonenumber-js`.
const indianMobileRegex = /^[6-9]\d{9}$/;
function normalizeIndianMobile(raw: string): string | null {
  const stripped = raw.replace(/[\s\-()]/g, "");
  // Accept and strip common prefixes.
  let candidate = stripped;
  if (candidate.startsWith("+91")) candidate = candidate.slice(3);
  else if (candidate.startsWith("91") && candidate.length === 12) candidate = candidate.slice(2);
  else if (candidate.startsWith("0") && candidate.length === 11) candidate = candidate.slice(1);
  return indianMobileRegex.test(candidate) ? candidate : null;
}

const phoneRequiredSchema = z
  .string()
  .min(1, "Phone number is required")
  .refine((v) => normalizeIndianMobile(v) !== null, {
    message: "Enter a valid 10-digit Indian mobile number",
  });

const phoneOptionalSchema = z
  .string()
  .refine((v) => v === "" || normalizeIndianMobile(v) !== null, {
    message: "Enter a valid 10-digit Indian mobile number",
  })
  .optional()
  .or(z.literal(""));

// Sanity-bounded ISO date for date-of-birth fields. Accepts YYYY-MM-DD only;
// rejects entries before 1900 or in the future. Returns the canonical YYYY-MM-DD
// string when it parses; existing rows with looser values continue to read
// from the DB unchanged because validation only runs on writes.
const dobBaseSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((v) => {
    const t = Date.parse(`${v}T00:00:00Z`);
    if (Number.isNaN(t)) return false;
    const year = Number(v.slice(0, 4));
    if (year < 1900) return false;
    return t <= Date.now();
  }, { message: "Date out of range" });

export const dobOptionalSchema = z
  .string()
  .optional()
  .refine((v) => v === undefined || v === "" || dobBaseSchema.safeParse(v).success, {
    message: "Date of birth must be a valid past date in YYYY-MM-DD form",
  });

// Admission numbers are printed on certificates and used in URLs/CSVs, so the
// allowed character set is intentionally tight: alphanumerics, hyphen, slash,
// underscore, with a 32-char ceiling. Whitespace and CR/LF are rejected so a
// pasted multi-line value can't sneak through and break PDF rendering.
const admissionNoRegex = /^[A-Za-z0-9][A-Za-z0-9\-_/]{0,31}$/;
const admissionNoSchema = z
  .string()
  .min(1, "Admission number is required")
  .regex(
    admissionNoRegex,
    "Admission number can only contain letters, digits, '-', '_' and '/' (max 32 chars)"
  );

export const contactFormSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  phone: phoneRequiredSchema,
  subject: z.string().min(1, "Please select a subject"),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

export type ContactFormData = z.infer<typeof contactFormSchema>;

export const galleryUploadSchema = z.object({
  alt: z.string().min(2, "Alt text is required"),
  category: z.enum([
    "academics",
    "sports",
    "cultural",
    "campus",
    "events",
  ]),
});

export type GalleryUploadData = z.infer<typeof galleryUploadSchema>;

export const tcUploadSchema = z.object({
  studentName: z.string().min(2, "Student name is required"),
  academicYear: z.string().min(4, "Academic year is required"),
});

export type TCUploadData = z.infer<typeof tcUploadSchema>;

// =============================================================
// ERP Validation Schemas
// =============================================================

export const createUserSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  phone: phoneOptionalSchema,
  role: z.enum(["admin", "staff", "teacher", "student", "parent"], {
    message: "Please select a role",
  }),
});

export type CreateUserData = z.infer<typeof createUserSchema>;

export const attendanceBulkSchema = z.object({
  class_id: z.string().uuid("Invalid class"),
  date: z.string().min(1, "Date is required"),
  entries: z.array(
    z.object({
      student_id: z.string().uuid("Invalid student"),
      status: z.enum(["present", "absent", "late", "half_day"]),
    })
  ).min(1, "At least one attendance entry is required").max(5000, "Too many entries in one request"),
});

export type AttendanceBulkData = z.infer<typeof attendanceBulkSchema>;

export const resultsBulkSchema = z.object({
  class_id: z.string().uuid("Invalid class"),
  subject_id: z.string().uuid("Invalid subject"),
  exam_type_id: z.string().uuid("Invalid exam type"),
  entries: z.array(
    z.object({
      student_id: z.string().uuid("Invalid student"),
      marks_obtained: z.number().finite("Marks must be a valid number").min(0, "Marks cannot be negative"),
    })
  ).min(1, "At least one result entry is required").max(5000, "Too many entries in one request"),
});

export type ResultsBulkData = z.infer<typeof resultsBulkSchema>;

export const nonScholasticAssessmentsBulkSchema = z.object({
  class_id: z.string().uuid("Invalid class"),
  exam_type_id: z.string().uuid("Invalid exam type"),
  entries: z.array(
    z.object({
      student_id: z.string().uuid("Invalid student"),
      sub_subject_id: z.string().uuid("Invalid sub-subject"),
      grade_label: z.string().min(1).max(50).nullable(),
      remarks: z.string().max(500).nullable().optional(),
    })
  ).min(1, "At least one assessment entry is required").max(5000, "Too many entries in one request"),
});

export type NonScholasticAssessmentsBulkData = z.infer<typeof nonScholasticAssessmentsBulkSchema>;

// =============================================================
// Class Tests (Phase 3)
// =============================================================

export const classTestCreateSchema = z.object({
  class_id: z.string().uuid("Invalid class"),
  subject_id: z.string().uuid("Invalid subject"),
  name: z.string().min(1, "Name is required").max(200),
  test_date: z.string().nullable().optional(),
  max_marks: z.number().finite().positive("Max marks must be positive"),
  weightage: z.number().finite().min(0).max(100).nullable().optional(),
  is_published: z.boolean().optional(),
});

export const classTestUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  test_date: z.string().nullable().optional(),
  max_marks: z.number().finite().positive().optional(),
  weightage: z.number().finite().min(0).max(100).nullable().optional(),
  is_published: z.boolean().optional(),
});

export const classTestMarksBulkSchema = z.object({
  entries: z.array(
    z.object({
      student_id: z.string().uuid("Invalid student"),
      marks_obtained: z.number().finite("Marks must be a valid number").min(0, "Marks cannot be negative").nullable(),
      remarks: z.string().max(500).nullable().optional(),
    })
  ).min(1, "At least one entry is required").max(5000, "Too many entries in one request"),
});

export type ClassTestCreateData = z.infer<typeof classTestCreateSchema>;
export type ClassTestUpdateData = z.infer<typeof classTestUpdateSchema>;
export type ClassTestMarksBulkData = z.infer<typeof classTestMarksBulkSchema>;

// =============================================================
// Publish Workflow (Phase 5)
// =============================================================

export const publishResultsSchema = z.object({
  class_id: z.string().uuid("Invalid class"),
  exam_type_id: z.string().uuid("Invalid exam type"),
  is_published: z.boolean(),
});

export const finalizeMarksheetSchema = z.object({
  class_id: z.string().uuid("Invalid class"),
  exam_type_id: z.string().uuid("Invalid exam type"),
  student_ids: z.array(z.string().uuid()).optional(),
  // Required only when a prior active snapshot exists for at least one of
  // the target students — the route validates that conditionally so first-
  // time finalize calls don't have to supply a meaningless reason.
  unpublish_reason_on_refinalize: z.string().min(1).max(500).optional(),
});

// Year-final variant: same shape but keyed on academic_year_id (no exam).
export const finalizeYearFinalSchema = z.object({
  class_id: z.string().uuid("Invalid class"),
  academic_year_id: z.string().uuid("Invalid academic year"),
  student_ids: z.array(z.string().uuid()).optional(),
  unpublish_reason_on_refinalize: z.string().min(1).max(500).optional(),
});

export const unpublishMarksheetSchema = z.object({
  class_id: z.string().uuid("Invalid class"),
  exam_type_id: z.string().uuid("Invalid exam type"),
  unpublish_reason: z.string().min(1, "Reason is required"),
  student_ids: z.array(z.string().uuid()).optional(),
});

export type PublishResultsData = z.infer<typeof publishResultsSchema>;
export type FinalizeMarksheetData = z.infer<typeof finalizeMarksheetSchema>;
export type UnpublishMarksheetData = z.infer<typeof unpublishMarksheetSchema>;

// =============================================================
// PTM Notes (Phase 6 Chunk B)
// =============================================================

export const ptmNotesBulkSchema = z.object({
  exam_type_id: z.string().uuid("Invalid exam type").nullable().optional(),
  entries: z
    .array(
      z.object({
        student_id: z.string().uuid("Invalid student"),
        meeting_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "meeting_date must be YYYY-MM-DD"),
        attendance: z.enum(["present", "absent"]),
        teacher_remarks: z.string().max(2000).nullable().optional(),
        parent_remarks: z.string().max(2000).nullable().optional(),
        action_points: z.string().max(2000).nullable().optional(),
      })
    )
    .min(1, "At least one entry is required")
    .max(5000, "Too many entries in one request"),
});

export const schoolMeetingCountSchema = z.object({
  academic_year_id: z.string().uuid("Invalid academic year"),
  exam_type_id: z.string().uuid().nullable().optional(),
  class_id: z.string().uuid().nullable().optional(),
  total_meetings: z
    .number()
    .finite("Must be a valid number")
    .int("Must be a whole number")
    .min(0, "Cannot be negative"),
});

export type PtmNotesBulkData = z.infer<typeof ptmNotesBulkSchema>;
export type SchoolMeetingCountData = z.infer<typeof schoolMeetingCountSchema>;

// =============================================================
// Supplementary Exam (Phase 8)
// =============================================================

export const supplementaryAttemptsBulkSchema = z.object({
  class_id: z.string().uuid("Invalid class"),
  parent_exam_type_id: z.string().uuid("Invalid exam type"),
  retest_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "retest_date must be YYYY-MM-DD")
    .nullable()
    .optional(),
  entries: z
    .array(
      z.object({
        student_id: z.string().uuid("Invalid student"),
        subject_id: z.string().uuid("Invalid subject"),
        marks_obtained: z.number().min(0, "Marks cannot be negative"),
        max_marks: z.number().positive("Max marks must be positive"),
        passed: z.boolean(),
      })
    )
    .min(1, "At least one entry is required")
    .max(2000, "Too many entries in one request"),
});

export type SupplementaryAttemptsBulkData = z.infer<
  typeof supplementaryAttemptsBulkSchema
>;

export const ptmFormatSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
  intro_text: z.string().nullable().optional(),
  closing_text: z.string().nullable().optional(),
  show_student_details: z.boolean().optional(),
  show_photo: z.boolean().optional(),
  show_father_name: z.boolean().optional(),
  show_mother_name: z.boolean().optional(),
  show_performance_snapshot: z.boolean().optional(),
  show_teacher_remarks_section: z.boolean().optional(),
  teacher_remarks_lines: z.number().int().min(0).max(20).optional(),
  show_parent_signature: z.boolean().optional(),
  signature_labels: z.array(z.string()).optional(),
});

export type PtmFormatData = z.infer<typeof ptmFormatSchema>;

// Migration 044 — payment-method-specific reconciliation fields.
// All optional at the schema level; the cross-field rule below requires
// the right subset for the chosen method (cheque needs a cheque number;
// bank transfer needs a transaction ref; online/upi needs a provider +
// transaction ref). Cash never requires extras.
const optionalTrimmedString = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v && v.length > 0 ? v : undefined));

export const feePaymentSchema = z
  .object({
    student_id: z.string().uuid("Invalid student"),
    // Exactly one of fee_structure_id / transport_slab_id must be present.
    // Enforced in the superRefine below. Transport payments are routed
    // against a transport_fare_slabs row directly (migration 050).
    fee_structure_id: z.string().uuid("Invalid fee structure").optional(),
    transport_slab_id: z.string().uuid("Invalid transport slab").optional(),
    amount_paid: z
      .number()
      .finite("Amount must be a valid number")
      .min(0, "Amount cannot be negative"),
    payment_method: z.enum(
      [
        "cash",
        "online",
        "cheque",
        "bank_transfer",
        "upi",
        "gateway",
        "historical_unknown",
      ],
      { message: "Please select a payment method" }
    ),
    month: z.string().min(1, "Month is required").optional().or(z.literal("")),
    // M9 — when status='partial' the amount is below structure.amount, when
    // 'paid' it should equal it. The route validates the relationship; the
    // schema just permits both values.
    status: z.enum(["paid", "partial"]).optional(),
    cheque_number: optionalTrimmedString,
    cheque_date: optionalTrimmedString,
    bank_name: optionalTrimmedString,
    payer_name: optionalTrimmedString,
    transaction_ref: optionalTrimmedString,
    payment_provider: optionalTrimmedString,
  })
  .superRefine((val, ctx) => {
    const hasFs = Boolean(val.fee_structure_id);
    const hasSlab = Boolean(val.transport_slab_id);
    if (hasFs === hasSlab) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Either fee_structure_id or transport_slab_id is required (not both)",
        path: ["fee_structure_id"],
      });
    }
    const m = val.payment_method;
    if (m === "cheque") {
      if (!val.cheque_number) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Cheque number is required",
          path: ["cheque_number"],
        });
      }
      if (!val.bank_name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Drawee bank is required",
          path: ["bank_name"],
        });
      }
    }
    if (m === "bank_transfer") {
      if (!val.transaction_ref) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Transaction reference (UTR / NEFT id) is required",
          path: ["transaction_ref"],
        });
      }
      if (!val.bank_name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Originating bank is required",
          path: ["bank_name"],
        });
      }
    }
    if (m === "online" || m === "upi" || m === "gateway") {
      if (!val.payment_provider) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Payment provider is required (e.g. PhonePe, GPay, Paytm)",
          path: ["payment_provider"],
        });
      }
      if (!val.transaction_ref) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Transaction reference is required",
          path: ["transaction_ref"],
        });
      }
    }
  });

export type FeePaymentData = z.infer<typeof feePaymentSchema>;

// Migration 050 — transport fare slabs. Distance bands min/max are optional
// metadata; the slab name is the canonical label shown to the user.
export const transportFareSlabSchema = z
  .object({
    academic_year_id: z.string().uuid("Invalid academic year"),
    name: z.string().trim().min(1, "Slab name is required").max(100),
    distance_km_min: z
      .number()
      .min(0, "Distance must be ≥ 0")
      .max(999, "Distance too large")
      .nullable()
      .optional(),
    distance_km_max: z
      .number()
      .min(0, "Distance must be ≥ 0")
      .max(999, "Distance too large")
      .nullable()
      .optional(),
    amount: z.number().positive("Amount must be > 0"),
    frequency: z.enum(["monthly", "quarterly", "annual", "one_time"]),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
  })
  .superRefine((val, ctx) => {
    const lo = val.distance_km_min ?? null;
    const hi = val.distance_km_max ?? null;
    if (lo !== null && hi !== null && hi < lo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Max km must be ≥ min km",
        path: ["distance_km_max"],
      });
    }
  });

export type TransportFareSlabData = z.infer<typeof transportFareSlabSchema>;

// Refund a previously-recorded payment. The endpoint validates that
// `refund_amount` ≤ original `amount_paid`.
export const feeRefundSchema = z.object({
  refund_amount: z
    .number()
    .finite("Refund must be a valid number")
    .positive("Refund must be positive"),
  refund_reason: z
    .string()
    .min(5, "Reason is required (min 5 chars)")
    .max(500, "Reason too long"),
});

export type FeeRefundData = z.infer<typeof feeRefundSchema>;

// Record a fee waiver — a paper-trail entry that counts toward "no dues"
// without an actual cash receipt.
export const feeWaiverSchema = z.object({
  student_id: z.string().uuid("Invalid student"),
  fee_structure_id: z.string().uuid("Invalid fee structure"),
  waiver_amount: z
    .number()
    .finite("Amount must be a valid number")
    .positive("Amount must be positive"),
  waiver_reason: z
    .string()
    .min(5, "Reason is required (min 5 chars)")
    .max(500, "Reason too long"),
  month: z.string().min(1).optional().or(z.literal("")),
});

export type FeeWaiverData = z.infer<typeof feeWaiverSchema>;

// Editor proposes a change to an already-recorded fee_payments row. The
// proposed_changes shape is validated again server-side against a strict
// column allowlist + business-rule checks — Zod here just enforces a
// non-empty object for updates and an empty one for deletes.
export const feeChangeRequestSchema = z
  .object({
    target_table: z.literal("fee_payments"),
    target_id: z.string().uuid("Invalid target id"),
    action: z.enum(["update", "delete"]),
    proposed_changes: z.record(z.string(), z.unknown()).default({}),
    reason: z
      .string()
      .min(5, "Reason is required (min 5 chars)")
      .max(1000, "Reason too long"),
  })
  .superRefine((val, ctx) => {
    if (val.action === "update") {
      if (!val.proposed_changes || Object.keys(val.proposed_changes).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Update requests must include at least one proposed change",
          path: ["proposed_changes"],
        });
      }
    }
  });

export type FeeChangeRequestData = z.infer<typeof feeChangeRequestSchema>;

export const feeChangeRequestReviewSchema = z.object({
  review_notes: z
    .string()
    .max(1000, "Notes too long")
    .optional()
    .or(z.literal("")),
});

export type FeeChangeRequestReviewData = z.infer<typeof feeChangeRequestReviewSchema>;

export const classSchema = z.object({
  name: z.string().min(1, "Class name is required"),
  section: z.string().min(1, "Section is required"),
  academic_year_id: z.string().uuid("Invalid academic year"),
  class_teacher_id: z.string().uuid("Invalid teacher").optional().or(z.literal("")),
});

export type ClassData = z.infer<typeof classSchema>;

export const subjectSchema = z.object({
  name: z.string().min(1, "Subject name is required"),
  code: z.string().optional().or(z.literal("")),
  is_elective: z.boolean().optional(),
});

export type SubjectData = z.infer<typeof subjectSchema>;

export const streamSchema = z.object({
  name: z.string().min(1, "Stream name is required"),
  code: z.string().optional().or(z.literal("")),
});

export type StreamData = z.infer<typeof streamSchema>;

export const classSubjectAssignSchema = z.object({
  class_id: z.string().uuid("Invalid class"),
  subject_id: z.string().uuid("Invalid subject"),
  teacher_id: z.string().uuid("Invalid teacher").optional().or(z.literal("")),
});

export type ClassSubjectAssignData = z.infer<typeof classSubjectAssignSchema>;

export const feeStructureSchema = z.object({
  academic_year_id: z.string().uuid("Invalid academic year"),
  class_name: z.string().min(1, "Class name is required"),
  class_level: z.enum(["all", "nursery_ukg", "i_v", "vi_viii", "ix_x", "xi_xii"]).optional(),
  fee_type: z.string().min(1, "Fee type is required"),
  amount: z.number().finite("Amount must be a valid number").positive("Amount must be positive"),
  frequency: z.enum(["monthly", "quarterly", "annual", "one_time"], {
    message: "Please select a frequency",
  }),
  description: z.string().optional().or(z.literal("")),
  // M9 — late fee config. Both default to 0 (no late fee).
  late_fee_percent: z.number().finite().min(0).max(100).optional(),
  late_fee_fixed_amount: z.number().finite().min(0).optional(),
});

export type FeeStructureData = z.infer<typeof feeStructureSchema>;

export const timetablePeriodSchema = z.object({
  class_id: z.string().uuid("Invalid class"),
  subject_id: z.string().uuid("Invalid subject"),
  teacher_id: z.string().uuid("Invalid teacher"),
  day_of_week: z.number().int().min(1).max(6, "Day must be between 1 (Monday) and 6 (Saturday)"),
  period_number: z.number().int().positive("Period number must be positive"),
  start_time: z.string().min(1, "Start time is required"),
  end_time: z.string().min(1, "End time is required"),
});

export type TimetablePeriodData = z.infer<typeof timetablePeriodSchema>;

export const calendarEventSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional().or(z.literal("")),
  event_type: z.enum(["exam", "holiday", "event", "pta_meeting", "sports", "cultural", "other"], {
    message: "Please select an event type",
  }),
  start_date: z.string().min(1, "Start date is required"),
  end_date: z.string().optional().or(z.literal("")),
  class_id: z.string().uuid("Invalid class").optional().or(z.literal("")),
});

export type CalendarEventData = z.infer<typeof calendarEventSchema>;

// =============================================================
// Registration Requests
// =============================================================

export const registrationRequestSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  phone: phoneOptionalSchema,
  role: z.enum(["teacher", "student", "parent"], {
    message: "Please select a role",
  }),
  student_admission_no: z.string().optional().or(z.literal("")),
  relationship: z.enum(["father", "mother", "guardian"]).optional(),
});

export type RegistrationRequestData = z.infer<typeof registrationRequestSchema>;

// =============================================================
// Link Child (Parent self-service)
// =============================================================

export const linkChildSchema = z.object({
  admission_no: admissionNoSchema,
  date_of_birth: dobBaseSchema,
  relationship: z.enum(["father", "mother", "guardian"], {
    message: "Please select your relationship",
  }),
});

export type LinkChildData = z.infer<typeof linkChildSchema>;

// =============================================================
// Student Records
// =============================================================

export const studentSchema = z.object({
  admission_no: admissionNoSchema,
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  father_name: z.string().optional().or(z.literal("")),
  mother_name: z.string().optional().or(z.literal("")),
  date_of_birth: dobOptionalSchema,
  gender: z.enum(["male", "female", "other"]).optional(),
  address: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  blood_group: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional(),
  category: z.string().optional().or(z.literal("")),
  aadhar_number: z.string().optional().or(z.literal("")),
  previous_school: z.string().optional().or(z.literal("")),
});

export type StudentData = z.infer<typeof studentSchema>;

export const enrollmentStatusSchema = z.enum(['active', 'passed', 'failed', 'terminated', 'exited']);

export const studentBulkUploadSchema = z.object({
  students: z.array(
    z.object({
      admission_no: admissionNoSchema,
      full_name: z.string().min(2, "Name is required"),
      class_name: z.string().min(1, "Class is required"),
      section: z.string().optional().or(z.literal("")),
      stream: z.string().optional().or(z.literal("")),
      father_name: z.string().optional().or(z.literal("")),
      mother_name: z.string().optional().or(z.literal("")),
      date_of_birth: dobOptionalSchema,
      gender: z.string().optional().or(z.literal("")),
      phone: z.string().optional().or(z.literal("")),
      address: z.string().optional().or(z.literal("")),
      roll_number: z.number().int().optional(),
      email: z.string().optional().or(z.literal("")),
      blood_group: z.string().optional().or(z.literal("")),
      category: z.string().optional().or(z.literal("")),
      aadhar_number: z.string().optional().or(z.literal("")),
      previous_school: z.string().optional().or(z.literal("")),
    })
  ).min(1, "At least one student is required").max(5000, "Too many rows in one upload"),
});

export type StudentBulkUploadData = z.infer<typeof studentBulkUploadSchema>;

// Staff bulk upload
export const staffBulkUploadSchema = z.object({
  category: z.string().optional(),
  staff: z.array(
    z.object({
      name: z.string().min(2, "Name is required"),
      subject: z.string().min(1, "Subject/designation is required"),
      category: z.string().optional(),
      email: z.string().optional().or(z.literal("")),
      phone: z.string().optional().or(z.literal("")),
      date_of_birth: dobOptionalSchema,
      address: z.string().optional().or(z.literal("")),
      qualifications: z.string().optional().or(z.literal("")),
    })
  ).min(1, "At least one staff member is required").max(5000, "Too many rows in one upload"),
});

export type StaffBulkUploadData = z.infer<typeof staffBulkUploadSchema>;

// Categories the directory page exposes via the Add/Edit dialog. Kept in
// lockstep with the constant in /api/staff/route.ts (M1).
export const staffCategoryEnum = z.enum([
  "management",
  "admin",
  "pgt",
  "tgt",
  "prt",
  "motherTeachers",
  "prePrimaryCoordinator",
  "primaryCoordinator",
  "middleCoordinator",
  "seniorCoordinator",
  "additionalStaff",
  "busDriver",
  "peon",
]);

const optionalNullableString = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v && v.length > 0 ? v : ""));

export const staffCreateSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(200),
  subject: z.string().trim().min(1, "Subject/designation is required").max(200),
  category: staffCategoryEnum,
  photo_url: z.string().url().optional().or(z.literal("")),
  sort_order: z.number().int().min(0).max(100000).optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: phoneOptionalSchema.optional().or(z.literal("")),
  date_of_birth: dobOptionalSchema,
  address: optionalNullableString,
  qualifications: optionalNullableString,
});

// PATCH allows any subset of the create fields (plus the row id, handled
// separately on the route). Photo cleanup uses a sibling `old_photo_url`
// hint that the schema allowlists explicitly so the spread can't smuggle
// random columns through.
export const staffUpdateSchema = staffCreateSchema.partial().extend({
  id: z.string().uuid("Invalid staff id"),
  old_photo_url: z.string().url().optional().or(z.literal("")),
});

export type StaffCreateData = z.infer<typeof staffCreateSchema>;
export type StaffUpdateData = z.infer<typeof staffUpdateSchema>;

// Section-cards CRUD (audit L4). The API used to spread arbitrary text into
// the table, letting an editor with `site_media` write multi-MB strings to
// any text column. Cap each free-text column at 2 KB.
const sectionCardText = z
  .string()
  .max(2000, "Field is too long (max 2000 chars)")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v && v.length > 0 ? v : undefined));

export const sectionCardCreateSchema = z.object({
  section: z.string().min(1, "Section is required").max(100),
  title: sectionCardText,
  subtitle: sectionCardText,
  description: sectionCardText,
  quote: sectionCardText,
  name: sectionCardText,
  role: sectionCardText,
  date: sectionCardText,
  cta_text: sectionCardText,
  cta_link: sectionCardText,
  icon: sectionCardText,
  link: sectionCardText,
  designation: sectionCardText,
  message: sectionCardText,
  year: sectionCardText,
  season: sectionCardText,
  image_url: z.string().url().optional().or(z.literal("")),
  sort_order: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "" || v === null) return 0;
      const n = typeof v === "number" ? v : parseInt(v, 10);
      return Number.isFinite(n) ? n : 0;
    }),
  is_active: z.boolean().optional(),
});

export const sectionCardUpdateSchema = z.object({
  id: z.string().uuid("Invalid card id"),
  data: sectionCardCreateSchema.partial().extend({
    initials: z.string().max(4).optional(),
    updated_at: z.string().optional(),
  }),
});

export type SectionCardCreateData = z.infer<typeof sectionCardCreateSchema>;
export type SectionCardUpdateData = z.infer<typeof sectionCardUpdateSchema>;

// =============================================================
// Teacher Records
// =============================================================

export const teacherSchema = z.object({
  employee_id: z.string().min(1, "Employee ID is required"),
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  date_of_joining: z.string().optional().or(z.literal("")),
  date_of_birth: dobOptionalSchema,
  gender: z.enum(["male", "female", "other"]).optional(),
  qualifications: z.string().optional().or(z.literal("")),
  specialization: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  aadhar_number: z.string().optional().or(z.literal("")),
});

export type TeacherData = z.infer<typeof teacherSchema>;

// =============================================================
// Parent Records
// =============================================================

export const parentSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: phoneRequiredSchema,
  alternate_phone: z.string().optional().or(z.literal("")),
  occupation: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  relationship: z.enum(["father", "mother", "guardian"], {
    message: "Please select relationship",
  }),
});

export type ParentData = z.infer<typeof parentSchema>;

// =============================================================
// Payment Orders
// =============================================================

export const paymentOrderSchema = z.object({
  student_id: z.string().uuid("Invalid student"),
  fee_structure_id: z.string().uuid("Invalid fee structure"),
  amount: z.number().finite("Amount must be a valid number").positive("Amount must be positive"),
  month: z.string().optional().or(z.literal("")),
  gateway: z.enum(["razorpay", "stripe", "manual"]).optional(),
});

export type PaymentOrderData = z.infer<typeof paymentOrderSchema>;

// =============================================================
// Result Master (Phase 3)
// =============================================================

const passMarkModeEnum = z.enum(["percentage", "raw_marks"]);
const roundingModeEnum = z.enum(["none", "half_up", "half_down", "ceil", "floor"]);
const graceConditionEnum = z.enum(["failing_only", "any_subject"]);
const nonScholasticPlacementEnum = z.enum(["below", "above", "separate_page"]);
const subjectRoleEnum = z.enum(["main", "optional"]);

// Create: class_id + academic_year_id required; everything else optional (DB defaults apply).
// `pass_criteria_type` is intentionally `z.string()` so new types can ship without schema churn;
// the route handler cross-checks it against SUPPORTED_PASS_CRITERIA_TYPES.
export const resultMasterCreateSchema = z.object({
  class_id: z.string().uuid("Invalid class_id"),
  academic_year_id: z.string().uuid("Invalid academic_year_id"),
  pass_mark_mode: passMarkModeEnum.optional(),
  pass_mark_value: z.number().min(0).optional(),
  pass_criteria_type: z.string().min(1).optional(),
  pass_criteria_config: z.record(z.string(), z.unknown()).optional(),
  show_rank: z.boolean().optional(),
  show_extra_separately: z.boolean().optional(),
  include_non_scholastic: z.boolean().optional(),
  show_division: z.boolean().optional(),
  division_scheme: z.enum(["cbse"]).optional(),
  non_scholastic_placement: nonScholasticPlacementEnum.optional(),
  grade_scale_id: z.string().uuid().nullable().optional(),
  grace_marks_per_subject_max: z.number().min(0).max(100).optional(),
  grace_marks_total_max: z.number().min(0).max(100).optional(),
  grace_marks_condition: graceConditionEnum.optional(),
  rounding_mode: roundingModeEnum.optional(),
  rounding_precision: z.number().int().min(0).max(2).optional(),
  round_raw_marks: z.boolean().optional(),
  class_test_best_of: z.number().int().positive().nullable().optional(),
  practical_best_of: z.number().int().positive().nullable().optional(),
});

// PATCH accepts the same optional fields but rejects immutable ones at the handler level.
export const resultMasterUpdateSchema = z.object({
  pass_mark_mode: passMarkModeEnum.optional(),
  pass_mark_value: z.number().min(0).optional(),
  pass_criteria_type: z.string().min(1).optional(),
  pass_criteria_config: z.record(z.string(), z.unknown()).optional(),
  show_rank: z.boolean().optional(),
  show_extra_separately: z.boolean().optional(),
  include_non_scholastic: z.boolean().optional(),
  show_division: z.boolean().optional(),
  division_scheme: z.enum(["cbse"]).optional(),
  non_scholastic_placement: nonScholasticPlacementEnum.optional(),
  grade_scale_id: z.string().uuid().nullable().optional(),
  grace_marks_per_subject_max: z.number().min(0).max(100).optional(),
  grace_marks_total_max: z.number().min(0).max(100).optional(),
  grace_marks_condition: graceConditionEnum.optional(),
  rounding_mode: roundingModeEnum.optional(),
  rounding_precision: z.number().int().min(0).max(2).optional(),
  round_raw_marks: z.boolean().optional(),
  class_test_best_of: z.number().int().positive().nullable().optional(),
  practical_best_of: z.number().int().positive().nullable().optional(),
});

export const resultMasterSubjectsPutSchema = z.object({
  subjects: z
    .array(
      z.object({
        subject_id: z.string().uuid("Invalid subject_id"),
        role: subjectRoleEnum,
        pass_mark_value_override: z.number().min(0).nullable(),
        sort_order: z.number().int().min(0),
      })
    ),
});

export const resultMasterExamConfigsPutSchema = z.object({
  exam_configs: z
    .array(
      z.object({
        exam_type_id: z.string().uuid("Invalid exam_type_id"),
        is_applicable: z.boolean(),
        weightage: z.number().finite().min(0).max(100).nullable(),
        max_marks_override: z.number().finite().positive().nullable(),
        sort_order: z.number().int().min(0),
      })
    ),
});

export type ResultMasterCreateData = z.infer<typeof resultMasterCreateSchema>;
export type ResultMasterUpdateData = z.infer<typeof resultMasterUpdateSchema>;
export type ResultMasterSubjectsPutData = z.infer<typeof resultMasterSubjectsPutSchema>;
export type ResultMasterExamConfigsPutData = z.infer<typeof resultMasterExamConfigsPutSchema>;
