"use client";

// Add/Edit student form body, divided into the template's two sections —
// "General Profile" and "Enrolment Profile" — mirroring the school's UDISE+
// student template. Field labels/kinds/enum options come from the shared
// registry (lib/student-template.ts) so the form can't drift from the bulk
// template or the per-student export.

import { useEffect, useState } from "react";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatClassName } from "@nkps/shared/lib/utils";
import {
  getTemplateField,
  indianNationalFromNationality,
  studentsInsertKeys,
} from "@nkps/shared/lib/student-template";
import type { Stream } from "@nkps/shared/types";

export interface StudentFormClassOption {
  id: string;
  name: string;
  section: string;
  stream_id: string | null;
  stream_name: string | null;
}

export interface StudentFormState {
  class_id: string;
  stream_id: string;
  roll_number: string;
  roll_number_manual: boolean;
  /** Registry student-column keys (+ indian_national), all as display strings:
   *  booleans "YES"/"NO"/"", enums as stored values, numbers as strings. */
  fields: Record<string, string>;
}

const HIGHER_CLASSES = ["XI", "XII"];

/** Every student column the form edits (excludes enrollment-side keys). */
const FORM_KEYS = [...studentsInsertKeys(), "indian_national"];

export function emptyStudentForm(classId = ""): StudentFormState {
  const fields: Record<string, string> = {};
  for (const key of FORM_KEYS) fields[key] = "";
  return {
    class_id: classId,
    stream_id: "",
    roll_number: "",
    roll_number_manual: false,
    fields,
  };
}

export function studentToForm(
  studentRow: {
    class_id?: string | null;
    stream_id?: string | null;
    roll_number?: number | null;
    roll_number_manual?: boolean;
  },
  fallbackClassId = ""
): StudentFormState {
  const student = studentRow as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const key of FORM_KEYS) {
    if (key === "indian_national") {
      const derived = indianNationalFromNationality(
        (student.nationality as string | null) ?? null
      );
      fields[key] = derived === undefined ? "" : derived ? "YES" : "NO";
      continue;
    }
    const v = student[key];
    if (v === null || v === undefined) fields[key] = "";
    else if (typeof v === "boolean") fields[key] = v ? "YES" : "NO";
    else fields[key] = String(v);
  }
  return {
    class_id: studentRow.class_id || fallbackClassId,
    stream_id: studentRow.stream_id || "",
    roll_number: studentRow.roll_number?.toString() ?? "",
    roll_number_manual: studentRow.roll_number_manual ?? false,
    fields,
  };
}

/** Student-column payload for POST/PATCH /api/students — the zod schema's
 *  preprocessing coerces the display strings (YES/NO, numbers) server-side.
 *  Blank strings are sent as-is: the API turns them into NULL (clear). */
export function buildStudentPayload(form: StudentFormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of FORM_KEYS) payload[key] = form.fields[key] ?? "";
  return payload;
}

interface StudentFormFieldsProps {
  formData: StudentFormState;
  setFormData: React.Dispatch<React.SetStateAction<StudentFormState>>;
  classes: StudentFormClassOption[];
  streams: Stream[];
  /** Server-side validation errors, keyed by field key (zod fieldErrors).
   *  Highlighted inline under the offending inputs. */
  errors?: Record<string, string[]>;
}

export function StudentFormFields({
  formData,
  setFormData,
  classes,
  streams,
  errors,
}: StudentFormFieldsProps) {
  const [openSections, setOpenSections] = useState<{ general: boolean; enrolment: boolean }>({
    general: true,
    enrolment: true,
  });

  const updateField = (key: string, value: string) =>
    setFormData((prev) => ({ ...prev, fields: { ...prev.fields, [key]: value } }));
  const updateMeta = (
    key: "class_id" | "stream_id" | "roll_number",
    value: string
  ) => setFormData((prev) => ({ ...prev, [key]: value }));

  const selectedFormClass = classes.find((c) => c.id === formData.class_id);
  const isHigherClass = selectedFormClass
    ? HIGHER_CLASSES.includes(selectedFormClass.name)
    : false;
  // A class created as "XI Science-A" carries its own stream — the student's
  // stream is then determined by the class, not chosen separately.
  const classStreamId = selectedFormClass?.stream_id ?? null;

  // Keep stream consistent with the selected class even when the form was
  // populated externally (edit dialog): stream-bound class ⇒ its stream;
  // Nursery–X ⇒ no stream.
  useEffect(() => {
    if (classStreamId && formData.stream_id !== classStreamId) {
      setFormData((prev) => ({ ...prev, stream_id: classStreamId }));
    } else if (!isHigherClass && formData.stream_id) {
      setFormData((prev) => ({ ...prev, stream_id: "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classStreamId, isHigherClass, formData.stream_id]);

  const fieldError = (k: string): string | undefined => errors?.[k]?.[0];
  const errorRing = "border-red-500 focus-visible:ring-red-500";

  // Fields that only make sense when another field has a given value.
  const isFieldDisabled = (k: string): boolean => {
    if (k === "cwsn_impairment_type") return formData.fields.is_cwsn !== "YES";
    return false;
  };

  // ── Generic registry-driven field control (plain render fn, NOT a nested
  // component — a nested component would remount its Input on every render
  // and drop focus while typing) ──
  const renderField = (k: string) => {
    const field = getTemplateField(k);
    if (!field) return null;
    const required = field.required ?? false;
    const value = formData.fields[k] ?? "";
    const label = field.label + (required ? " *" : "");
    const error = fieldError(k);
    const disabled = isFieldDisabled(k);
    const errorEl = error ? (
      <p className="text-[11px] text-red-600 mt-1">{error}</p>
    ) : null;

    if (field.kind === "boolean") {
      return (
        <div>
          <Label className="text-xs font-medium">{label}</Label>
          <Select
            value={value || "none"}
            onValueChange={(val) => {
              const next = !val || val === "none" ? "" : val;
              setFormData((prev) => ({
                ...prev,
                fields: {
                  ...prev.fields,
                  [k]: next,
                  // CWSN off ⇒ impairment type no longer applies
                  ...(k === "is_cwsn" && next !== "YES"
                    ? { cwsn_impairment_type: "" }
                    : {}),
                },
              }));
            }}
          >
            <SelectTrigger className={`w-full mt-1 h-9 ${error ? errorRing : ""}`}>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" label="—">—</SelectItem>
              <SelectItem value="YES" label="Yes">Yes</SelectItem>
              <SelectItem value="NO" label="No">No</SelectItem>
            </SelectContent>
          </Select>
          {errorEl}
        </div>
      );
    }

    if (field.kind === "enum" && field.enumValues) {
      const options = [...field.enumValues];
      // Lenient enums (Social Category) may hold a legacy free-text value —
      // keep it selectable instead of silently discarding it.
      if (value && !options.some((o) => o.value === value)) {
        options.push({ value, label: value });
      }
      return (
        <div>
          <Label className="text-xs font-medium">{label}</Label>
          <Select
            value={value || "none"}
            onValueChange={(val) => updateField(k, !val || val === "none" ? "" : val)}
          >
            <SelectTrigger className={`w-full mt-1 h-9 ${error ? errorRing : ""}`}>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" label="—">—</SelectItem>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value} label={o.label}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errorEl}
        </div>
      );
    }

    return (
      <div>
        <Label htmlFor={k} className="text-xs font-medium">{label}</Label>
        <Input
          id={k}
          className={`h-9 mt-1 ${error ? errorRing : ""}`}
          type={field.kind === "date" ? "date" : field.kind === "number" || field.kind === "integer" ? "number" : "text"}
          step={field.kind === "number" ? "any" : undefined}
          value={value}
          onChange={(e) => updateField(k, e.target.value)}
          required={required}
          disabled={disabled}
          placeholder={disabled ? "—" : undefined}
        />
        {errorEl}
      </div>
    );
  };

  const renderSectionHeader = (
    id: "general" | "enrolment",
    title: string,
    subtitle: string
  ) => (
    <button
      type="button"
      onClick={() => setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }))}
      className="w-full flex items-center gap-2 rounded-lg bg-navy-900/5 dark:bg-navy-900/30 px-3 py-2 text-left"
    >
      {openSections[id] ? (
        <ChevronDown className="h-4 w-4 text-navy-900 dark:text-gold-400" />
      ) : (
        <ChevronRight className="h-4 w-4 text-navy-900 dark:text-gold-400" />
      )}
      <div>
        <p className="text-sm font-semibold text-navy-900 dark:text-gray-100">{title}</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>
    </button>
  );

  const renderSubGroup = (title: string, children: React.ReactNode) => (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
      <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2 uppercase tracking-wide">
        {title}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{children}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ── General Profile ─────────────────────────────────────────── */}
      {renderSectionHeader(
        "general",
        "General Profile",
        "Identity, family, address, demographics and health"
      )}
      {openSections.general && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {renderField("full_name")}
            {renderField("gender")}
            {renderField("date_of_birth")}
            {renderField("aadhar_number")}
            {renderField("name_as_per_aadhar")}
            {renderField("jan_aadhar_number")}
          </div>

          {renderSubGroup("Mother's Details", (
            <>
            {renderField("mother_name")}
            {renderField("mother_occupation")}
            {renderField("mother_qualification")}
            {renderField("mother_mobile")}
            {renderField("mother_annual_income")}
            </>
          ))}

          {renderSubGroup("Father's Details", (
            <>
            {renderField("father_name")}
            {renderField("father_occupation")}
            {renderField("father_qualification")}
            {renderField("father_mobile")}
            {renderField("father_annual_income")}
            </>
          ))}

          {renderSubGroup("Guardian", (
            <>
            {renderField("guardian_name")}
            {renderField("guardian_relation")}
            {renderField("guardian_mobile")}
            </>
          ))}

          {renderSubGroup("Address", (
            <>
            <div className="col-span-2">
              {renderField("address")}
            </div>
            {renderField("present_pincode")}
            <div className="col-span-2">
              {renderField("permanent_address")}
            </div>
            {renderField("permanent_pincode")}
            </>
          ))}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {renderField("blood_group")}
            {renderField("mother_tongue")}
            {renderField("category")}
            {renderField("minority_group")}
            {renderField("religion")}
            {renderField("indian_national")}
            {renderField("is_bpl")}
            {renderField("is_ews")}
            {renderField("is_cwsn")}
            {renderField("cwsn_impairment_type")}
            {renderField("height_cm")}
            {renderField("weight_kg")}
            {renderField("phone")}
            {renderField("email")}
          </div>
        </div>
      )}

      {/* ── Enrolment Profile ───────────────────────────────────────── */}
      {renderSectionHeader(
        "enrolment",
        "Enrolment Profile",
        "Admission, class, previous school and participation"
      )}
      {openSections.enrolment && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {renderField("admission_no")}
            {renderField("admission_date")}
            <div>
              <Label className="text-xs font-medium">Class *</Label>
              <Select
                value={formData.class_id}
                items={classes.map((c) => ({ value: c.id, label: formatClassName(c) }))}
                onValueChange={(val) => {
                  if (val) {
                    const cls = classes.find((c) => c.id === val);
                    // Stream follows the class: a stream-bound class (e.g.
                    // "XI Science-A") auto-fills it; any other class clears
                    // it so a stale stream can't stick to a Nursery–X child.
                    setFormData((prev) => ({
                      ...prev,
                      class_id: val,
                      stream_id: cls?.stream_id ?? "",
                    }));
                  }
                }}
              >
                <SelectTrigger className={`w-full mt-1 h-9 ${fieldError("class_id") ? errorRing : ""}`}>
                  <SelectValue placeholder="Select class..." />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id} label={formatClassName(c)}>
                      {formatClassName(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium">Stream</Label>
              <Select
                value={formData.stream_id || "none"}
                disabled={!isHigherClass || Boolean(classStreamId)}
                items={[
                  { value: "none", label: "No stream" },
                  ...streams.map((s) => ({
                    value: s.id,
                    label: s.name + (s.code ? ` (${s.code})` : ""),
                  })),
                ]}
                onValueChange={(val) =>
                  updateMeta("stream_id", !val || val === "none" ? "" : val)
                }
              >
                <SelectTrigger className="w-full mt-1 h-9 disabled:opacity-50">
                  <SelectValue placeholder="Select stream..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" label="No stream">No stream</SelectItem>
                  {streams.map((s) => (
                    <SelectItem key={s.id} value={s.id} label={s.name}>
                      {s.name}
                      {s.code ? ` (${s.code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                {classStreamId
                  ? "Set automatically from the selected class"
                  : isHigherClass
                    ? "Choose the stream for XI/XII"
                    : "Streams apply to XI/XII only"}
              </p>
            </div>
            <div>
              <Label htmlFor="roll_number" className="text-xs font-medium">Roll Number</Label>
              <Input
                id="roll_number"
                className="h-9 mt-1"
                type="number"
                value={formData.roll_number}
                onChange={(e) => updateMeta("roll_number", e.target.value)}
                placeholder="Roll number"
                disabled={!formData.roll_number_manual}
              />
              <div className="mt-2 flex items-start gap-2">
                <Checkbox
                  id="roll_number_manual"
                  checked={formData.roll_number_manual}
                  onCheckedChange={(val) =>
                    setFormData((prev) => ({ ...prev, roll_number_manual: val === true }))
                  }
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <Label
                    htmlFor="roll_number_manual"
                    className="text-xs font-medium cursor-pointer"
                  >
                    Manual override
                  </Label>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
                    {formData.roll_number_manual
                      ? "Manual — will not be changed by auto-recompute"
                      : "Auto-assigned alphabetically (default)"}
                  </p>
                </div>
              </div>
            </div>
            {renderField("is_rte")}
            {renderField("medium_of_instruction")}
            {renderField("is_staff_ward")}
          </div>

          {renderSubGroup("Previous School", (
            <>
            {renderField("previous_school")}
            {renderField("previous_school_address")}
            {renderField("previous_school_block")}
            {renderField("previous_school_district")}
            {renderField("previous_school_state")}
            {renderField("previous_school_udise_code")}
            {renderField("previous_school_reason_for_leaving")}
            {renderField("previous_class_studied")}
            {renderField("previous_school_board")}
            {renderField("board_roll_number")}
            {renderField("board_percentage")}
            {renderField("last_session_attendance")}
            </>
          ))}

          {renderSubGroup("Participation", (
            <>
            {renderField("participates_ncc")}
            {renderField("participates_nss")}
            {renderField("participates_scouts")}
            {renderField("participates_competitions")}
            </>
          ))}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {renderField("distance_band")}
            {renderField("parent_highest_education")}
          </div>

          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Subjects are managed via class subjects and electives, or the Subjects column of the bulk upload.
          </p>
        </div>
      )}
    </div>
  );
}
