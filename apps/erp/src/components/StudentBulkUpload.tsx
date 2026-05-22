"use client";

import { useState, useCallback, useEffect } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import * as XLSX from "xlsx";
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
  CheckCircle2,
  X,
  Pencil,
} from "lucide-react";
import { formatClassName } from "@nkps/shared/lib/utils";

interface ParsedRow {
  admission_no: string;
  full_name: string;
  class_name: string;
  section: string;
  stream: string;
  father_name: string;
  mother_name: string;
  date_of_birth: string;
  gender: string;
  phone: string;
  address: string;
  roll_number: number | undefined;
  email: string;
  blood_group: string;
  category: string;
  aadhar_number: string;
  previous_school: string;
  errors: string[];
}

interface UploadError {
  admission_no: string;
  full_name?: string;
  class_name?: string;
  section?: string;
  error: string;
}

interface UploadResult {
  success: boolean;
  inserted: number;
  updated: number;
  usersCreated: number;
  classesCreated: number;
  errors: UploadError[];
  total: number;
}

interface StudentBulkUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// Flexible column name mapping
const COLUMN_ALIASES: Record<string, string[]> = {
  admission_no: [
    "admission no",
    "adm no",
    "admission number",
    "admno",
    "sr no",
    "sr. no",
    "serial no",
    "s.no",
    "s no",
  ],
  full_name: [
    "name",
    "student name",
    "full name",
    "student's name",
    "pupil name",
  ],
  class_name: [
    "class",
    "class name",
    "grade",
    "standard",
    "std",
  ],
  section: [
    "section",
    "sec",
    "div",
    "division",
  ],
  stream: [
    "stream",
    "specialization",
    "branch",
    "faculty",
    "group",
  ],
  father_name: [
    "father name",
    "father's name",
    "father",
    "fathers name",
    "f/name",
    "f name",
  ],
  mother_name: [
    "mother name",
    "mother's name",
    "mother",
    "mothers name",
    "m/name",
    "m name",
  ],
  date_of_birth: ["dob", "date of birth", "birth date", "birthdate", "d.o.b", "d.o.b."],
  gender: ["gender", "sex", "m/f"],
  phone: ["phone", "mobile", "contact", "phone no", "mobile no", "contact no", "phone number"],
  address: ["address", "residential address", "home address"],
  roll_number: ["roll no", "roll number", "roll", "rollno", "roll no."],
  email: ["email", "e-mail", "email id", "email address", "mail"],
  blood_group: ["blood group", "blood type", "bloodgroup", "bg"],
  category: ["category", "caste", "caste category", "reservation", "social category"],
  aadhar_number: ["aadhar", "aadhaar", "aadhar no", "aadhaar no", "aadhar number", "aadhaar number", "uid", "aadhar no."],
  previous_school: ["previous school", "prev school", "last school", "school", "previous institution"],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9\s/]/g, "").trim();
}

function mapHeaders(headers: string[]): Record<number, string> {
  const mapping: Record<number, string> = {};

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return;

    // Two-pass matching: first try exact matches, then substring matches
    // This prevents "blood group" matching "group" (stream) before "blood group" (blood_group)
    let matched = false;
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (normalized === field || aliases.some((alias) => normalized === alias)) {
        mapping[index] = field;
        matched = true;
        break;
      }
    }
    if (!matched) {
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (aliases.some((alias) => normalized.includes(alias))) {
          mapping[index] = field;
          break;
        }
      }
    }
  });

  return mapping;
}

function toTitleCase(value: string): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeGender(value: string): string {
  const v = value.toLowerCase().trim();
  if (v === "m" || v === "male" || v === "boy") return "male";
  if (v === "f" || v === "female" || v === "girl") return "female";
  if (v === "other" || v === "o") return "other";
  return "";
}

function excelSerialToDate(serial: number): string {
  const epoch = new Date(1899, 11, 30);
  const date = new Date(epoch.getTime() + serial * 86400000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeDateString(value: string): string {
  if (!value) return "";
  // Handle Excel serial numbers (e.g., 43564)
  const num = Number(value);
  if (!isNaN(num) && num > 1000 && num < 100000) {
    return excelSerialToDate(num);
  }
  const parts = value.split(/[/\-\.]/);
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

function normalizePhone(value: string): string {
  if (!value) return "";
  const cleaned = value.replace(/[eE]+\d+$/, "");
  return cleaned.replace(/\.0+$/, "").trim();
}

function validateRow(row: ParsedRow): string[] {
  const errors: string[] = [];
  if (!row.admission_no || row.admission_no.trim() === "") {
    errors.push("Admission number is required");
  }
  if (!row.full_name || row.full_name.trim().length < 2) {
    errors.push("Name is required (min 2 chars)");
  }
  if (!row.class_name || row.class_name.trim() === "") {
    errors.push("Class is required");
  }
  return errors;
}

export function StudentBulkUpload({
  open,
  onOpenChange,
  onSuccess,
}: StudentBulkUploadProps) {
  const [step, setStep] = useState<"upload" | "preview" | "results">("upload");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [existingClassKeys, setExistingClassKeys] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  // Fetch existing classes when entering preview
  useEffect(() => {
    if (step !== "preview") return;
    const supabase = createClient();
    (async () => {
      const { data: classes } = await supabase
        .from("classes")
        .select("name, section, stream_id, streams:stream_id(name)");
      const keys = new Set<string>();
      for (const c of classes || []) {
        keys.add(formatClassName({
          name: c.name as string,
          section: c.section as string,
          streams: c.streams as unknown as { name: string } | null,
        }));
      }
      setExistingClassKeys(keys);
    })();
  }, [step]);

  const resetState = () => {
    setStep("upload");
    setParsedRows([]);
    setFileName("");
    setEditingIndex(null);
    setExistingClassKeys(new Set());
    setUploading(false);
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
      reader.onload = (evt) => {
        try {
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
          const columnMap = mapHeaders(headers);

          if (!Object.values(columnMap).includes("admission_no")) {
            toast.error(
              'Could not find "Admission No" column. Please check the headers.'
            );
            return;
          }
          if (!Object.values(columnMap).includes("full_name")) {
            toast.error(
              'Could not find "Name" column. Please check the headers.'
            );
            return;
          }

          const parsed: ParsedRow[] = [];
          for (let i = 1; i < rawRows.length; i++) {
            const row = rawRows[i];
            if (!row || row.every((cell) => !cell || String(cell).trim() === "")) {
              continue;
            }

            const record: ParsedRow = {
              admission_no: "",
              full_name: "",
              class_name: "",
              section: "",
              stream: "",
              father_name: "",
              mother_name: "",
              date_of_birth: "",
              gender: "",
              phone: "",
              address: "",
              roll_number: undefined,
              email: "",
              blood_group: "",
              category: "",
              aadhar_number: "",
              previous_school: "",
              errors: [],
            };

            const NAME_FIELDS = new Set(["full_name", "father_name", "mother_name", "address", "previous_school"]);

            for (const [colIndex, field] of Object.entries(columnMap)) {
              const cellValue = String(row[Number(colIndex)] ?? "").trim();
              if (field === "roll_number") {
                const num = parseInt(cellValue, 10);
                record.roll_number = isNaN(num) ? undefined : num;
              } else if (field === "gender") {
                record[field] = normalizeGender(cellValue);
              } else if (field === "date_of_birth") {
                record[field] = normalizeDateString(cellValue);
              } else if (field === "phone") {
                record[field] = normalizePhone(cellValue);
              } else if (field === "email") {
                record[field] = cellValue.toLowerCase();
              } else if (NAME_FIELDS.has(field)) {
                (record as unknown as Record<string, unknown>)[field] = toTitleCase(cellValue);
              } else {
                (record as unknown as Record<string, unknown>)[field] = cellValue;
              }
            }

            record.errors = validateRow(record);
            parsed.push(record);
          }

          if (parsed.length === 0) {
            toast.error("No data rows found in the file");
            return;
          }

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

  // Compute unique class+section+stream combos from parsed data for preview
  const allFileClasses = Array.from(
    new Set(
      parsedRows
        .filter((r) => r.class_name)
        .map((r) => {
          const name = r.class_name.trim();
          const sec = (r.section || "A").trim();
          const stream = r.stream?.trim();
          return stream ? `${name} - ${sec} (${stream})` : `${name} - ${sec}`;
        })
    )
  ).sort();

  const missingClasses = allFileClasses.filter((cls) => !existingClassKeys.has(cls));
  const existingClasses = allFileClasses.filter((cls) => existingClassKeys.has(cls));

  const removeRow = (index: number) => {
    setParsedRows((prev) => prev.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(null);
  };

  const updateRow = (index: number, field: keyof ParsedRow, value: string | number | undefined) => {
    setParsedRows((prev) => {
      const updated = [...prev];
      const row = { ...updated[index] };
      if (field === "roll_number") {
        row.roll_number = value as number | undefined;
      } else {
        (row as unknown as Record<string, unknown>)[field] = value;
      }
      row.errors = validateRow(row);
      updated[index] = row;
      return updated;
    });
  };

  const handleSubmit = async () => {
    if (validRows.length === 0) {
      toast.error("No valid rows to import");
      return;
    }

    setUploading(true);
    const payload = {
      students: validRows.map((r) => ({
        admission_no: r.admission_no,
        full_name: r.full_name,
        class_name: r.class_name,
        section: r.section || "A",
        stream: r.stream || undefined,
        father_name: r.father_name || undefined,
        mother_name: r.mother_name || undefined,
        date_of_birth: r.date_of_birth || undefined,
        gender: r.gender || undefined,
        phone: r.phone || undefined,
        address: r.address || undefined,
        roll_number: r.roll_number,
        email: r.email || undefined,
        blood_group: r.blood_group || undefined,
        category: r.category || undefined,
        aadhar_number: r.aadhar_number || undefined,
        previous_school: r.previous_school || undefined,
      })),
    };

    try {
      const res = await fetch("/api/students/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to import students");
        setUploading(false);
        return;
      }

      setUploadResult(data as UploadResult);
      setStep("results");
      onSuccess();
    } catch {
      toast.error("Failed to import students");
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [
        "Admission No",
        "Name",
        "Class",
        "Section",
        "Stream",
        "Father's Name",
        "Mother's Name",
        "DOB (DD/MM/YYYY)",
        "Gender (M/F)",
        "Phone",
        "Address",
        "Roll No",
        "Email",
        "Blood Group",
        "Category",
        "Aadhar Number",
        "Previous School",
      ],
      ["1001", "Rahul Kumar", "X", "A", "", "Rajesh Kumar", "Sunita Devi", "15/03/2012", "M", "9876543210", "123, Main Street", "1", "", "O+", "General", "", ""],
      ["1002", "Priya Sharma", "XI", "A", "Science", "Anil Sharma", "Meena Sharma", "22/07/2010", "F", "9876543211", "456, Park Road", "2", "", "B+", "", "", ""],
      ["1003", "Amit Singh", "XII", "B", "Commerce", "Ravi Singh", "Neha Singh", "10/01/2009", "M", "9876543212", "789, Lake View", "3", "", "", "", "", ""],
    ]);

    ws["!cols"] = [
      { wch: 14 }, // Admission No
      { wch: 20 }, // Name
      { wch: 8 },  // Class
      { wch: 8 },  // Section
      { wch: 12 }, // Stream
      { wch: 20 }, // Father
      { wch: 20 }, // Mother
      { wch: 18 }, // DOB
      { wch: 12 }, // Gender
      { wch: 14 }, // Phone
      { wch: 30 }, // Address
      { wch: 8 },  // Roll
      { wch: 22 }, // Email
      { wch: 12 }, // Blood Group
      { wch: 12 }, // Category
      { wch: 16 }, // Aadhar
      { wch: 24 }, // Previous School
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    XLSX.writeFile(wb, "student_upload_template.xlsx");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
              <Upload className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <DialogTitle>
                {step === "upload" ? "Upload Student Data" : step === "preview" ? "Preview & Import" : "Import Results"}
              </DialogTitle>
              <p className="text-xs text-gray-500 mt-0.5">
                {step === "upload"
                  ? "Import students from Excel or CSV — class, section, and stream are read from the file"
                  : step === "preview"
                  ? "Review and edit data before importing"
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
                <p className="text-sm text-gray-600 mb-2">
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

            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
              <p className="text-xs text-blue-700 font-medium mb-1">How it works</p>
              <ul className="text-xs text-blue-600 space-y-0.5 list-disc pl-4">
                <li><strong>Class</strong> column is required (e.g., X, XI, XII, Nursery, LKG)</li>
                <li><strong>Section</strong> column is optional (defaults to A if not provided)</li>
                <li><strong>Stream</strong> column for senior classes (e.g., Science, Commerce, Humanities) — combined with class to match &quot;XI Science&quot;</li>
                <li>Missing classes are <strong>auto-created</strong> during import for the current academic year.</li>
                <li>You can edit any field in the preview screen before importing.</li>
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
                <p className="text-sm text-gray-600">
                  File: <span className="font-medium">{fileName}</span>
                </p>
                <Badge variant="secondary" className="bg-green-100 text-green-700">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {validRows.length} valid
                </Badge>
                {invalidRows.length > 0 && (
                  <Badge variant="secondary" className="bg-red-100 text-red-700">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    {invalidRows.length} errors
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
                }}
              >
                Upload Different File
              </Button>
            </div>

            {missingClasses.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <p className="text-xs text-amber-700 font-medium mb-1.5">
                  {missingClasses.length} new class{missingClasses.length === 1 ? "" : "es"} will be auto-created
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {missingClasses.map((cls) => (
                    <span
                      key={cls}
                      className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-100 text-xs font-medium text-amber-700"
                    >
                      {cls}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {existingClasses.length > 0 && (
              <div className="rounded-lg bg-green-50 border border-green-200 p-3">
                <p className="text-xs text-green-700 font-medium mb-1.5">
                  {existingClasses.length} existing class{existingClasses.length === 1 ? "" : "es"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {existingClasses.map((cls) => (
                    <span
                      key={cls}
                      className="inline-flex items-center px-2 py-0.5 rounded-md bg-green-100 text-xs font-medium text-green-700"
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
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Adm No</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>Sec</TableHead>
                      <TableHead>Stream</TableHead>
                      <TableHead>Father</TableHead>
                      <TableHead>Gender</TableHead>
                      <TableHead>Roll</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedRows.map((row, i) => {
                      const isEditing = editingIndex === i;
                      return (
                        <TableRow
                          key={i}
                          className={
                            row.errors.length > 0 ? "bg-red-50" : undefined
                          }
                        >
                          <TableCell className="text-gray-400 text-xs">
                            {i + 1}
                          </TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Input
                                className="h-7 text-xs w-20"
                                value={row.admission_no}
                                onChange={(e) => updateRow(i, "admission_no", e.target.value)}
                              />
                            ) : (
                              <span className="font-medium">{row.admission_no || "—"}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Input
                                className="h-7 text-xs w-32"
                                value={row.full_name}
                                onChange={(e) => updateRow(i, "full_name", e.target.value)}
                              />
                            ) : (
                              row.full_name || "—"
                            )}
                          </TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Input
                                className="h-7 text-xs w-16"
                                value={row.class_name}
                                onChange={(e) => updateRow(i, "class_name", e.target.value)}
                              />
                            ) : (
                              row.class_name || "—"
                            )}
                          </TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Input
                                className="h-7 text-xs w-12"
                                value={row.section}
                                onChange={(e) => updateRow(i, "section", e.target.value)}
                              />
                            ) : (
                              row.section || "—"
                            )}
                          </TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Input
                                className="h-7 text-xs w-20"
                                value={row.stream}
                                onChange={(e) => updateRow(i, "stream", e.target.value)}
                              />
                            ) : (
                              <span className="text-gray-500">{row.stream || "—"}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-gray-600">
                            {isEditing ? (
                              <Input
                                className="h-7 text-xs w-28"
                                value={row.father_name}
                                onChange={(e) => updateRow(i, "father_name", e.target.value)}
                              />
                            ) : (
                              row.father_name || "—"
                            )}
                          </TableCell>
                          <TableCell className="text-gray-600 capitalize">
                            {isEditing ? (
                              <Input
                                className="h-7 text-xs w-14"
                                value={row.gender}
                                onChange={(e) => updateRow(i, "gender", e.target.value)}
                              />
                            ) : (
                              row.gender || "—"
                            )}
                          </TableCell>
                          <TableCell className="text-gray-600">
                            {isEditing ? (
                              <Input
                                className="h-7 text-xs w-12"
                                type="number"
                                value={row.roll_number ?? ""}
                                onChange={(e) => updateRow(i, "roll_number", e.target.value ? parseInt(e.target.value) : undefined)}
                              />
                            ) : (
                              row.roll_number ?? "—"
                            )}
                          </TableCell>
                          <TableCell>
                            {row.errors.length > 0 ? (
                              <span
                                className="text-xs text-red-600"
                                title={row.errors.join(", ")}
                              >
                                {row.errors[0]}
                              </span>
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={() => setEditingIndex(isEditing ? null : i)}
                                className={`p-1 rounded transition-colors ${isEditing ? "text-blue-600 bg-blue-50" : "text-gray-400 hover:text-blue-500"}`}
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
                className="bg-navy-900 hover:bg-navy-800 text-white"
              >
                {uploading ? (
                  <>
                    <span className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Uploading...
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
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-center">
                    <p className="text-2xl font-bold text-green-700">{uploadResult.inserted}</p>
                    <p className="text-xs text-green-600">Inserted</p>
                  </div>
                  <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-center">
                    <p className="text-2xl font-bold text-blue-700">{uploadResult.total}</p>
                    <p className="text-xs text-blue-600">Total Sent</p>
                  </div>
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-center">
                    <p className="text-2xl font-bold text-amber-700">{uploadResult.classesCreated}</p>
                    <p className="text-xs text-amber-600">Classes Created</p>
                  </div>
                  <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center">
                    <p className="text-2xl font-bold text-red-700">{uploadResult.errors.length}</p>
                    <p className="text-xs text-red-600">Failed</p>
                  </div>
                </div>

                {uploadResult.errors.length === 0 ? (
                  <div className="rounded-xl bg-green-50 border border-green-200 p-6 text-center">
                    <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-2" />
                    <p className="text-sm font-medium text-green-700">
                      All {uploadResult.inserted} students imported successfully!
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <p className="text-sm font-medium text-red-700">
                        {uploadResult.errors.length} student{uploadResult.errors.length === 1 ? "" : "s"} failed to import
                      </p>
                    </div>
                    <div className="border rounded-xl overflow-hidden">
                      <div className="overflow-x-auto max-h-[350px] overflow-y-auto">
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
                                <TableCell className="text-xs text-red-600">{err.error}</TableCell>
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
              </>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => handleClose(false)}>
                Close
              </Button>
              {uploadResult && uploadResult.errors.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    // Download failed students as CSV for easy re-upload
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
