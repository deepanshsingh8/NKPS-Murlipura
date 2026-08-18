import { z } from "zod";
import {
  STUDENT_TEMPLATE_FIELDS,
  getTemplateField,
  normalizeEnum,
  normalizeNumber,
  normalizeYesNo,
} from "./student-template";

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

// ── Public enquiry hardening (Layer 1: free anti-fake checks) ───────────────
// Goal: reject obviously-fake but well-formatted email/phone on the public
// contact + admissions-enquiry forms. Kept separate from the ERP phone schemas
// so internal staff data entry isn't affected. Ownership verification (OTP /
// email confirmation) is a later layer — see tasks/email-phone-verification.md.

// Disposable / temp-mail domains we refuse. Lowercase, no leading "@".
export const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  "mailinator.com", "yopmail.com", "guerrillamail.com", "10minutemail.com",
  "tempmail.com", "temp-mail.org", "throwawaymail.com", "getnada.com",
  "trashmail.com", "sharklasers.com", "dispostable.com", "fakeinbox.com",
  "maildrop.cc", "mintemail.com", "mailnesia.com", "mohmal.com",
  "emailondeck.com", "moakt.com", "tempr.email", "spam4.me",
]);

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase().trim();
}

// Obvious junk mobiles: all-same-digit or trivially sequential.
const SEQUENTIAL_MOBILES = new Set<string>([
  "1234567890", "0123456789", "9876543210", "0987654321",
]);
function isJunkMobile(num: string): boolean {
  if (/^(\d)\1{9}$/.test(num)) return true; // 0000000000, 9999999999, …
  if (SEQUENTIAL_MOBILES.has(num)) return true;
  return false;
}

const enquiryEmailSchema = z
  .string()
  .min(1, "Email is required")
  .email("Please enter a valid email")
  .refine((v) => !DISPOSABLE_EMAIL_DOMAINS.has(emailDomain(v)), {
    message: "Please use a permanent email — temporary email providers aren't accepted",
  });

const enquiryPhoneSchema = phoneRequiredSchema.refine(
  (v) => {
    const n = normalizeIndianMobile(v);
    return n !== null && !isJunkMobile(n);
  },
  { message: "Please enter a real 10-digit mobile number" }
);

export const contactFormSchema = z.object({
  fullName: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be at most 100 characters"),
  email: enquiryEmailSchema,
  phone: enquiryPhoneSchema,
  subject: z
    .string()
    .min(1, "Please select a subject")
    .max(120, "Subject must be at most 120 characters"),
  message: z
    .string()
    .min(10, "Message must be at least 10 characters")
    .max(5000, "Message must be at most 5000 characters"),
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
    // Exactly one of fee_structure_id / bus_stop_id must be present.
    // Enforced in the superRefine below. Transport payments are routed
    // against a bus_stops row directly (migration 074).
    fee_structure_id: z.string().uuid("Invalid fee structure").optional(),
    bus_stop_id: z.string().uuid("Invalid bus stop").optional(),
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
    const hasStop = Boolean(val.bus_stop_id);
    if (hasFs === hasStop) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Either fee_structure_id or bus_stop_id is required (not both)",
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

// Migration 074 — stop-based transport. Fee attaches to a bus stop; students
// boarding there pay that stop's flat fee.
const transportFrequencyEnum = z.enum([
  "monthly",
  "quarterly",
  "annual",
  "one_time",
]);
const transportDirectionEnum = z.enum(["both", "pickup_only", "drop_only"]);

export const busStopSchema = z.object({
  name: z.string().trim().min(1, "Stop name is required").max(120),
  area: optionalTrimmedString,
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});
export type BusStopData = z.infer<typeof busStopSchema>;

export const busStopFeeSchema = z.object({
  bus_stop_id: z.string().uuid("Invalid bus stop"),
  academic_year_id: z.string().uuid("Invalid academic year"),
  amount: z.number().positive("Amount must be > 0"),
  frequency: transportFrequencyEnum.optional(),
  is_active: z.boolean().optional(),
});
export type BusStopFeeData = z.infer<typeof busStopFeeSchema>;

export const busSchema = z.object({
  bus_number: z.string().trim().min(1, "Bus number is required").max(40),
  registration_number: optionalTrimmedString,
  capacity: z.number().int().positive("Capacity must be > 0").nullable().optional(),
  driver_id: z.string().uuid("Invalid driver").nullable().optional(),
  conductor_id: z.string().uuid("Invalid conductor").nullable().optional(),
  is_active: z.boolean().optional(),
  notes: optionalTrimmedString,
});
export type BusData = z.infer<typeof busSchema>;

export const busRouteStopSchema = z.object({
  bus_id: z.string().uuid("Invalid bus"),
  bus_stop_id: z.string().uuid("Invalid bus stop"),
  sort_order: z.number().int().nullable().optional(),
});
export type BusRouteStopData = z.infer<typeof busRouteStopSchema>;

// Per-student transport assignment (opt-in, stop, bus, one-side facility).
export const studentTransportAssignmentSchema = z
  .object({
    enrollment_id: z.string().uuid("Invalid enrollment"),
    has_transport: z.boolean(),
    bus_stop_id: z.string().uuid("Invalid bus stop").nullable().optional(),
    bus_id: z.string().uuid("Invalid bus").nullable().optional(),
    transport_direction: transportDirectionEnum.optional(),
    transport_fee_override: z
      .number()
      .positive("Override must be > 0")
      .nullable()
      .optional(),
    pickup_address: optionalTrimmedString,
  })
  .superRefine((val, ctx) => {
    if (val.has_transport && !val.bus_stop_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A bus stop is required when transport is enabled",
        path: ["bus_stop_id"],
      });
    }
    // One-side facility always carries a custom amount (no half-fee rule).
    if (
      val.transport_direction &&
      val.transport_direction !== "both" &&
      (val.transport_fee_override === null ||
        val.transport_fee_override === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "One-side facility needs a custom fee amount",
        path: ["transport_fee_override"],
      });
    }
  });
export type StudentTransportAssignmentData = z.infer<
  typeof studentTransportAssignmentSchema
>;

// Transport change / amendment request (office or parent).
export const transportChangeRequestSchema = z
  .object({
    enrollment_id: z.string().uuid("Invalid enrollment"),
    change_type: z.enum([
      "bus_change",
      "stop_change",
      "direction_change",
      "drop",
      "resume",
    ]),
    amended_bus_id: z.string().uuid("Invalid bus").nullable().optional(),
    amended_stop_id: z.string().uuid("Invalid bus stop").nullable().optional(),
    direction: transportDirectionEnum.nullable().optional(),
    effective_from: z.string().min(1, "Start date is required"),
    effective_to: z.string().nullable().optional(),
    reason_code: z.enum([
      "house_shifting",
      "rented_house_change",
      "bus_point_temporary_change",
      "facility_dropped",
      "one_side_facility",
      "other",
    ]),
    reason_note: optionalTrimmedString,
    application_url: optionalTrimmedString,
  })
  .superRefine((val, ctx) => {
    if (
      val.reason_code === "other" &&
      (!val.reason_note || val.reason_note.trim().length < 3)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please describe the reason",
        path: ["reason_note"],
      });
    }
    if (
      val.effective_to &&
      val.effective_from &&
      val.effective_to < val.effective_from
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be on or after the start date",
        path: ["effective_to"],
      });
    }
    if (val.change_type === "bus_change" && !val.amended_bus_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select the amended bus",
        path: ["amended_bus_id"],
      });
    }
    if (val.change_type === "stop_change" && !val.amended_stop_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select the new stop",
        path: ["amended_stop_id"],
      });
    }
    if (val.change_type === "direction_change" && !val.direction) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select the direction",
        path: ["direction"],
      });
    }
  });
export type TransportChangeRequestData = z.infer<
  typeof transportChangeRequestSchema
>;

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
  // M9 — late fee config. All default to 0/no-cap (no late fee).
  late_fee_percent: z.number().finite().min(0).max(100).optional(),
  // Legacy one-time flat surcharge — kept for backward compatibility, no longer
  // surfaced in the form (superseded by late_fee_per_day, migration 080).
  late_fee_fixed_amount: z.number().finite().min(0).optional(),
  // Per-day flat surcharge (₹/day past the due date).
  late_fee_per_day: z.number().finite().min(0).optional(),
  // Optional ceiling on the accrued late fee. null/omitted = uncapped.
  late_fee_max: z.number().finite().min(0).nullable().optional(),
});

export type FeeStructureData = z.infer<typeof feeStructureSchema>;

// ---------------------------------------------------------------------------
// Fee schedule (migration 085)
//
// One row of the school's fee-schedule grid. Persisted as a `fee_structures`
// row with frequency='one_time'; `id` is present when the row already exists
// and absent for a row the admin just added, which is how the save endpoint
// tells an update from an insert.
// ---------------------------------------------------------------------------

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const feeScheduleRowSchema = z
  .object({
    id: z.string().uuid().optional(),
    fee_type: z.string().min(1, "Fee head is required"),
    due_date: isoDateSchema,
    instalment_name: z.string().max(120).optional().or(z.literal("")),
    amount: z
      .number()
      .finite("Amount must be a valid number")
      .positive("Amount must be greater than 0"),
    student_type: z.enum(["new", "existing", "both"]),
    month_label: z.string().max(60).optional().or(z.literal("")),
    late_fee_start_date: isoDateSchema.nullable().optional(),
    late_fee_percent: z.number().finite().min(0).max(100).optional(),
    late_fee_per_day: z.number().finite().min(0).optional(),
    late_fee_max: z.number().finite().min(0).nullable().optional(),
  })
  .refine(
    (row) =>
      !row.late_fee_start_date || row.late_fee_start_date >= row.due_date,
    {
      message: "Late fee start date cannot be before the due date",
      path: ["late_fee_start_date"],
    }
  );

export const feeScheduleSchema = z
  .object({
    academic_year_id: z.string().uuid("Invalid academic year"),
    class_name: z.string().min(1, "Class is required"),
    // null = the schedule applies to the whole class (every stream).
    stream_id: z.string().uuid().nullable().optional(),
    rows: z.array(feeScheduleRowSchema).max(60, "Too many instalments"),
  })
  .refine(
    (payload) => {
      // Two rows for the same head, due date and audience would double-bill —
      // the office means to edit one row, not add a twin.
      const seen = new Set<string>();
      for (const row of payload.rows) {
        const key = `${row.fee_type}|${row.due_date}|${row.student_type}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    {
      message:
        "Duplicate row: the same fee head, due date and student type appears twice",
      path: ["rows"],
    }
  );

export type FeeScheduleRowData = z.infer<typeof feeScheduleRowSchema>;
export type FeeScheduleData = z.infer<typeof feeScheduleSchema>;

// Copying a saved schedule onto other classes / streams. Each target is a
// (class_name, stream_id) pair; stream_id is null for a whole-class schedule.
export const feeScheduleCopySchema = z.object({
  academic_year_id: z.string().uuid("Invalid academic year"),
  source_class_name: z.string().min(1, "Source class is required"),
  source_stream_id: z.string().uuid().nullable().optional(),
  targets: z
    .array(
      z.object({
        class_name: z.string().min(1),
        stream_id: z.string().uuid().nullable().optional(),
      })
    )
    .min(1, "Pick at least one class to copy to")
    .max(40),
});

export type FeeScheduleCopyData = z.infer<typeof feeScheduleCopySchema>;

export const timetablePeriodSchema = z.object({
  class_id: z.string().uuid("Invalid class"),
  subject_id: z.string().uuid("Invalid subject"),
  teacher_id: z.string().uuid("Invalid teacher"),
  day_of_week: z.number().int().min(1).max(6, "Day must be between 1 (Monday) and 6 (Saturday)"),
  // Period 0 ("zero period" / pre-first period) is allowed, so the floor is 0,
  // not 1.
  period_number: z.number().int().min(0, "Period number cannot be negative"),
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

// Student claiming their own record at first login: admission number + DOB,
// verified the same way as the parent link (no relationship needed).
export const linkSelfStudentSchema = z.object({
  admission_no: admissionNoSchema,
  date_of_birth: dobBaseSchema,
});

export type LinkSelfStudentData = z.infer<typeof linkSelfStudentSchema>;

// =============================================================
// Student Records
// =============================================================
// The field set mirrors the UDISE+ student template registry
// (lib/student-template.ts) — a module-init assertion below keeps the two
// from drifting when a template field is added.

const optionalText = z.string().optional().or(z.literal(""));

/** YES/NO/Y/N/true/false/boolean → boolean; blank/unknown → dropped. */
const yesNoField = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return undefined;
  return normalizeYesNo(v);
}, z.boolean().optional());

/** Enum via the registry's alias-aware matcher; unknown → dropped (or kept
 *  raw for lenient enums such as Social Category). */
function enumField(key: string) {
  const field = getTemplateField(key);
  if (!field?.enumValues) throw new Error(`No enum registry entry for ${key}`);
  const values = field.enumValues.map((ev) => ev.value);
  return z.preprocess((v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    return normalizeEnum(field, String(v));
  }, field.lenientEnum
    ? z.string().optional()
    : z.string().refine((v) => values.includes(v), { message: `Invalid ${field.label}` }).optional());
}

/** "2,50,000" / "142 cm" / 76 → number in [min, max]; unparseable → dropped. */
function numberField(min: number, max: number) {
  return z.preprocess((v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
    return normalizeNumber(String(v));
  }, z.number().min(min).max(max).optional());
}

/** Optional YYYY-MM-DD (any date, unlike DOB which must be in the past). */
const dateOptionalSchema = z
  .string()
  .optional()
  .refine(
    (v) => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))),
    { message: "Date must be YYYY-MM-DD" }
  );

const mobileOptionalSchema = z
  .string()
  .regex(/^\d{10}$/, "Mobile number must be exactly 10 digits")
  .optional()
  .or(z.literal(""));

const pincodeOptionalSchema = z
  .string()
  .regex(/^\d{6}$/, "Pin code must be exactly 6 digits")
  .optional()
  .or(z.literal(""));

// UDISE+ profile fields shared by the single-student form schema and the
// bulk-upload row schema. Booleans/enums/numbers coerce from sheet text.
const udiseProfileFields = {
  // General profile
  name_as_per_aadhar: optionalText,
  jan_aadhar_number: optionalText,
  mother_occupation: optionalText,
  mother_qualification: optionalText,
  mother_mobile: mobileOptionalSchema,
  mother_annual_income: numberField(0, 999_999_999),
  father_occupation: optionalText,
  father_qualification: optionalText,
  father_mobile: mobileOptionalSchema,
  father_annual_income: numberField(0, 999_999_999),
  guardian_name: optionalText,
  guardian_relation: optionalText,
  guardian_mobile: mobileOptionalSchema,
  present_pincode: pincodeOptionalSchema,
  permanent_address: optionalText,
  permanent_pincode: pincodeOptionalSchema,
  mother_tongue: optionalText,
  minority_group: enumField("minority_group"),
  is_bpl: yesNoField,
  is_ews: yesNoField,
  is_cwsn: yesNoField,
  cwsn_impairment_type: optionalText,
  indian_national: yesNoField, // derived — mapped to `nationality` server-side
  height_cm: numberField(1, 299),
  weight_kg: numberField(1, 499),
  religion: optionalText,
  // Enrolment profile
  admission_date: dateOptionalSchema,
  is_rte: yesNoField,
  medium_of_instruction: enumField("medium_of_instruction"),
  previous_school_address: optionalText,
  previous_school_block: optionalText,
  previous_school_district: optionalText,
  previous_school_state: optionalText,
  previous_school_udise_code: optionalText,
  previous_school_reason_for_leaving: optionalText,
  previous_class_studied: optionalText,
  previous_school_board: optionalText,
  board_roll_number: optionalText,
  board_percentage: numberField(0, 100),
  last_session_attendance: optionalText,
  is_staff_ward: yesNoField,
  participates_ncc: yesNoField,
  participates_nss: yesNoField,
  participates_scouts: yesNoField,
  participates_competitions: yesNoField,
  distance_band: enumField("distance_band"),
  parent_highest_education: enumField("parent_highest_education"),
};

export const studentSchema = z.object({
  admission_no: admissionNoSchema,
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  father_name: optionalText,
  mother_name: optionalText,
  date_of_birth: dobOptionalSchema,
  // enumField (not bare z.enum): the admin form sends "" for a blank select,
  // which z.enum(...).optional() rejects — making optional fields look
  // mandatory. enumField maps blank/unknown to undefined instead.
  gender: enumField("gender"),
  address: optionalText,
  phone: optionalText,
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  blood_group: enumField("blood_group"),
  category: enumField("category"),
  aadhar_number: optionalText,
  previous_school: optionalText,
  ...udiseProfileFields,
});

export type StudentData = z.infer<typeof studentSchema>;

export const enrollmentStatusSchema = z.enum(['active', 'passed', 'failed', 'terminated', 'exited']);

// Bulk rows are forgiving (only admission/name/class are required; gender and
// blood group arrive pre-normalized from the client but unknown values must
// not fail a row). 500 rows per request — the client chunks larger files so
// a 50-column sheet stays under the serverless request-body limit.
export const studentBulkUploadSchema = z.object({
  students: z.array(
    z.object({
      admission_no: admissionNoSchema,
      full_name: z.string().min(2, "Name is required"),
      class_name: z.string().min(1, "Class is required"),
      section: optionalText,
      stream: optionalText,
      subjects: optionalText, // raw comma/semicolon list, resolved server-side
      father_name: optionalText,
      mother_name: optionalText,
      date_of_birth: dobOptionalSchema,
      gender: optionalText,
      phone: optionalText,
      address: optionalText,
      roll_number: z.number().int().optional(),
      email: optionalText,
      blood_group: optionalText,
      category: enumField("category"),
      aadhar_number: optionalText,
      previous_school: optionalText,
      ...udiseProfileFields,
      // Bulk sheets carry dirty phone data; row-level 10-digit enforcement
      // would reject entire students over a typo. Keep these permissive here
      // (the strict rules above still apply to the admin form).
      mother_mobile: optionalText,
      father_mobile: optionalText,
      guardian_mobile: optionalText,
      present_pincode: optionalText,
      permanent_pincode: optionalText,
    })
  ).min(1, "At least one student is required").max(500, "Too many rows in one request"),
});

export type StudentBulkUploadData = z.infer<typeof studentBulkUploadSchema>;

// Registry ↔ schema drift guard: every template field must be representable
// in a bulk row. Throws at module init (i.e. at build/dev time) if a field
// was added to student-template.ts without a matching schema entry.
{
  const rowKeys = new Set(
    Object.keys(studentBulkUploadSchema.shape.students.element.shape)
  );
  const missing = STUDENT_TEMPLATE_FIELDS.filter((f) => !rowKeys.has(f.key)).map(
    (f) => f.key
  );
  if (missing.length > 0) {
    throw new Error(
      `studentBulkUploadSchema is missing template fields: ${missing.join(", ")} — ` +
        "add them alongside the new entry in lib/student-template.ts"
    );
  }
}

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
      license_number: z.string().optional().or(z.literal("")),
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
  // Accept null too: a fresh add with no photo sends `photo_url: null`
  // (existingPhotoUrl defaults to null), which a plain `.optional()` union
  // would reject with "Invalid data".
  photo_url: z.string().url().nullish().or(z.literal("")),
  sort_order: z.number().int().min(0).max(100000).optional(),
  // The edit form sends `null` (not "") for optional fields the admin leaves
  // blank or clears, so these must accept null in addition to ""/undefined —
  // otherwise an otherwise-valid staff/teacher update is rejected with
  // "Invalid data". null is written through to the (nullable) columns to
  // clear them.
  email: z.string().email("Invalid email").nullish().or(z.literal("")),
  phone: phoneOptionalSchema.nullish().or(z.literal("")),
  date_of_birth: dobOptionalSchema.nullable(),
  address: optionalNullableString.nullable(),
  qualifications: optionalNullableString.nullable(),
  license_number: optionalNullableString.nullable(),
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
