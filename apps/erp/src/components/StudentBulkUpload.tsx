"use client";

import { useState, useCallback, useEffect, Fragment } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
// xlsx parses to roughly 900KB. Nothing on this screen needs it until
// someone picks a file or asks for the template, so it is fetched then
// rather than shipped with the page that renders the button.
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Badge } from "@nkps/shared/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  Download,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  X,
  Pencil,
  Sparkles,
  Loader2,
} from "lucide-react";
import { formatClassName } from "@nkps/shared/lib/utils";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import {
  describeColumns,
  type MappingSuggestion,
} from "@nkps/shared/lib/import-mapping";
import {
  STUDENT_TEMPLATE_FIELDS,
  type StudentTemplateField,
  bulkTemplateHeaders,
  bulkTemplateColWidths,
  formatDateDDMMYYYY,
  mapTemplateHeaders,
  normalizeDateString,
  normalizeEnum,
  normalizeNumber,
  normalizePhone,
  normalizeToken,
  normalizeYesNo,
  toTitleCase,
} from "@nkps/shared/lib/student-template";
import { NativeSelect } from "@nkps/shared/components/ui/native-select";

// All cell values are kept as display strings in the preview (booleans as
// "YES"/"NO", enums as their stored value) — the server's zod preprocessing
// coerces them on submit.
interface ParsedRow {
  data: Record<string, string>;
  errors: string[];
  warnings: string[];
}

interface UploadError {
  admission_no: string;
  full_name?: string;
  class_name?: string;
  section?: string;
  error: string;
}

interface UploadWarning {
  admission_no: string;
  full_name?: string;
  warning: string;
}

interface UploadResult {
  success: boolean;
  inserted: number;
  created: number;
  updated: number;
  classesCreated: number;
  errors: UploadError[];
  warnings: UploadWarning[];
  total: number;
}

interface StudentBulkUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const CHUNK_SIZE = 500; // rows per request — keeps a 60+ column payload well under the request-body limit

// Numeric-looking text columns that Excel mangles into scientific notation /
// trailing ".0" — cleaned with normalizePhone on import.
const DIGIT_TEXT_KEYS = new Set([
  "phone",
  "mother_mobile",
  "father_mobile",
  "guardian_mobile",
  "aadhar_number",
  "jan_aadhar_number",
  "present_pincode",
  "permanent_pincode",
  "board_roll_number",
  "previous_school_udise_code",
]);

const fieldByKey = new Map(STUDENT_TEMPLATE_FIELDS.map((f) => [f.key, f]));

/** Normalize one raw cell per its registry field. Returns the display value
 *  plus an optional row warning when a non-blank value wasn't recognized. */
function normalizeCell(
  field: StudentTemplateField,
  raw: string
): { value: string; warning?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: "" };
  switch (field.kind) {
    case "name":
      return { value: toTitleCase(trimmed) };
    case "date": {
      const normalized = normalizeDateString(trimmed);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        return { value: "", warning: `${field.label}: "${trimmed}" is not a valid date — left blank` };
      }
      // Date of birth must be a real past date (server rejects future / pre-1900
      // DOBs, which would fail the whole upload batch with a cryptic error). A
      // future DOB is almost always a wrong-year typo, so blank it and warn —
      // consistent with how other unrecognized values are handled above.
      if (field.key === "date_of_birth") {
        const t = Date.parse(`${normalized}T00:00:00Z`);
        const year = Number(normalized.slice(0, 4));
        if (year < 1900 || t > Date.now()) {
          return { value: "", warning: `${field.label}: "${trimmed}" is not a valid past date — left blank` };
        }
      }
      // Day/month ambiguity: when the day is ≤ 12 the date reads validly both as
      // DD/MM and MM/DD (e.g. 04/12 vs 12/04). Excel stores dates by locale, so a
      // sheet authored in US M/D format can silently swap these. Keep the value
      // but flag the at-risk row so the admin can verify against the real date.
      const [yy, mm, dd] = normalized.split("-");
      if (Number(dd) <= 12 && dd !== mm) {
        return {
          value: normalized,
          warning: `${field.label}: imported as ${dd}/${mm}/${yy} (DD/MM). If the sheet used MM/DD it should be ${mm}/${dd}/${yy} — please verify.`,
        };
      }
      return { value: normalized };
    }
    case "boolean": {
      const v = normalizeYesNo(trimmed);
      if (v === undefined) {
        return { value: "", warning: `${field.label}: "${trimmed}" is not YES/NO — left blank` };
      }
      return { value: v ? "YES" : "NO" };
    }
    case "enum": {
      const v = normalizeEnum(field, trimmed);
      if (v === undefined) {
        return { value: "", warning: `${field.label}: "${trimmed}" not recognised — left blank` };
      }
      return { value: v };
    }
    case "number": {
      const num = normalizeNumber(trimmed);
      if (num === undefined) {
        return { value: "", warning: `${field.label}: "${trimmed}" is not a number — left blank` };
      }
      return { value: String(num) };
    }
    case "integer": {
      const num = parseInt(trimmed, 10);
      return { value: isNaN(num) ? "" : String(num) };
    }
    default: {
      let value = trimmed;
      if (DIGIT_TEXT_KEYS.has(field.key)) value = normalizePhone(value);
      if (field.key === "email") value = value.toLowerCase();
      return { value };
    }
  }
}

/** Human-friendly value for the expanded preview row: enum tokens show their
 *  label ("english" → "English"), ISO dates show as DD/MM/YYYY. */
function previewDisplayValue(field: StudentTemplateField, raw: string): string {
  if (!raw) return "";
  if (field.kind === "enum") {
    const hit = (field.enumValues ?? []).find((ev) => ev.value === raw);
    return hit ? hit.label : raw;
  }
  if (field.kind === "date") return formatDateDDMMYYYY(raw);
  return raw;
}

function validateRow(data: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!data.admission_no || data.admission_no.trim() === "") {
    errors.push("Admission number is required");
  }
  if (!data.full_name || data.full_name.trim().length < 2) {
    errors.push("Name is required (min 2 chars)");
  }
  if (!data.class_name || data.class_name.trim() === "") {
    errors.push("Class is required");
  }
  return errors;
}

function splitSubjects(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Turn the raw sheet into preview rows under a given column mapping.
 *
 * Lifted out of the file handler so a mapping the operator accepted after the
 * fact can be applied without re-reading the file — which also means the file
 * is parsed exactly once, and a remap is instant.
 */
function buildParsedRows(
  mapping: Record<number, string>,
  rawRows: string[][]
): ParsedRow[] {
  const parsed: ParsedRow[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every((cell) => !cell || String(cell).trim() === "")) continue;

    const rowData: Record<string, string> = {};
    const warnings: string[] = [];
    for (const [colIndex, key] of Object.entries(mapping)) {
      const field = fieldByKey.get(key);
      if (!field) continue;
      const cellValue = String(row[Number(colIndex)] ?? "");
      const { value, warning } = normalizeCell(field, cellValue);
      rowData[key] = value;
      if (warning) warnings.push(warning);
    }

    parsed.push({ data: rowData, warnings, errors: validateRow(rowData) });
  }

  return parsed;
}

export function StudentBulkUpload({
  open,
  onOpenChange,
  onSuccess,
}: StudentBulkUploadProps) {
  const [step, setStep] = useState<"upload" | "preview" | "results">("upload");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [mappedKeys, setMappedKeys] = useState<string[]>([]);
  const [unrecognizedHeaders, setUnrecognizedHeaders] = useState<string[]>([]);
  // Kept so a mapping accepted later can be applied without re-reading the file.
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<number, string>>({});
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<MappingSuggestion[] | null>(null);
  const [aiAccepted, setAiAccepted] = useState<Set<number>>(new Set());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [existingClassKeys, setExistingClassKeys] = useState<Set<string>>(new Set());
  // lowercased class label → subjects available in that class (normalized
  // match tokens + display names for the warning message)
  const [classSubjects, setClassSubjects] = useState<
    Map<string, { tokens: Set<string>; names: string[] }>
  >(new Map());
  // Target session. Empty = the current year, i.e. today's behaviour.
  // Choosing a past year switches the import into backfill mode.
  const [academicYears, setAcademicYears] = useState<
    { id: string; name: string; is_current: boolean }[]
  >([]);
  const [targetYearId, setTargetYearId] = useState("");
  const [backfillStatus, setBackfillStatus] = useState("passed");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  // Fetch existing classes (+ their subjects, for Subjects column preview
  // matching) when entering preview.
  // Sessions for the target-year picker. Fetched once, on the upload step.
  useEffect(() => {
    if (step !== "upload") return;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("academic_years")
        .select("id, name, is_current")
        .order("start_date", { ascending: false });
      setAcademicYears(data ?? []);
    })();
  }, [step]);

  // Backfill mode is derived, never stored: it is simply "a session other
  // than the live one was chosen".
  const isBackfill = Boolean(
    targetYearId && !academicYears.find((y) => y.id === targetYearId)?.is_current
  );

  useEffect(() => {
    if (step !== "preview") return;
    const supabase = createClient();
    (async () => {
      const { data: classes } = await supabase
        .from("classes")
        .select("id, name, section, stream_id, streams:stream_id(name)");
      // Keys are lowercased so "XI - A (science)" in a sheet still matches
      // the DB's "XI - A (Science)".
      const keys = new Set<string>();
      const idToKey = new Map<string, string>();
      for (const c of classes || []) {
        const label = formatClassName({
          name: c.name as string,
          section: c.section as string,
          streams: c.streams as unknown as { name: string } | null,
        });
        keys.add(label.toLowerCase());
        idToKey.set(c.id as string, label.toLowerCase());
      }
      setExistingClassKeys(keys);

      const { data: cs } = await supabase
        .from("class_subjects")
        .select("class_id, subjects:subject_id(name, nickname)");
      const subjectMap = new Map<string, { tokens: Set<string>; names: string[] }>();
      for (const row of cs || []) {
        const key = idToKey.get(row.class_id as string);
        if (!key) continue;
        const subject = row.subjects as unknown as { name: string; nickname: string | null } | null;
        if (!subject) continue;
        if (!subjectMap.has(key)) subjectMap.set(key, { tokens: new Set(), names: [] });
        const entry = subjectMap.get(key)!;
        entry.tokens.add(normalizeToken(subject.name));
        if (subject.nickname) entry.tokens.add(normalizeToken(subject.nickname));
        entry.names.push(subject.name);
      }
      setClassSubjects(subjectMap);
    })();
  }, [step]);

  const resetState = () => {
    setStep("upload");
    setParsedRows([]);
    setFileName("");
    setMappedKeys([]);
    setUnrecognizedHeaders([]);
    setEditingIndex(null);
    setExpandedIndex(null);
    setExistingClassKeys(new Set());
    setClassSubjects(new Map());
    setUploading(false);
    setUploadProgress(null);
    setUploadResult(null);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) resetState();
    onOpenChange(isOpen);
  };

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setFileName(file.name);

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const XLSX = await import("xlsx");
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
            header: 1,
            defval: "",
          });

          if (rawRows.length < 2) {
            toast.error("File must have a header row and at least one data row");
            return;
          }

          const headers = rawRows[0].map(String);
          const { mapping, unrecognized } = mapTemplateHeaders(headers);
          const keys = Object.values(mapping);

          if (!keys.includes("admission_no")) {
            toast.error('Could not find "Admission No" column. Please check the headers.');
            return;
          }
          if (!keys.includes("full_name")) {
            toast.error('Could not find "Name" column. Please check the headers.');
            return;
          }

          const rows = rawRows.map((r) => (r ?? []).map((c) => String(c ?? "")));
          const parsed = buildParsedRows(mapping, rows);

          if (parsed.length === 0) {
            toast.error("No data rows found in the file");
            return;
          }

          setRawHeaders(headers);
          setRawRows(rows);
          setColumnMapping(mapping);
          setAiSuggestions(null);
          setAiAccepted(new Set());
          setMappedKeys(keys);
          setUnrecognizedHeaders(unrecognized);
          setParsedRows(parsed);
          setStep("preview");
          toast.success(`Parsed ${parsed.length} rows from ${file.name}`);
        } catch {
          toast.error("Failed to parse file. Please ensure it is a valid Excel or CSV file.");
        }
      };
      reader.readAsArrayBuffer(file);
      e.target.value = "";
    },
    []
  );

  const validRows = parsedRows.filter((r) => r.errors.length === 0);
  const invalidRows = parsedRows.filter((r) => r.errors.length > 0);

  const classLabel = (r: ParsedRow) => {
    const name = (r.data.class_name || "").trim();
    if (!name) return "";
    const sec = (r.data.section || "A").trim();
    const stream = (r.data.stream || "").trim();
    return stream ? `${name} - ${sec} (${stream})` : `${name} - ${sec}`;
  };

  // Compute unique class+section+stream combos from parsed data for preview
  const allFileClasses = Array.from(
    new Set(parsedRows.map(classLabel).filter(Boolean))
  ).sort();

  const missingClasses = allFileClasses.filter(
    (cls) => !existingClassKeys.has(cls.toLowerCase())
  );
  const existingClasses = allFileClasses.filter((cls) =>
    existingClassKeys.has(cls.toLowerCase())
  );

  /** Subject-matching warnings, computed live (class subjects load async). */
  const subjectWarnings = (r: ParsedRow): string[] => {
    const raw = r.data.subjects?.trim();
    if (!raw) return [];
    const label = classLabel(r);
    if (!label) return [];
    if (!existingClassKeys.has(label.toLowerCase())) {
      return [`Class ${label} is new — its subjects don't exist yet, so the Subjects column will be skipped for this row until class subjects are assigned.`];
    }
    const available = classSubjects.get(label.toLowerCase());
    const unmatched = splitSubjects(raw).filter(
      (t) => !available || !available.tokens.has(normalizeToken(t))
    );
    if (unmatched.length === 0) return [];
    if (!available || available.tokens.size === 0) {
      return [`Class ${label} has no subjects assigned yet (Academics → Classes → subjects) — the Subjects column will be skipped for this row.`];
    }
    const shown = available.names.slice(0, 8).join(", ");
    return [
      `Subject${unmatched.length === 1 ? "" : "s"} not assigned to ${label}: ${unmatched.join(", ")}. This class currently has: ${shown}${available.names.length > 8 ? ", …" : ""}. Only matched subjects will be linked.`,
    ];
  };

  const rowWarnings = (r: ParsedRow): string[] => [...r.warnings, ...subjectWarnings(r)];
  const totalWarnings = parsedRows.reduce((n, r) => n + rowWarnings(r).length, 0);

  const removeRow = (index: number) => {
    setParsedRows((prev) => prev.filter((_, i) => i !== index));
    // Rows are keyed by array index, so removing a row shifts every later
    // index down by one. Keep the active editing/expanded highlight on the
    // same row: clear it if it was the removed row, decrement it if it sat
    // below the removed one.
    setEditingIndex((cur) =>
      cur === null ? cur : cur === index ? null : cur > index ? cur - 1 : cur
    );
    setExpandedIndex((cur) =>
      cur === null ? cur : cur === index ? null : cur > index ? cur - 1 : cur
    );
  };

  const updateRow = (index: number, key: string, value: string) => {
    setParsedRows((prev) => {
      const updated = [...prev];
      const row = { ...updated[index], data: { ...updated[index].data, [key]: value } };
      row.errors = validateRow(row.data);
      updated[index] = row;
      return updated;
    });
  };

  /**
   * Ask the assistant to match the columns mapTemplateHeaders could not.
   *
   * Only the leftovers are sent, and only as SHAPES — "12 digits, all
   * distinct" rather than twelve real Aadhaar numbers. describeColumns does
   * that work; see its header for where the line is drawn and why.
   */
  const requestMapping = useCallback(async () => {
    const claimed = new Set(Object.values(columnMapping));
    const unmatchedIndexes = rawHeaders
      .map((_, i) => i)
      .filter((i) => columnMapping[i] === undefined);

    if (unmatchedIndexes.length === 0) return;

    const profiles = describeColumns(rawHeaders, rawRows.slice(1)).filter((c) =>
      unmatchedIndexes.includes(c.index)
    );
    const candidates = STUDENT_TEMPLATE_FIELDS.filter((f) => !claimed.has(f.key)).map(
      (f) => ({
        key: f.key,
        label: f.label,
        kind: f.enumValues?.length
          ? `one of: ${f.enumValues.map((e) => e.label).join(" | ")}`
          : f.kind,
      })
    );

    setAiBusy(true);
    try {
      const res = await adminFetch("/api/ai/import-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns: profiles, candidates }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't match those columns.");
        return;
      }
      const withHome = ((data.suggestions ?? []) as MappingSuggestion[]).filter(
        (x) => x.fieldKey
      );
      setAiSuggestions(withHome);
      // High-confidence matches start ticked — the operator is confirming,
      // not doing the work again. Anything less starts unticked, because a
      // plausible-but-wrong mapping waved through writes the wrong data into
      // every row of the file.
      setAiAccepted(
        new Set(withHome.filter((x) => x.confidence === "high").map((x) => x.index))
      );
      toast.success(
        withHome.length
          ? `Found a home for ${withHome.length} column${withHome.length === 1 ? "" : "s"}`
          : "No matches found for the leftover columns"
      );
    } catch {
      toast.error("Couldn't reach the assistant. Map the columns by hand.");
    } finally {
      setAiBusy(false);
    }
  }, [columnMapping, rawHeaders, rawRows]);

  /** Fold the ticked suggestions into the mapping and rebuild the preview. */
  const applyAcceptedMapping = useCallback(() => {
    const accepted = (aiSuggestions ?? []).filter(
      (x) => x.fieldKey && aiAccepted.has(x.index)
    );
    if (accepted.length === 0) return;

    const next = { ...columnMapping };
    for (const s of accepted) next[s.index] = s.fieldKey as string;

    const rebuilt = buildParsedRows(next, rawRows);
    setColumnMapping(next);
    setParsedRows(rebuilt);
    setMappedKeys(Object.values(next));
    setUnrecognizedHeaders(
      rawHeaders.filter((_, i) => next[i] === undefined && rawHeaders[i]?.trim())
    );
    setAiSuggestions(null);
    setAiAccepted(new Set());
    toast.success(
      `Added ${accepted.length} column${accepted.length === 1 ? "" : "s"} — check the preview below`
    );
  }, [aiSuggestions, aiAccepted, columnMapping, rawRows, rawHeaders]);

  const handleSubmit = async () => {
    if (validRows.length === 0) {
      toast.error("No valid rows to import");
      return;
    }

    setUploading(true);

    const toPayloadRow = (r: ParsedRow) => {
      const out: Record<string, unknown> = {};
      for (const key of mappedKeys) {
        const raw = r.data[key] ?? "";
        if (key === "roll_number") {
          const num = parseInt(raw, 10);
          if (!isNaN(num)) out.roll_number = num;
          continue;
        }
        out[key] = raw;
      }
      // Required keys are always present even if their column mapping was
      // edited away in preview.
      out.admission_no = r.data.admission_no;
      out.full_name = r.data.full_name;
      out.class_name = r.data.class_name;
      out.section = r.data.section || "A";
      if (r.data.stream !== undefined) out.stream = r.data.stream;
      return out;
    };

    // Submit in chunks so a 60-column × 5000-row sheet doesn't blow the
    // request-body limit. Chunks are idempotent (upsert by admission no), so
    // a mid-sequence failure can simply be re-uploaded.
    const aggregate: UploadResult = {
      success: true,
      inserted: 0,
      created: 0,
      updated: 0,
      classesCreated: 0,
      errors: [],
      warnings: [],
      total: validRows.length,
    };

    try {
      for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
        const chunk = validRows.slice(i, i + CHUNK_SIZE);
        if (validRows.length > CHUNK_SIZE) {
          setUploadProgress(
            `Uploading ${Math.min(i + CHUNK_SIZE, validRows.length)} of ${validRows.length}…`
          );
        }
        const res = await adminFetch("/api/students/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provided_keys: mappedKeys,
            students: chunk.map(toPayloadRow),
            ...(isBackfill
              ? {
                  academic_year_id: targetYearId,
                  enrollment_status: backfillStatus,
                }
              : {}),
          }),
        });
        const data = await res.json();

        if (!res.ok && !data?.errors) {
          toast.error(data.error || "Failed to import students");
          setUploading(false);
          setUploadProgress(null);
          return;
        }

        aggregate.inserted += data.inserted ?? 0;
        aggregate.created += data.created ?? 0;
        aggregate.updated += data.updated ?? 0;
        aggregate.classesCreated += data.classesCreated ?? 0;
        aggregate.errors.push(...(data.errors ?? []));
        aggregate.warnings.push(...(data.warnings ?? []));
      }

      aggregate.success = aggregate.inserted > 0 || aggregate.errors.length === 0;
      setUploadResult(aggregate);
      setStep("results");
      onSuccess();
    } catch {
      toast.error("Failed to import students");
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const headers = bulkTemplateHeaders();
    const sample = (values: Record<string, string>) =>
      STUDENT_TEMPLATE_FIELDS.map((f) => values[f.key] ?? "");

    const ws = XLSX.utils.aoa_to_sheet([
      headers,
      sample({
        admission_no: "1001",
        full_name: "Rahul Kumar",
        class_name: "X",
        section: "A",
        roll_number: "1",
        gender: "M",
        date_of_birth: "15/03/2012",
        aadhar_number: "123412341234",
        mother_name: "Sunita Devi",
        mother_occupation: "Homemaker",
        mother_mobile: "9876543210",
        father_name: "Rajesh Kumar",
        father_occupation: "Farmer",
        father_mobile: "9876543211",
        address: "123, Main Street",
        present_pincode: "302001",
        blood_group: "O+",
        mother_tongue: "Hindi",
        category: "General",
        minority_group: "NA",
        is_bpl: "NO",
        is_ews: "NO",
        is_cwsn: "NO",
        indian_national: "YES",
        height_cm: "142",
        weight_kg: "38",
        admission_date: "01/04/2024",
        is_rte: "NO",
        medium_of_instruction: "English",
        is_staff_ward: "NO",
        participates_ncc: "NO",
        participates_nss: "NO",
        participates_scouts: "YES",
        participates_competitions: "NO",
        distance_band: "1-3 KM",
        parent_highest_education: "Graduation",
      }),
      sample({
        admission_no: "1002",
        full_name: "Priya Sharma",
        class_name: "XI",
        section: "A",
        stream: "Science",
        roll_number: "2",
        gender: "F",
        date_of_birth: "22/07/2010",
        subjects: "Physics, Chemistry, Maths, English",
        father_name: "Anil Sharma",
        mother_name: "Meena Sharma",
        blood_group: "B+",
        medium_of_instruction: "English",
        previous_school: "Govt School Jaipur",
        previous_school_district: "Jaipur",
        previous_school_state: "Rajasthan",
        previous_class_studied: "X",
        previous_school_board: "RBSE",
        board_percentage: "82.4",
        distance_band: "3-5 KM",
      }),
      sample({
        admission_no: "1003",
        full_name: "Amit Singh",
        class_name: "XII",
        section: "B",
        stream: "Commerce",
        roll_number: "3",
        gender: "M",
        date_of_birth: "10/01/2009",
      }),
    ]);

    ws["!cols"] = bulkTemplateColWidths();

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    XLSX.writeFile(wb, "student_upload_template.xlsx");
  };

  // Fields to show inside the expanded row detail, in registry order.
  const detailFields = STUDENT_TEMPLATE_FIELDS.filter((f) => mappedKeys.includes(f.key));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-5xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
              <Upload className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <DialogTitle>
                {step === "upload" ? "Upload Student Data" : step === "preview" ? "Preview & Import" : "Import Results"}
              </DialogTitle>
              <p className="text-xs text-gray-500 mt-0.5">
                {step === "upload"
                  ? "Import students from Excel or CSV — supports the full General + Enrolment profile template"
                  : step === "preview"
                  ? "Review the data before importing"
                  : "Summary of the import operation"}
              </p>
            </div>
          </div>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-6">
            <div>
              <Label>Upload Excel or CSV File</Label>
              <div className="mt-2 border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-navy-400 transition-colors">
                <Upload className="h-10 w-10 mx-auto text-gray-400 mb-3" />
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                  Drop your file here or click to browse
                </p>
                <p className="text-xs text-gray-400 mb-4">
                  Supports .xlsx, .xls, and .csv files
                </p>
                <Input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="max-w-xs mx-auto"
                />
              </div>
            </div>

            {/* Target session. Defaults to the current year, which is exactly
                how this dialog behaved before backfill existed. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Import into session</Label>
                <NativeSelect
                  className="w-full"
                  value={targetYearId}
                  onChange={(e) => setTargetYearId(e.target.value)}
                >
                  <option value="">Current session</option>
                  {academicYears
                    .filter((y) => !y.is_current)
                    .map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.name} (past session)
                      </option>
                    ))}
                </NativeSelect>
              </div>
              {isBackfill && (
                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    Record these students as
                  </Label>
                  <NativeSelect
                    className="w-full"
                    value={backfillStatus}
                    onChange={(e) => setBackfillStatus(e.target.value)}
                  >
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                    <option value="exited">Exited</option>
                    <option value="terminated">Terminated</option>
                  </NativeSelect>
                </div>
              )}
            </div>

            {isBackfill && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 p-3">
                <p className="text-xs text-amber-800 dark:text-amber-300 font-medium mb-1">
                  Backfill mode
                </p>
                <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5 list-disc pl-4">
                  <li>
                    Students who already exist are <strong>left untouched</strong> —
                    an old sheet cannot overwrite current addresses or phone
                    numbers. Only the past-session enrollment is added.
                  </li>
                  <li>
                    Enrollments are recorded as{" "}
                    <strong>{backfillStatus}</strong>, never active, so this
                    cannot affect the live roster or current roll numbers.
                  </li>
                  <li>
                    Missing classes are created inside that past session, not
                    the current one. The Subjects column is ignored.
                  </li>
                </ul>
              </div>
            )}

            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 p-3">
              <p className="text-xs text-blue-700 dark:text-blue-400 font-medium mb-1">How it works</p>
              <ul className="text-xs text-blue-600 dark:text-blue-400 space-y-0.5 list-disc pl-4">
                <li>Only <strong>Admission No</strong>, <strong>Name</strong> and <strong>Class</strong> are required (marked with <strong>*</strong> in the template) — every other column is optional.</li>
                <li>Re-uploading a student (same admission no) <strong>updates</strong> them: columns present in your file overwrite (a blank cell clears the value), columns missing from the file stay untouched.</li>
                <li><strong>Section</strong> defaults to A. <strong>Stream</strong> applies to XI/XII (Science, Commerce, Humanities). Missing classes are auto-created.</li>
                <li><strong>Subjects</strong>: comma-separated names matched to the class&apos;s subjects (e.g. &quot;Physics, Chemistry, Maths&quot;). Unmatched names are reported as warnings.</li>
                <li>Yes/No columns accept YES/NO, Y/N or TRUE/FALSE. Dates are DD/MM/YYYY.</li>
              </ul>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={downloadTemplate}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Download Template
              </Button>
              <p className="text-xs text-gray-400">
                First row must be column headers
              </p>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  File: <span className="font-medium">{fileName}</span>
                </p>
                <Badge variant="secondary" className="bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {validRows.length} valid
                </Badge>
                {invalidRows.length > 0 && (
                  <Badge variant="secondary" className="bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    {invalidRows.length} errors
                  </Badge>
                )}
                {totalWarnings > 0 && (
                  <Badge variant="secondary" className="bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {totalWarnings} warnings
                  </Badge>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStep("upload");
                  setParsedRows([]);
                  setFileName("");
                  setEditingIndex(null);
                  setExpandedIndex(null);
                }}
              >
                Upload Different File
              </Button>
            </div>

            {/* Column mapping summary */}
            <div className="rounded-lg bg-gray-50 dark:bg-muted border border-gray-200 p-3">
              <p className="text-xs text-gray-700 dark:text-gray-300 font-medium mb-1">
                {mappedKeys.length} of {STUDENT_TEMPLATE_FIELDS.length} template columns present in this file
              </p>
              {unrecognizedHeaders.length > 0 && (
                <div className="mt-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Unrecognised columns (ignored):
                    </p>
                    {!aiSuggestions && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={aiBusy}
                        onClick={() => void requestMapping()}
                        className="h-7 text-xs"
                      >
                        {aiBusy ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                            Matching…
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3 w-3 mr-1.5" />
                            Match these with AI
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {unrecognizedHeaders.map((h) => (
                      <span
                        key={h}
                        className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/30 text-xs font-medium text-amber-700 dark:text-amber-400"
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {aiSuggestions && (
                <div className="mt-2.5 rounded-md border border-blue-200 bg-blue-50/60 p-2.5">
                  {aiSuggestions.length === 0 ? (
                    <p className="text-xs text-gray-600 dark:text-gray-300">
                      No home found for those columns — they stay ignored, which
                      is the right answer when a sheet carries data this template
                      does not hold.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs font-medium text-navy-900 dark:text-white mb-1.5">
                        Suggested matches — tick the ones that are right
                      </p>
                      <div className="space-y-1">
                        {aiSuggestions.map((sugg) => {
                          const field = fieldByKey.get(sugg.fieldKey as string);
                          const on = aiAccepted.has(sugg.index);
                          return (
                            <label
                              key={sugg.index}
                              className="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-white/70 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={(e) =>
                                  setAiAccepted((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(sugg.index);
                                    else next.delete(sugg.index);
                                    return next;
                                  })
                                }
                                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                              />
                              <span className="text-xs leading-relaxed">
                                <span className="font-medium text-gray-800 dark:text-gray-100">
                                  {rawHeaders[sugg.index] || `Column ${sugg.index + 1}`}
                                </span>
                                <span className="text-gray-400"> → </span>
                                <span className="font-medium text-navy-900 dark:text-white">
                                  {field?.label ?? sugg.fieldKey}
                                </span>
                                <span
                                  className={
                                    sugg.confidence === "high"
                                      ? "ml-1.5 text-green-700 dark:text-green-400"
                                      : sugg.confidence === "medium"
                                        ? "ml-1.5 text-amber-700"
                                        : "ml-1.5 text-gray-500"
                                  }
                                >
                                  ({sugg.confidence})
                                </span>
                                <span className="block text-gray-500">{sugg.why}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-2">
                        <p className="text-[11px] text-gray-500">
                          Only the column headers and a description of their
                          shape were sent — no student data left the school.
                        </p>
                        <div className="flex gap-1.5 shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setAiSuggestions(null);
                              setAiAccepted(new Set());
                            }}
                            className="h-7 text-xs"
                          >
                            Discard
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={aiAccepted.size === 0}
                            onClick={applyAcceptedMapping}
                            className="h-7 text-xs"
                          >
                            Add {aiAccepted.size} column
                            {aiAccepted.size === 1 ? "" : "s"}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
              <p className="text-[11px] text-gray-400 mt-1.5">
                Columns not in the file are left untouched for existing students. Blank cells in present columns clear the stored value.
              </p>
            </div>

            {missingClasses.length > 0 && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 p-3">
                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-1.5">
                  {missingClasses.length} new class{missingClasses.length === 1 ? "" : "es"} will be auto-created
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {missingClasses.map((cls) => (
                    <span
                      key={cls}
                      className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/30 text-xs font-medium text-amber-700 dark:text-amber-400"
                    >
                      {cls}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {existingClasses.length > 0 && (
              <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 p-3">
                <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-1.5">
                  {existingClasses.length} existing class{existingClasses.length === 1 ? "" : "es"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {existingClasses.map((cls) => (
                    <span
                      key={cls}
                      className="inline-flex items-center px-2 py-0.5 rounded-md bg-green-100 dark:bg-green-950/30 text-xs font-medium text-green-700 dark:text-green-400"
                    >
                      {cls}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="border rounded-xl overflow-hidden">
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Adm No</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>Sec</TableHead>
                      <TableHead>Stream</TableHead>
                      {mappedKeys.includes("subjects") && <TableHead>Subjects</TableHead>}
                      <TableHead>Status</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedRows.map((row, i) => {
                      const isEditing = editingIndex === i;
                      const isExpanded = expandedIndex === i;
                      const warnings = rowWarnings(row);
                      const subjectCount = row.data.subjects
                        ? splitSubjects(row.data.subjects).length
                        : 0;
                      const colCount = 9 + (mappedKeys.includes("subjects") ? 1 : 0);
                      return (
                        <Fragment key={i}>
                          <TableRow
                            className={row.errors.length > 0 ? "bg-red-50 dark:bg-red-950/30" : undefined}
                          >
                            <TableCell className="pr-0">
                              <button
                                onClick={() => setExpandedIndex(isExpanded ? null : i)}
                                className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                                title={isExpanded ? "Collapse" : "Show all fields"}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </TableCell>
                            <TableCell className="text-gray-400 text-xs">{i + 1}</TableCell>
                            <TableCell>
                              {isEditing ? (
                                <Input
                                  className="h-7 text-xs w-20"
                                  value={row.data.admission_no || ""}
                                  onChange={(e) => updateRow(i, "admission_no", e.target.value)}
                                />
                              ) : (
                                <span className="font-medium">{row.data.admission_no || "—"}</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <Input
                                  className="h-7 text-xs w-32"
                                  value={row.data.full_name || ""}
                                  onChange={(e) => updateRow(i, "full_name", e.target.value)}
                                />
                              ) : (
                                row.data.full_name || "—"
                              )}
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <Input
                                  className="h-7 text-xs w-16"
                                  value={row.data.class_name || ""}
                                  onChange={(e) => updateRow(i, "class_name", e.target.value)}
                                />
                              ) : (
                                row.data.class_name || "—"
                              )}
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <Input
                                  className="h-7 text-xs w-12"
                                  value={row.data.section || ""}
                                  onChange={(e) => updateRow(i, "section", e.target.value)}
                                />
                              ) : (
                                row.data.section || "—"
                              )}
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <Input
                                  className="h-7 text-xs w-20"
                                  value={row.data.stream || ""}
                                  onChange={(e) => updateRow(i, "stream", e.target.value)}
                                />
                              ) : (
                                <span className="text-gray-500">{row.data.stream || "—"}</span>
                              )}
                            </TableCell>
                            {mappedKeys.includes("subjects") && (
                              <TableCell>
                                {isEditing ? (
                                  <Input
                                    className="h-7 text-xs w-40"
                                    value={row.data.subjects || ""}
                                    onChange={(e) => updateRow(i, "subjects", e.target.value)}
                                  />
                                ) : subjectCount > 0 ? (
                                  <Badge variant="secondary" className="text-xs">
                                    {subjectCount} subject{subjectCount === 1 ? "" : "s"}
                                  </Badge>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </TableCell>
                            )}
                            <TableCell>
                              {row.errors.length > 0 ? (
                                <span
                                  className="text-xs text-red-600 dark:text-red-400"
                                  title={row.errors.join(", ")}
                                >
                                  {row.errors[0]}
                                </span>
                              ) : warnings.length > 0 ? (
                                <span
                                  className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                                  title={warnings.join("\n")}
                                >
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  {warnings.length}
                                </span>
                              ) : (
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-0.5">
                                <button
                                  onClick={() => setEditingIndex(isEditing ? null : i)}
                                  className={`p-1 rounded transition-colors ${isEditing ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30" : "text-gray-400 hover:text-blue-500"}`}
                                  title={isEditing ? "Done editing" : "Edit row"}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => removeRow(i)}
                                  className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                  title="Remove row"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow className="bg-gray-50/70 hover:bg-gray-50/70">
                              {/* TableCell defaults to whitespace-nowrap, which makes
                                  long values paint over neighbouring grid cells —
                                  force normal wrapping inside the detail panel. */}
                              <TableCell colSpan={colCount} className="py-3 whitespace-normal">
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2 px-2">
                                  {detailFields
                                    .filter((f) => (row.data[f.key] ?? "") !== "")
                                    .map((f) => (
                                      <div key={f.key} className="text-xs min-w-0">
                                        <p className="text-gray-400 truncate" title={f.label}>
                                          {f.label}
                                        </p>
                                        <p className="text-gray-700 dark:text-gray-300 break-words">
                                          {previewDisplayValue(f, row.data[f.key])}
                                        </p>
                                      </div>
                                    ))}
                                </div>
                                {warnings.length > 0 && (
                                  <div className="mt-2 px-2 space-y-0.5">
                                    {warnings.map((w, wi) => (
                                      <p key={wi} className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1 whitespace-normal break-words">
                                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                                        <span>{w}</span>
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={uploading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={validRows.length === 0 || uploading}
                className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
              >
                {uploading ? (
                  <>
                    <span className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {uploadProgress || "Uploading..."}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Import {validRows.length} Student{validRows.length === 1 ? "" : "s"}
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "results" && (
          <div className="space-y-4">
            {uploadResult && (
              <>
                {/* Summary stats */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 p-3 text-center">
                    <p className="text-2xl font-bold text-green-700 dark:text-green-400">{uploadResult.created}</p>
                    <p className="text-xs text-green-600 dark:text-green-400">Created</p>
                  </div>
                  <div className="rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 p-3 text-center">
                    <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{uploadResult.updated}</p>
                    <p className="text-xs text-blue-600 dark:text-blue-400">Updated</p>
                  </div>
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 p-3 text-center">
                    <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{uploadResult.classesCreated}</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400">Classes Created</p>
                  </div>
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 p-3 text-center">
                    <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{uploadResult.warnings.length}</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400">Warnings</p>
                  </div>
                  <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 p-3 text-center">
                    <p className="text-2xl font-bold text-red-700 dark:text-red-400">{uploadResult.errors.length}</p>
                    <p className="text-xs text-red-600 dark:text-red-400">Failed</p>
                  </div>
                </div>

                {uploadResult.errors.length === 0 ? (
                  <div className="rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 p-6 text-center">
                    <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-2" />
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">
                      All {uploadResult.inserted} students imported successfully!
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <p className="text-sm font-medium text-red-700 dark:text-red-400">
                        {uploadResult.errors.length} student{uploadResult.errors.length === 1 ? "" : "s"} failed to import
                      </p>
                    </div>
                    <div className="border rounded-xl overflow-hidden">
                      <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-8">#</TableHead>
                              <TableHead>Adm No</TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead>Class</TableHead>
                              <TableHead>Error</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {uploadResult.errors.map((err, i) => (
                              <TableRow key={i} className="bg-red-50/50">
                                <TableCell className="text-gray-400 text-xs">{i + 1}</TableCell>
                                <TableCell className="font-medium text-xs">{err.admission_no}</TableCell>
                                <TableCell className="text-xs">{err.full_name || "—"}</TableCell>
                                <TableCell className="text-xs">
                                  {err.class_name || "—"}{err.section ? `-${err.section}` : ""}
                                </TableCell>
                                <TableCell className="text-xs text-red-600 dark:text-red-400">{err.error}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500">
                      Fix the issues above and re-upload the failed students. Successfully imported students will not be duplicated.
                    </p>
                  </div>
                )}

                {uploadResult.warnings.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                        {uploadResult.warnings.length} warning{uploadResult.warnings.length === 1 ? "" : "s"} (students were still imported)
                      </p>
                    </div>
                    <div className="border border-amber-200 rounded-xl overflow-hidden">
                      <div className="max-h-[200px] overflow-y-auto divide-y divide-amber-100">
                        {uploadResult.warnings.map((w, i) => (
                          <div key={i} className="px-3 py-1.5 bg-amber-50/50">
                            <p className="text-xs text-amber-800 dark:text-amber-300">
                              <span className="font-medium">{w.admission_no}</span>
                              {w.full_name ? ` · ${w.full_name}` : ""} — {w.warning}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => handleClose(false)}>
                Close
              </Button>
              {uploadResult && uploadResult.errors.length > 0 && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    const XLSX = await import("xlsx");
                    // Download failed students as a sheet for easy re-upload
                    const failedData = uploadResult.errors.map((e) => ({
                      "Admission No": e.admission_no,
                      "Name": e.full_name || "",
                      "Class": e.class_name || "",
                      "Section": e.section || "",
                      "Error": e.error,
                    }));
                    const ws = XLSX.utils.json_to_sheet(failedData);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Failed Students");
                    XLSX.writeFile(wb, "failed_students.xlsx");
                  }}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download Failed List
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
