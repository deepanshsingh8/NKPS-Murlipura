// Student template field registry — single source of truth for the school's
// mandated UDISE+-style student template (General Profile, 21 particulars +
// Enrolment Profile, 12 particulars).
//
// Every consumer of the ~50 template fields derives from this list so they
// can never drift: the bulk-upload sheet headers + column alias matching +
// per-cell normalization (StudentBulkUpload.tsx), the API insert/update
// whitelists (api/students, api/students/bulk), the per-student xlsx export
// layout (api/students/[id]/export), the admin form sections and detail view
// (people/students), and the flat CSV export columns.
//
// Adding a template field = one entry here + a column in migration NNN + a
// line in studentSchema/studentBulkUploadSchema (a `satisfies` guard in
// validations.ts fails the build if the schemas fall behind).

export type FieldSource = "students" | "enrollment" | "derived" | "subjects";
export type FieldSection = "general" | "enrolment";
export type FieldKind =
  | "text"
  | "name" // text, title-cased on import
  | "date" // stored YYYY-MM-DD, displayed DD/MM/YYYY
  | "boolean" // nullable — unknown must stay distinguishable from NO
  | "enum"
  | "number"
  | "integer";

export interface EnumValue {
  /** Stored value (DB CHECK token, or display value for lenient enums). */
  value: string;
  /** Human label used in forms, exports and CSVs. */
  label: string;
  /** Extra spellings accepted on import (normalized form). */
  aliases?: string[];
}

export interface StudentTemplateField {
  /** DB column on `students`, or a virtual key for enrollment/derived data. */
  key: string;
  source: FieldSource;
  section: FieldSection;
  /** Particular number within the section (template S.No.). Fields sharing a
   *  number render as one merged group in the per-student export. */
  particular: number;
  /** Canonical bulk-sheet header (also the form label). */
  label: string;
  /** Row text in the per-student export (the template's "Particulars" column).
   *  Defaults to `label`. */
  exportLabel?: string;
  kind: FieldKind;
  enumValues?: readonly EnumValue[];
  /** Unmatched enum input keeps the raw text instead of blanking (used for
   *  Social Category, which is an unconstrained legacy column). */
  lenientEnum?: boolean;
  /** Extra lowercase header spellings accepted on import. The normalized
   *  `label` is always accepted automatically. */
  aliases?: string[];
  /** Mandatory field (admission_no/full_name/class only): row-level requirement
   *  in bulk upload, "*" suffix on the form label and bulk template header. */
  required?: boolean;
  /** Not a template particular — carried in bulk sheet/forms (phone, email,
   *  roll no, …) but excluded from the two-profile export layout. */
  extra?: boolean;
  /** Bulk template column width. */
  colWidth?: number;
}

// ── Enum value sets ─────────────────────────────────────────────────────────

export const GENDERS: readonly EnumValue[] = [
  { value: "male", label: "Male", aliases: ["m", "boy"] },
  { value: "female", label: "Female", aliases: ["f", "girl"] },
  { value: "other", label: "Other", aliases: ["o"] },
];

export const BLOOD_GROUPS_ENUM: readonly EnumValue[] = [
  { value: "A+", label: "A+", aliases: ["a positive", "a pos"] },
  { value: "A-", label: "A-", aliases: ["a negative", "a neg"] },
  { value: "B+", label: "B+", aliases: ["b positive", "b pos"] },
  { value: "B-", label: "B-", aliases: ["b negative", "b neg"] },
  { value: "AB+", label: "AB+", aliases: ["ab positive", "ab pos"] },
  { value: "AB-", label: "AB-", aliases: ["ab negative", "ab neg"] },
  { value: "O+", label: "O+", aliases: ["o positive", "o pos"] },
  { value: "O-", label: "O-", aliases: ["o negative", "o neg"] },
];

export const SOCIAL_CATEGORIES: readonly EnumValue[] = [
  { value: "General", label: "General", aliases: ["gen", "general category", "ur", "unreserved"] },
  { value: "SC", label: "SC", aliases: ["scheduled caste"] },
  { value: "ST", label: "ST", aliases: ["scheduled tribe"] },
  { value: "OBC", label: "OBC", aliases: ["other backward class", "other backward classes"] },
  { value: "MBC", label: "MBC", aliases: ["most backward class"] },
];

export const MINORITY_GROUPS: readonly EnumValue[] = [
  { value: "muslim", label: "Muslim" },
  { value: "sikh", label: "Sikh" },
  { value: "christian", label: "Christian" },
  { value: "jain", label: "Jain" },
  { value: "buddhist", label: "Buddhist" },
  { value: "parsi", label: "Parsi" },
  { value: "none", label: "NA", aliases: ["na", "n a", "nil", "no", "not applicable", "-"] },
];

export const MEDIUMS: readonly EnumValue[] = [
  { value: "english", label: "English", aliases: ["eng"] },
  { value: "hindi", label: "Hindi", aliases: ["hin"] },
];

export const DISTANCE_BANDS: readonly EnumValue[] = [
  { value: "1-3km", label: "1-3 KM", aliases: ["1 3 km", "13 km", "1 to 3 km", "under 3 km", "less than 3 km", "0 3 km"] },
  { value: "3-5km", label: "3-5 KM", aliases: ["3 5 km", "35 km", "3 to 5 km"] },
  { value: "5-10km", label: "5-10 KM", aliases: ["5 10 km", "510 km", "5 to 10 km"] },
  {
    value: "above-10km",
    label: "More than 10 KM",
    aliases: ["more than 10 km", "10 km", "above 10 km", "over 10 km", "greater than 10 km"],
  },
];

export const EDUCATION_LEVELS: readonly EnumValue[] = [
  { value: "primary", label: "Primary" },
  { value: "upper_primary", label: "Upper Primary" },
  { value: "secondary", label: "Secondary", aliases: ["10th", "matric", "high school"] },
  { value: "senior_secondary", label: "Sr. Secondary", aliases: ["sr secondary", "senior secondary", "12th", "intermediate"] },
  { value: "graduation", label: "Graduation", aliases: ["graduate", "ug", "bachelors", "degree"] },
  { value: "pg_or_more", label: "PG or More", aliases: ["pg", "post graduation", "postgraduate", "post graduate", "masters", "phd"] },
];

// Salutations print on certificates and letters ("S/o Shri …"). Kept as two
// separate sets because the honorifics genuinely differ, and offering "Mrs"
// for a father is how bad data gets entered.
export const FATHER_SALUTATIONS: readonly EnumValue[] = [
  { value: "mr", label: "Mr.", aliases: ["mr", "mister"] },
  { value: "shri", label: "Shri", aliases: ["sri", "shree", "sh"] },
  { value: "dr", label: "Dr.", aliases: ["doctor"] },
  { value: "prof", label: "Prof.", aliases: ["professor"] },
  { value: "late", label: "Late", aliases: ["late shri", "l"] },
  { value: "capt", label: "Capt.", aliases: ["captain"] },
  { value: "col", label: "Col.", aliases: ["colonel"] },
];

export const MOTHER_SALUTATIONS: readonly EnumValue[] = [
  { value: "mrs", label: "Mrs.", aliases: ["mrs", "missus"] },
  { value: "ms", label: "Ms.", aliases: ["miss"] },
  { value: "smt", label: "Smt.", aliases: ["shrimati", "srimati"] },
  { value: "dr", label: "Dr.", aliases: ["doctor"] },
  { value: "prof", label: "Prof.", aliases: ["professor"] },
  { value: "late", label: "Late", aliases: ["late smt", "l"] },
];

// A pointer to whichever mobile column receives SMS — never a copy of the
// number. The old ERP stored a duplicated "Sms Mobile No" string and let it
// drift out of sync with the real numbers.
export const SMS_MOBILE_SOURCES: readonly EnumValue[] = [
  { value: "student", label: "Student", aliases: ["self", "student mobile"] },
  { value: "father", label: "Father", aliases: ["father mobile"] },
  { value: "mother", label: "Mother", aliases: ["mother mobile"] },
  { value: "guardian", label: "Guardian", aliases: ["guardian mobile"] },
];

export const AREA_TYPES: readonly EnumValue[] = [
  { value: "rural", label: "Rural" },
  { value: "urban", label: "Urban", aliases: ["city", "town"] },
];

// Manual override for the New/Old classification that is otherwise derived
// from admission_date against the session's date range.
export const STUDENT_TYPES: readonly EnumValue[] = [
  { value: "new", label: "New", aliases: ["new student", "fresh"] },
  { value: "old", label: "Old", aliases: ["old student", "existing", "continuing"] },
  { value: "transfer", label: "Transfer", aliases: ["transferred", "migrated"] },
];

// ── The registry ────────────────────────────────────────────────────────────
// Ordered exactly as the bulk template sheet: identifying columns first, then
// General Profile in particular order, extras, then Enrolment Profile.

export const STUDENT_TEMPLATE_FIELDS: readonly StudentTemplateField[] = [
  // ── Identifying / enrolment keys (always the first sheet columns) ──
  {
    key: "admission_no", source: "students", section: "enrolment", particular: 1,
    label: "Admission No", exportLabel: "Admission No. / S.R. No.", kind: "text", required: true, colWidth: 14,
    aliases: ["adm no", "admission number", "admno", "sr no", "serial no", "s no", "admission no sr no"],
  },
  {
    key: "full_name", source: "students", section: "general", particular: 1,
    label: "Name", exportLabel: "Name of the Student", kind: "name", required: true, colWidth: 22,
    aliases: ["student name", "full name", "students name", "pupil name", "name of the student"],
  },
  {
    key: "class_name", source: "enrollment", section: "enrolment", particular: 3,
    label: "Class", exportLabel: "Class", kind: "text", required: true, colWidth: 8,
    aliases: ["class name", "grade", "standard", "std"],
  },
  {
    key: "section", source: "enrollment", section: "enrolment", particular: 3,
    label: "Section", exportLabel: "Section", kind: "text", colWidth: 8,
    aliases: ["sec", "div", "division"],
  },
  {
    key: "stream", source: "enrollment", section: "enrolment", particular: 6,
    label: "Stream", exportLabel: "Stream (XI / XII)", kind: "text", colWidth: 12,
    aliases: ["specialization", "branch", "faculty", "stream selection", "stream selection for class xi xii"],
  },
  {
    key: "roll_number", source: "enrollment", section: "enrolment", particular: 3,
    label: "Roll No", kind: "integer", extra: true, colWidth: 8,
    aliases: ["roll number", "roll", "rollno"],
  },

  // ── General Profile ──
  {
    key: "gender", source: "students", section: "general", particular: 2,
    label: "Gender (M/F)", exportLabel: "Gender", kind: "enum", enumValues: GENDERS, colWidth: 10,
    aliases: ["gender", "sex"],
  },
  {
    key: "date_of_birth", source: "students", section: "general", particular: 3,
    label: "DOB (DD/MM/YYYY)", exportLabel: "Date of Birth", kind: "date", colWidth: 16,
    aliases: ["dob", "date of birth", "birth date", "birthdate", "d o b"],
  },
  {
    key: "aadhar_number", source: "students", section: "general", particular: 4,
    label: "Aadhar Number", exportLabel: "Aadhar No. of the Student", kind: "text", colWidth: 16,
    aliases: ["aadhar", "aadhaar", "aadhar no", "aadhaar no", "aadhaar number", "uid", "aadhar no of the student", "aadhar no of student"],
  },
  {
    key: "name_as_per_aadhar", source: "students", section: "general", particular: 5,
    label: "Name as per Aadhar", exportLabel: "Name as per Aadhar Card", kind: "name", colWidth: 22,
    aliases: ["name as per aadhaar", "name as per aadhar card", "aadhar name"],
  },
  {
    key: "jan_aadhar_number", source: "students", section: "general", particular: 6,
    label: "JAN Aadhar No", exportLabel: "JAN Aadhar No.", kind: "text", colWidth: 16,
    aliases: ["jan aadhar", "jan aadhaar", "jan aadhaar no", "jan aadhar number", "janaadhar"],
  },
  {
    key: "mother_name", source: "students", section: "general", particular: 7,
    label: "Mother's Name", kind: "name", colWidth: 20,
    aliases: ["mother name", "mother", "mothers name", "m name"],
  },
  {
    key: "mother_occupation", source: "students", section: "general", particular: 7,
    label: "Mother's Occupation", kind: "text", colWidth: 18,
    aliases: ["mother occupation", "mothers occupation"],
  },
  {
    key: "mother_qualification", source: "students", section: "general", particular: 7,
    label: "Mother's Qualification", kind: "text", colWidth: 18,
    aliases: ["mother qualification", "mothers qualification"],
  },
  {
    key: "mother_mobile", source: "students", section: "general", particular: 7,
    label: "Mother's Mobile", exportLabel: "Mother's Mobile No.", kind: "text", colWidth: 14,
    aliases: ["mother mobile", "mothers mobile", "mother mobile no", "mothers mobile no", "mother phone", "mothers phone"],
  },
  {
    key: "mother_annual_income", source: "students", section: "general", particular: 7,
    label: "Mother's Annual Income", kind: "number", colWidth: 16,
    aliases: ["mother annual income", "mothers annual income", "mother income", "mothers income"],
  },
  {
    key: "father_name", source: "students", section: "general", particular: 8,
    label: "Father's Name", kind: "name", colWidth: 20,
    aliases: ["father name", "father", "fathers name", "f name"],
  },
  {
    key: "father_occupation", source: "students", section: "general", particular: 8,
    label: "Father's Occupation", kind: "text", colWidth: 18,
    aliases: ["father occupation", "fathers occupation"],
  },
  {
    key: "father_qualification", source: "students", section: "general", particular: 8,
    label: "Father's Qualification", kind: "text", colWidth: 18,
    aliases: ["father qualification", "fathers qualification"],
  },
  {
    key: "father_mobile", source: "students", section: "general", particular: 8,
    label: "Father's Mobile", exportLabel: "Father's Mobile No.", kind: "text", colWidth: 14,
    aliases: ["father mobile", "fathers mobile", "father mobile no", "fathers mobile no", "father phone", "fathers phone"],
  },
  {
    key: "father_annual_income", source: "students", section: "general", particular: 8,
    label: "Father's Annual Income", kind: "number", colWidth: 16,
    aliases: ["father annual income", "fathers annual income", "father income", "fathers income"],
  },
  {
    key: "guardian_name", source: "students", section: "general", particular: 9,
    label: "Guardian's Name", kind: "name", colWidth: 20,
    aliases: ["guardian name", "guardian", "guardians name"],
  },
  {
    key: "guardian_relation", source: "students", section: "general", particular: 9,
    label: "Guardian's Relation", exportLabel: "Guardian's Relation with Student", kind: "text", colWidth: 16,
    aliases: ["guardian relation", "guardians relation", "guardian relation with student", "guardians relation with student", "relation with student"],
  },
  {
    key: "guardian_mobile", source: "students", section: "general", particular: 9,
    label: "Guardian's Mobile", exportLabel: "Guardian's Mobile No.", kind: "text", colWidth: 14,
    aliases: ["guardian mobile", "guardians mobile", "guardian mobile no", "guardians mobile no", "guardian phone"],
  },
  {
    key: "address", source: "students", section: "general", particular: 10,
    label: "Present Address", kind: "name", colWidth: 30,
    aliases: ["address", "residential address", "home address", "current address"],
  },
  {
    key: "present_pincode", source: "students", section: "general", particular: 10,
    label: "Present Pin Code", exportLabel: "Present Address Pin Code", kind: "text", colWidth: 10,
    aliases: ["present pincode", "pin code", "pincode", "present pin"],
  },
  {
    key: "permanent_address", source: "students", section: "general", particular: 11,
    label: "Permanent Address", kind: "name", colWidth: 30,
    aliases: ["permanent addr"],
  },
  {
    key: "permanent_pincode", source: "students", section: "general", particular: 11,
    label: "Permanent Pin Code", exportLabel: "Permanent Address Pin Code", kind: "text", colWidth: 10,
    aliases: ["permanent pincode", "permanent pin"],
  },
  {
    key: "blood_group", source: "students", section: "general", particular: 12,
    label: "Blood Group", exportLabel: "Blood Group of Student", kind: "enum", enumValues: BLOOD_GROUPS_ENUM, colWidth: 12,
    aliases: ["blood type", "bloodgroup", "blood group of student"],
  },
  {
    key: "mother_tongue", source: "students", section: "general", particular: 13,
    label: "Mother Tongue", kind: "text", colWidth: 14,
    aliases: ["mothertongue", "native language"],
  },
  {
    key: "category", source: "students", section: "general", particular: 14,
    label: "Social Category", kind: "enum", enumValues: SOCIAL_CATEGORIES, lenientEnum: true, colWidth: 14,
    aliases: ["category", "caste", "caste category", "reservation"],
  },
  {
    key: "minority_group", source: "students", section: "general", particular: 15,
    label: "Minority Group", kind: "enum", enumValues: MINORITY_GROUPS, colWidth: 14,
    aliases: ["minority"],
  },
  {
    key: "is_bpl", source: "students", section: "general", particular: 16,
    label: "BPL (Y/N)", exportLabel: "Whether BPL Beneficiary?", kind: "boolean", colWidth: 10,
    aliases: ["bpl", "bpl beneficiary", "whether bpl beneficiary"],
  },
  {
    key: "is_ews", source: "students", section: "general", particular: 17,
    label: "EWS (Y/N)", exportLabel: "Whether Belongs to EWS / Disadvantaged Group?", kind: "boolean", colWidth: 10,
    aliases: ["ews", "ews disadvantaged", "ews disadvantaged group", "whether belongs to ews disadvantaged group", "disadvantaged group"],
  },
  {
    key: "is_cwsn", source: "students", section: "general", particular: 18,
    label: "CWSN (Y/N)", exportLabel: "Whether CWSN?", kind: "boolean", colWidth: 10,
    aliases: ["cwsn", "whether cwsn"],
  },
  {
    key: "cwsn_impairment_type", source: "students", section: "general", particular: 18,
    label: "CWSN Impairment Type", exportLabel: "If Yes, Type of Impairment with Code", kind: "text", colWidth: 20,
    aliases: ["impairment type", "type of impairment", "impairment type with code", "type of impairment with code"],
  },
  {
    key: "indian_national", source: "derived", section: "general", particular: 19,
    label: "Indian National (Y/N)", exportLabel: "Whether the Student is Indian National?", kind: "boolean", colWidth: 12,
    aliases: ["indian national", "whether the student is indian national", "is indian national"],
  },
  {
    key: "height_cm", source: "students", section: "general", particular: 20,
    label: "Height (CM)", exportLabel: "Student's Height in Centimeter (CM)", kind: "number", colWidth: 10,
    aliases: ["height", "height cm", "students height", "height in cm"],
  },
  {
    key: "weight_kg", source: "students", section: "general", particular: 21,
    label: "Weight (KG)", exportLabel: "Student's Weight in Kilogram (KG)", kind: "number", colWidth: 10,
    aliases: ["weight", "weight kg", "students weight", "weight in kg"],
  },

  // ── Extras (not template particulars, kept for portal/contact needs) ──
  {
    key: "phone", source: "students", section: "general", particular: 90,
    label: "Phone", kind: "text", extra: true, colWidth: 14,
    aliases: ["mobile", "contact", "phone no", "mobile no", "contact no", "phone number", "student phone", "student mobile"],
  },
  {
    key: "email", source: "students", section: "general", particular: 91,
    label: "Email", kind: "text", extra: true, colWidth: 22,
    aliases: ["e mail", "email id", "email address", "mail", "student email"],
  },
  {
    key: "religion", source: "students", section: "general", particular: 92,
    label: "Religion", kind: "text", extra: true, colWidth: 12,
  },

  // ── Enrolment Profile ──
  {
    key: "admission_date", source: "students", section: "enrolment", particular: 2,
    label: "Date of Admission (DD/MM/YYYY)", exportLabel: "Date of Admission", kind: "date", colWidth: 20,
    aliases: ["date of admission", "admission date", "doa"],
  },
  {
    key: "is_rte", source: "students", section: "enrolment", particular: 4,
    label: "RTE (Y/N)", exportLabel: "Whether Admitted under RTE?", kind: "boolean", colWidth: 10,
    aliases: ["rte", "admitted under rte", "whether admitted under rte", "rte admission"],
  },
  {
    key: "medium_of_instruction", source: "students", section: "enrolment", particular: 5,
    label: "Medium of Instruction", exportLabel: "Medium of Instruction?", kind: "enum", enumValues: MEDIUMS, colWidth: 14,
    aliases: ["medium"],
  },
  {
    key: "subjects", source: "subjects", section: "enrolment", particular: 6,
    label: "Subjects (comma separated)", exportLabel: "Subjects", kind: "text", colWidth: 30,
    aliases: ["subjects", "subject list", "subjects comma separated", "opted subjects", "elective subjects"],
  },
  {
    key: "previous_school", source: "students", section: "enrolment", particular: 7,
    label: "Previous School Name", exportLabel: "Previous School's Name", kind: "name", colWidth: 24,
    aliases: ["previous school", "prev school", "last school", "previous institution", "previous schools name"],
  },
  {
    key: "previous_school_address", source: "students", section: "enrolment", particular: 7,
    label: "Previous School Address", exportLabel: "Previous School's Address", kind: "text", colWidth: 26,
    aliases: ["prev school address", "previous schools address"],
  },
  {
    key: "previous_school_block", source: "students", section: "enrolment", particular: 7,
    label: "Previous School Block", exportLabel: "Previous School's Block", kind: "text", colWidth: 14,
    aliases: ["prev school block"],
  },
  {
    key: "previous_school_district", source: "students", section: "enrolment", particular: 7,
    label: "Previous School District", exportLabel: "Previous School's District", kind: "text", colWidth: 14,
    aliases: ["prev school district"],
  },
  {
    key: "previous_school_state", source: "students", section: "enrolment", particular: 7,
    label: "Previous School State", exportLabel: "Previous School's State", kind: "text", colWidth: 14,
    aliases: ["prev school state"],
  },
  {
    key: "previous_school_udise_code", source: "students", section: "enrolment", particular: 7,
    label: "Previous School UDISE Code", exportLabel: "UDISE Code", kind: "text", colWidth: 16,
    aliases: ["udise code", "udise", "udise no"],
  },
  {
    key: "previous_school_reason_for_leaving", source: "students", section: "enrolment", particular: 7,
    label: "Reason for Leaving Previous School", exportLabel: "Reason for Leaving the Previous School", kind: "text", colWidth: 26,
    aliases: ["reason for leaving", "reason for leaving the previous school", "leaving reason"],
  },
  {
    key: "previous_class_studied", source: "students", section: "enrolment", particular: 7,
    label: "Previous Class Studied", kind: "text", colWidth: 14,
    aliases: ["previous class", "prev class studied", "last class studied"],
  },
  {
    key: "previous_school_board", source: "students", section: "enrolment", particular: 7,
    label: "Previous School Board", exportLabel: "Previous School's Board Name", kind: "text", colWidth: 16,
    aliases: ["board name", "previous board", "previous schools board name", "prev school board"],
  },
  {
    key: "board_roll_number", source: "students", section: "enrolment", particular: 7,
    label: "Board Roll No", exportLabel: "8th / 10th / 12th Board Roll No.", kind: "text", colWidth: 14,
    aliases: ["board roll number", "board roll", "8th 10th 12th board roll no"],
  },
  {
    key: "board_percentage", source: "students", section: "enrolment", particular: 7,
    label: "Board Percentage", exportLabel: "Percentage Scored in Board Result", kind: "number", colWidth: 12,
    aliases: ["board percent", "percentage scored in board result", "board result percentage", "percentage scored in board restult"],
  },
  {
    key: "last_session_attendance", source: "students", section: "enrolment", particular: 7,
    label: "Last Session Attendance", exportLabel: "Attendance of Last Academic Session", kind: "text", colWidth: 16,
    aliases: ["attendance of last academic session", "last academic session attendance", "previous attendance"],
  },
  {
    key: "is_staff_ward", source: "students", section: "enrolment", particular: 8,
    label: "Staff Ward (Y/N)", exportLabel: "Staff Ward?", kind: "boolean", colWidth: 10,
    aliases: ["staff ward", "staffward"],
  },
  {
    key: "participates_ncc", source: "students", section: "enrolment", particular: 9,
    label: "NCC (Y/N)", exportLabel: "Participates in NCC", kind: "boolean", colWidth: 8,
    aliases: ["ncc"],
  },
  {
    key: "participates_nss", source: "students", section: "enrolment", particular: 9,
    label: "NSS (Y/N)", exportLabel: "Participates in NSS", kind: "boolean", colWidth: 8,
    aliases: ["nss"],
  },
  {
    key: "participates_scouts", source: "students", section: "enrolment", particular: 9,
    label: "Scouts & Guides (Y/N)", exportLabel: "Participates in Scouts & Guide", kind: "boolean", colWidth: 12,
    aliases: ["scouts", "scouts guides", "scouts guide", "scout and guide", "scouts and guides"],
  },
  {
    key: "participates_competitions", source: "students", section: "enrolment", particular: 10,
    label: "Competitions/Olympiads (Y/N)",
    exportLabel: "Appeared in State / National Level Competitions or Olympiads?",
    kind: "boolean", colWidth: 14,
    aliases: ["competitions", "olympiads", "competitions olympiads", "state level competitions", "national level competitions"],
  },
  {
    key: "distance_band", source: "students", section: "enrolment", particular: 11,
    label: "Distance to School", exportLabel: "Approximate Distance of Student's Residence to School",
    kind: "enum", enumValues: DISTANCE_BANDS, colWidth: 16,
    aliases: ["distance", "distance band", "distance from school", "approximate distance", "distance of residence to school"],
  },
  {
    key: "parent_highest_education", source: "students", section: "enrolment", particular: 12,
    label: "Parent Highest Education",
    exportLabel: "Completed Highest Education Level of Mother / Father / Legal Guardian",
    kind: "enum", enumValues: EDUCATION_LEVELS, colWidth: 18,
    aliases: ["highest education", "parent education", "completed highest education level", "highest education level"],
  },

  // ── Custom-report fields (migration 089) ──────────────────────────────────
  // All `extra: true` on purpose. These are real columns that belong in the
  // bulk sheet, the student form and every report — but they are NOT
  // particulars of the school's mandated two-profile document, so they must
  // not renumber or intrude on the per-student export layout. `extra` is
  // exactly that distinction (see phone/email/religion above).
  //
  // Particular numbers continue the extras ranges already in use: general
  // extras from 93 (phone/email/religion hold 90–92), enrolment extras from 90.

  // ── General: identity & contact extras ──
  {
    key: "father_salutation", source: "students", section: "general", particular: 93,
    label: "Father's Title", kind: "enum", enumValues: FATHER_SALUTATIONS, extra: true, colWidth: 12,
    aliases: ["father title", "fathers title", "father salutation", "father prefix"],
  },
  {
    key: "mother_salutation", source: "students", section: "general", particular: 94,
    label: "Mother's Title", kind: "enum", enumValues: MOTHER_SALUTATIONS, extra: true, colWidth: 12,
    aliases: ["mother title", "mothers title", "mother salutation", "mother prefix"],
  },
  {
    key: "caste", source: "students", section: "general", particular: 95,
    label: "Caste", kind: "text", extra: true, colWidth: 14,
    aliases: ["community", "caste name", "sub caste"],
  },
  {
    key: "area_type", source: "students", section: "general", particular: 96,
    label: "Rural / Urban", kind: "enum", enumValues: AREA_TYPES, extra: true, colWidth: 12,
    aliases: ["area", "area type", "rural or urban", "locality", "region type"],
  },
  {
    key: "place_of_birth", source: "students", section: "general", particular: 97,
    label: "Place of Birth", kind: "text", extra: true, colWidth: 16,
    aliases: ["birth place", "pob"],
  },
  {
    key: "district", source: "students", section: "general", particular: 98,
    label: "District", kind: "text", extra: true, colWidth: 14,
    aliases: ["dist", "student district", "home district"],
  },
  {
    key: "state", source: "students", section: "general", particular: 99,
    label: "State", kind: "text", extra: true, colWidth: 14,
    aliases: ["student state", "home state"],
  },
  {
    key: "office_address", source: "students", section: "general", particular: 100,
    label: "Father's Office Address", kind: "text", extra: true, colWidth: 26,
    aliases: ["office address", "father office address", "fathers office address"],
  },
  {
    key: "mother_office_address", source: "students", section: "general", particular: 101,
    label: "Mother's Office Address", kind: "text", extra: true, colWidth: 26,
    aliases: ["mothers office address", "mother office"],
  },
  {
    key: "mailing_address", source: "students", section: "general", particular: 102,
    label: "Mailing Address", kind: "text", extra: true, colWidth: 26,
    aliases: ["postal address", "correspondence address"],
  },
  {
    key: "sms_mobile_source", source: "students", section: "general", particular: 103,
    label: "SMS Mobile", kind: "enum", enumValues: SMS_MOBILE_SOURCES, extra: true, colWidth: 12,
    aliases: ["sms mobile no", "sms number", "sms recipient", "sms to"],
  },

  // ── Enrolment: government / board identifiers ──
  {
    key: "pen_number", source: "students", section: "enrolment", particular: 90,
    label: "PEN No", kind: "text", extra: true, colWidth: 16,
    aliases: ["pen", "pen number", "enroll no", "enrollment no", "enroll no pen no", "permanent education number"],
  },
  {
    key: "apaar_number", source: "students", section: "enrolment", particular: 91,
    label: "APAAR No", kind: "text", extra: true, colWidth: 16,
    aliases: ["apaar", "apaar id", "abc id", "automated permanent academic account registry"],
  },
  {
    key: "cbse_registration_no", source: "students", section: "enrolment", particular: 92,
    label: "CBSE Reg. No", kind: "text", extra: true, colWidth: 16,
    aliases: ["cbse reg no", "cbse registration no", "cbse registration number", "board registration no"],
  },
  {
    key: "nic_number", source: "students", section: "enrolment", particular: 93,
    label: "NIC No", kind: "text", extra: true, colWidth: 14,
    aliases: ["nic", "nic no", "nic number"],
  },

  // ── Enrolment: admissions desk ──
  {
    key: "registration_no", source: "students", section: "enrolment", particular: 94,
    label: "Reg. No", kind: "text", extra: true, colWidth: 12,
    aliases: ["reg no", "registration no", "registration number"],
  },
  {
    key: "registration_date", source: "students", section: "enrolment", particular: 95,
    label: "Registration Date (DD/MM/YYYY)", exportLabel: "Registration Date", kind: "date", extra: true, colWidth: 20,
    aliases: ["reg date", "date of registration"],
  },
  {
    key: "form_no", source: "students", section: "enrolment", particular: 96,
    label: "Form No", kind: "text", extra: true, colWidth: 10,
    aliases: ["form number", "admission form no"],
  },
  {
    key: "admission_confirm_date", source: "students", section: "enrolment", particular: 97,
    label: "Admission Confirm Date (DD/MM/YYYY)", exportLabel: "Admission Confirm Date",
    kind: "date", extra: true, colWidth: 22,
    aliases: ["admission confirmed on", "confirm date", "date of confirmation"],
  },
  {
    key: "counsellor_name", source: "students", section: "enrolment", particular: 98,
    label: "Counsellor Name", kind: "name", extra: true, colWidth: 18,
    aliases: ["counselor name", "counsellor", "counselor"],
  },
  {
    key: "counsellor_remark", source: "students", section: "enrolment", particular: 99,
    label: "Counsellor Remark", kind: "text", extra: true, colWidth: 26,
    aliases: ["counselor remark", "counsellor remarks", "counselling notes"],
  },
  {
    key: "staff_reference", source: "students", section: "enrolment", particular: 100,
    label: "Staff Reference", kind: "text", extra: true, colWidth: 18,
    aliases: ["referred by", "staff ref", "reference"],
  },
  {
    key: "student_type", source: "students", section: "enrolment", particular: 101,
    label: "Student Type", kind: "enum", enumValues: STUDENT_TYPES, extra: true, colWidth: 12,
    aliases: ["new old", "old new", "type of student"],
  },
  {
    key: "caution_money_receipt_no", source: "students", section: "enrolment", particular: 102,
    label: "Caution Money Receipt No", kind: "text", extra: true, colWidth: 18,
    aliases: ["cautionmoney receiptno", "caution receipt no", "caution money receipt"],
  },
  {
    key: "caution_money_receipt_date", source: "students", section: "enrolment", particular: 103,
    label: "Caution Money Receipt Date (DD/MM/YYYY)", exportLabel: "Caution Money Receipt Date",
    kind: "date", extra: true, colWidth: 24,
    aliases: ["cautionmoney receipt date", "caution receipt date"],
  },
  {
    key: "caution_money_amount", source: "students", section: "enrolment", particular: 104,
    label: "Caution Money Amount", kind: "number", extra: true, colWidth: 16,
    aliases: ["cautionmoney amount", "caution amount", "caution deposit"],
  },

  // ── Enrolment: previous-school marks (completes the group that stopped at
  //    board_percentage = the old ERP's "Pre.Percentage") ──
  {
    key: "previous_school_max_marks", source: "students", section: "enrolment", particular: 105,
    label: "Previous School Max Marks", kind: "number", extra: true, colWidth: 16,
    aliases: ["pre maximum marks", "previous maximum marks", "max marks", "total marks"],
  },
  {
    key: "previous_school_obtained_marks", source: "students", section: "enrolment", particular: 106,
    label: "Previous School Obtained Marks", kind: "number", extra: true, colWidth: 18,
    aliases: ["pre obtain marks", "previous obtained marks", "obtained marks", "marks obtained"],
  },
  {
    key: "previous_school_result", source: "students", section: "enrolment", particular: 107,
    label: "Previous School Result", kind: "text", extra: true, colWidth: 16,
    aliases: ["pre result", "previous result", "result of previous class"],
  },
];

// ── Derived collections ─────────────────────────────────────────────────────

/** Keys stored directly on the `students` table (API insert/update whitelist). */
export function studentsInsertKeys(): string[] {
  return STUDENT_TEMPLATE_FIELDS.filter((f) => f.source === "students").map((f) => f.key);
}

// Indexed once at module load. getTemplateField is called for every field on
// every render of the student form (~70 fields), so a linear scan over the
// ~100-entry registry turned each keystroke into thousands of string compares.
const TEMPLATE_FIELD_BY_KEY: ReadonlyMap<string, StudentTemplateField> = new Map(
  STUDENT_TEMPLATE_FIELDS.map((f) => [f.key, f])
);

export function getTemplateField(key: string): StudentTemplateField | undefined {
  return TEMPLATE_FIELD_BY_KEY.get(key);
}

/** Canonical bulk-sheet headers, in registry (sheet) order. Required columns
 *  carry a "*" suffix — normalizeToken strips it, so headers still match on
 *  re-upload. */
export function bulkTemplateHeaders(): string[] {
  return STUDENT_TEMPLATE_FIELDS.map((f) => (f.required ? `${f.label} *` : f.label));
}

export function bulkTemplateColWidths(): { wch: number }[] {
  return STUDENT_TEMPLATE_FIELDS.map((f) => ({ wch: f.colWidth ?? 14 }));
}

// ── Normalizers (shared by client preview and server import) ────────────────

/** Lowercase, drop parenthesised hints ("(Y/N)", "(DD/MM/YYYY)"), strip
 *  punctuation, collapse whitespace. Used for headers, aliases and enum input. */
export function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeYesNo(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  if (raw === null || raw === undefined) return undefined;
  const v = normalizeToken(String(raw));
  if (["y", "yes", "true", "1"].includes(v)) return true;
  if (["n", "no", "false", "0"].includes(v)) return false;
  return undefined;
}

/**
 * Match a raw cell/form value against a field's enum set (value, label or
 * alias, all in normalized form). Returns the stored value, or undefined when
 * unrecognized — unless the field is `lenientEnum`, where the raw text is
 * kept (legacy free-text columns like Social Category).
 */
export function normalizeEnum(field: StudentTemplateField, raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Exact value/label match first (case/whitespace-insensitive): token
  // normalization strips +/-, so blood groups "A+" and "A-" would otherwise
  // both collapse to "a" and resolve to whichever comes first.
  const compact = trimmed.toLowerCase().replace(/\s+/g, "");
  for (const ev of field.enumValues ?? []) {
    if (
      compact === ev.value.toLowerCase().replace(/\s+/g, "") ||
      compact === ev.label.toLowerCase().replace(/\s+/g, "")
    ) {
      return ev.value;
    }
  }
  const v = normalizeToken(trimmed);
  for (const ev of field.enumValues ?? []) {
    if (v === normalizeToken(ev.value) || v === normalizeToken(ev.label)) return ev.value;
    if ((ev.aliases ?? []).some((a) => v === normalizeToken(a))) return ev.value;
  }
  return field.lenientEnum ? trimmed : undefined;
}

/** Excel stores dates as day serials from 1899-12-30. */
export function excelSerialToDate(serial: number): string {
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.round(serial) * 86400000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD or an Excel serial → YYYY-MM-DD. */
export function normalizeDateString(value: string): string {
  if (!value) return "";
  const num = Number(value);
  if (!isNaN(num) && num > 1000 && num < 100000) {
    return excelSerialToDate(num);
  }
  const parts = value.split(/[/\-.]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (a.length <= 2 && c.length === 4) {
      return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
    }
    if (a.length === 4) {
      return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`;
    }
  }
  return value;
}

/** Undo Excel's number mangling of phone-like cells ("9.87654e9",
 *  "9.88E+09", "98765.0"). Scientific notation is *reconstructed* to its full
 *  integer form rather than truncated — stripping the exponent would corrupt
 *  the very numbers this exists to fix. */
export function normalizePhone(value: string): string {
  if (!value) return "";
  const trimmed = value.trim();
  // Scientific notation ("9.88E+09", "9.87654e9"): expand to the full integer.
  if (/^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num.toFixed(0);
  }
  return trimmed.replace(/\.0+$/, "");
}

/** "2,50,000", "142 cm", "68.5 kg", "76%" → number (or undefined). */
export function normalizeNumber(value: string): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/,/g, "").replace(/[^0-9.\-]/g, "");
  if (!cleaned) return undefined;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : undefined;
}

export function toTitleCase(value: string): string {
  if (!value) return "";
  return value.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

// ── Header → field mapping ──────────────────────────────────────────────────

export interface HeaderMapResult {
  /** column index → field key */
  mapping: Record<number, string>;
  /** headers that matched no field (surfaced to the user) */
  unrecognized: string[];
  /** headers ignored because their field was already claimed by an earlier column */
  duplicates: string[];
}

/**
 * Map sheet headers to registry fields. Pass 1 matches exactly (normalized
 * label, key or alias). Pass 2 falls back to substring containment, trying
 * the LONGEST aliases across all fields first so "mothers mobile no" can
 * never be captured by a shorter alias like "mobile" (phone), and
 * "social category" always beats "category". Each field is claimable once.
 */
export function mapTemplateHeaders(headers: string[]): HeaderMapResult {
  const mapping: Record<number, string> = {};
  const claimed = new Set<string>();
  const unrecognized: string[] = [];
  const duplicates: string[] = [];

  // (alias, key) pairs: canonical label + key + declared aliases.
  const pairs: { alias: string; key: string }[] = [];
  for (const f of STUDENT_TEMPLATE_FIELDS) {
    pairs.push({ alias: normalizeToken(f.label), key: f.key });
    pairs.push({ alias: normalizeToken(f.key.replace(/_/g, " ")), key: f.key });
    for (const a of f.aliases ?? []) pairs.push({ alias: normalizeToken(a), key: f.key });
  }
  const byLengthDesc = [...pairs].sort((a, b) => b.alias.length - a.alias.length);

  const normalized = headers.map((h) => normalizeToken(h));

  // Pass 1 — exact matches.
  normalized.forEach((header, index) => {
    if (!header) return;
    const hit = pairs.find((p) => p.alias === header);
    if (!hit) return;
    if (claimed.has(hit.key)) {
      duplicates.push(headers[index]);
      return;
    }
    mapping[index] = hit.key;
    claimed.add(hit.key);
  });

  // Pass 2 — substring fallback, longest alias first, claim-once.
  normalized.forEach((header, index) => {
    if (!header || mapping[index] !== undefined || duplicates.includes(headers[index])) return;
    // Short aliases are too promiscuous for containment matching.
    const hit = byLengthDesc.find(
      (p) => p.alias.length >= 4 && !claimed.has(p.key) && header.includes(p.alias)
    );
    if (hit) {
      mapping[index] = hit.key;
      claimed.add(hit.key);
    } else {
      unrecognized.push(headers[index]);
    }
  });

  return { mapping, unrecognized, duplicates };
}

// ── Display formatting (export, detail view, CSV) ───────────────────────────

export function formatDateDDMMYYYY(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Format a stored value for humans: booleans → YES/NO, enums → label,
 *  dates → DD/MM/YYYY. Unknown/empty → "". */
export function formatFieldValue(field: StudentTemplateField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  switch (field.kind) {
    case "boolean":
      return value === true || value === "true" ? "YES" : value === false || value === "false" ? "NO" : "";
    case "date":
      return formatDateDDMMYYYY(String(value));
    case "enum": {
      const hit = (field.enumValues ?? []).find((ev) => ev.value === value);
      return hit ? hit.label : String(value);
    }
    default:
      return String(value);
  }
}

/** "Indian National?" is derived from the free-text nationality column. */
export function indianNationalFromNationality(nationality: string | null | undefined): boolean | undefined {
  if (!nationality || !nationality.trim()) return undefined;
  return normalizeToken(nationality) === "indian";
}

/**
 * Build a `students`-table record from validated form/row data.
 *
 * `keys` controls column projection: only the listed student columns are
 * written (bulk upload passes exactly the columns present in the uploaded
 * sheet so absent columns stay untouched on re-upload; the single-student
 * form passes every column). For an included key, absent/blank input becomes
 * NULL — a blank cell in a provided column intentionally clears the value.
 * The virtual `indian_national` boolean is translated to the `nationality`
 * text column. Pass `existing` (the current DB row) on edits so a NO answer
 * preserves an already-stored specific non-Indian nationality (e.g. "American")
 * instead of destroying it — see the indian_national branch below.
 */
export function buildStudentRecord(
  data: Record<string, unknown>,
  keys: string[],
  existing?: Record<string, unknown>
): Record<string, unknown> {
  const studentKeys = new Set(studentsInsertKeys());
  const record: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === "indian_national") {
      const v = normalizeYesNo(data[key]);
      if (v === true) {
        record.nationality = "Indian";
      } else if (v === false) {
        // NO must not clobber a stored specific nationality. If the current
        // value is already a non-Indian string (e.g. "American"), keep it;
        // otherwise store the explicit "Non-Indian" marker so the NO answer
        // round-trips (a null would read back as blank, losing the answer).
        const prior = existing?.nationality;
        record.nationality =
          typeof prior === "string" &&
          prior.trim() !== "" &&
          normalizeToken(prior) !== "indian"
            ? prior
            : "Non-Indian";
      }
      // unknown/blank → leave nationality untouched
      continue;
    }
    if (!studentKeys.has(key)) continue;
    const v = data[key];
    if (v === undefined || v === null) {
      record[key] = null;
    } else if (typeof v === "string") {
      const t = v.trim();
      record[key] = t === "" ? null : t;
    } else {
      record[key] = v;
    }
  }
  return record;
}
