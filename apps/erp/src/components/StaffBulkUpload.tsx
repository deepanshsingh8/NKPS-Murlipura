"use client";

import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
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
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
} from "lucide-react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import type { StaffCategory } from "@nkps/shared/types";

const CATEGORY_OPTIONS: { value: StaffCategory; label: string }[] = [
  { value: "management", label: "Management" },
  { value: "admin", label: "Administration" },
  { value: "pgt", label: "PGT" },
  { value: "tgt", label: "TGT" },
  { value: "prt", label: "PRT" },
  { value: "motherTeachers", label: "Mother Teachers" },
  { value: "prePrimaryCoordinator", label: "Pre-primary Coordinator" },
  { value: "primaryCoordinator", label: "Primary Coordinator" },
  { value: "middleCoordinator", label: "Middle Coordinator" },
  { value: "seniorCoordinator", label: "Senior Coordinator" },
  { value: "additionalStaff", label: "Additional Staff" },
  { value: "busDriver", label: "Bus Drivers" },
  { value: "peon", label: "Peons" },
];

interface ParsedRow {
  name: string;
  subject: string;
  category: string;
  email: string;
  phone: string;
  date_of_birth: string;
  address: string;
  qualifications: string;
  errors: string[];
}

const CATEGORY_LABEL_TO_VALUE: Record<string, StaffCategory> = {};
for (const c of CATEGORY_OPTIONS) {
  CATEGORY_LABEL_TO_VALUE[c.label.toLowerCase()] = c.value;
  CATEGORY_LABEL_TO_VALUE[c.value.toLowerCase()] = c.value;
}
// Common shorthand aliases
CATEGORY_LABEL_TO_VALUE["mother teacher"] = "motherTeachers";
CATEGORY_LABEL_TO_VALUE["mother teachers"] = "motherTeachers";
CATEGORY_LABEL_TO_VALUE["admin"] = "admin";
CATEGORY_LABEL_TO_VALUE["administrative staff"] = "admin";
CATEGORY_LABEL_TO_VALUE["additional staff"] = "additionalStaff";
CATEGORY_LABEL_TO_VALUE["bus driver"] = "busDriver";
CATEGORY_LABEL_TO_VALUE["bus drivers"] = "busDriver";
CATEGORY_LABEL_TO_VALUE["peons"] = "peon";

function resolveCategory(raw: string): StaffCategory | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  return CATEGORY_LABEL_TO_VALUE[key] ?? null;
}

interface StaffBulkUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// Flexible column name mapping
const COLUMN_ALIASES: Record<string, string[]> = {
  name: [
    "name",
    "full name",
    "staff name",
    "teacher name",
    "employee name",
    "emp name",
  ],
  subject: [
    "subject",
    "designation",
    "role",
    "position",
    "dept",
    "department",
    "subject/designation",
  ],
  email: [
    "email",
    "e-mail",
    "email id",
    "email address",
    "mail",
  ],
  phone: [
    "phone",
    "mobile",
    "contact",
    "phone no",
    "mobile no",
    "contact no",
    "phone number",
    "mob",
  ],
  date_of_birth: [
    "dob",
    "date of birth",
    "birth date",
    "birthdate",
    "d.o.b",
    "d.o.b.",
  ],
  address: [
    "address",
    "residential address",
    "home address",
  ],
  qualifications: [
    "qualifications",
    "qualification",
    "degree",
    "education",
    "degrees",
    "educational qualification",
  ],
  category: [
    "category",
    "type",
    "staff category",
    "staff type",
    "group",
    "department type",
  ],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9\s/]/g, "").trim();
}

function mapHeaders(headers: string[]): Record<number, string> {
  const mapping: Record<number, string> = {};

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return;

    // Two-pass matching: exact first, then substring fallback
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

function toTitleCase(value: string): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizePhone(value: string): string {
  if (!value) return "";
  const cleaned = value.replace(/[eE]+\d+$/, "");
  return cleaned.replace(/\.0+$/, "").trim();
}

function isValidDate(d: string): boolean {
  if (!d) return true;
  const match = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(d);
  return !isNaN(date.getTime());
}

function validateRow(row: ParsedRow, categoryRequired: boolean): string[] {
  const errors: string[] = [];
  if (!row.name || row.name.trim().length < 2) {
    errors.push("Name is required (min 2 chars)");
  }
  if (!row.subject || row.subject.trim() === "") {
    errors.push("Subject/designation is required");
  }
  if (categoryRequired && !row.category) {
    errors.push("Category is required");
  }
  if (row.category && !resolveCategory(row.category)) {
    errors.push(`Unknown category: "${row.category}"`);
  }
  if (row.date_of_birth && !isValidDate(row.date_of_birth)) {
    row.date_of_birth = "";
  }
  return errors;
}

export function StaffBulkUpload({
  open,
  onOpenChange,
  onSuccess,
}: StaffBulkUploadProps) {
  const [step, setStep] = useState<"upload" | "preview">("upload");
  const [selectedCategory, setSelectedCategory] = useState<StaffCategory | "">("");
  const [hasFileCategory, setHasFileCategory] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [fileName, setFileName] = useState("");

  const resetState = () => {
    setStep("upload");
    setSelectedCategory("");
    setHasFileCategory(false);
    setParsedRows([]);
    setFileName("");
    setSubmitting(false);
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
            raw: false,
            defval: "",
          });

          if (rawRows.length < 2) {
            toast.error("File must have a header row and at least one data row");
            return;
          }

          const headers = rawRows[0].map(String);
          const columnMap = mapHeaders(headers);

          if (!Object.values(columnMap).includes("name")) {
            toast.error(
              'Could not find "Name" column. Please check the headers.'
            );
            return;
          }
          if (!Object.values(columnMap).includes("subject")) {
            toast.error(
              'Could not find "Subject" or "Designation" column. Please check the headers.'
            );
            return;
          }

          const fileCategoryCol = Object.values(columnMap).includes("category");
          setHasFileCategory(fileCategoryCol);

          const parsed: ParsedRow[] = [];
          for (let i = 1; i < rawRows.length; i++) {
            const row = rawRows[i];
            if (!row || row.every((cell) => !cell || String(cell).trim() === "")) {
              continue;
            }

            const record: ParsedRow = {
              name: "",
              subject: "",
              category: "",
              email: "",
              phone: "",
              date_of_birth: "",
              address: "",
              qualifications: "",
              errors: [],
            };

            const NAME_FIELDS = new Set(["name", "address"]);

            for (const [colIndex, field] of Object.entries(columnMap)) {
              const cellValue = String(row[Number(colIndex)] ?? "").trim();
              if (field === "date_of_birth") {
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

            record.errors = validateRow(record, fileCategoryCol);
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

  const removeRow = (index: number) => {
    setParsedRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!hasFileCategory && !selectedCategory) {
      toast.error("Please select a category");
      return;
    }
    if (validRows.length === 0) {
      toast.error("No valid rows to import");
      return;
    }

    setSubmitting(true);
    try {
      const res = await adminFetch("/api/staff/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: hasFileCategory ? undefined : selectedCategory,
          staff: validRows.map((r) => ({
            name: r.name,
            subject: r.subject,
            category: hasFileCategory ? resolveCategory(r.category) : undefined,
            email: r.email || undefined,
            phone: r.phone || undefined,
            date_of_birth: r.date_of_birth || undefined,
            address: r.address || undefined,
            qualifications: r.qualifications || undefined,
          })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to import staff");
        return;
      }

      const userMsg = data.usersCreated > 0
        ? ` — ${data.usersCreated} portal account${data.usersCreated === 1 ? "" : "s"} created & emailed`
        : "";
      toast.success(
        `Successfully imported ${data.inserted} staff member${data.inserted === 1 ? "" : "s"}${userMsg}`
      );

      if (data.errors?.length > 0) {
        const details = data.errors
          .slice(0, 5)
          .map((e: { name: string; error: string }) => `${e.name}: ${e.error}`)
          .join("\n");
        const more = data.errors.length > 5 ? `\n...and ${data.errors.length - 5} more` : "";
        toast.warning(
          `${data.errors.length} member(s) had errors and were skipped`,
          { description: details + more, duration: 10000 }
        );
      }

      onSuccess();
      handleClose(false);
    } catch {
      toast.error("Failed to import staff");
    } finally {
      setSubmitting(false);
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [
        "Name",
        "Subject / Designation",
        "Category",
        "Email",
        "Phone",
        "DOB (DD/MM/YYYY)",
        "Address",
        "Qualifications",
      ],
      [
        "Rahul Sharma",
        "Mathematics",
        "PGT",
        "rahul@example.com",
        "9876543210",
        "15/03/1985",
        "123, Main Street, Jaipur",
        "M.Sc., B.Ed.",
      ],
      [
        "Priya Gupta",
        "Librarian",
        "Administrative Staff",
        "",
        "9876543211",
        "",
        "",
        "",
      ],
    ]);

    ws["!cols"] = [
      { wch: 22 },
      { wch: 22 },
      { wch: 22 },
      { wch: 24 },
      { wch: 14 },
      { wch: 18 },
      { wch: 30 },
      { wch: 20 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Staff");
    XLSX.writeFile(wb, "staff_upload_template.xlsx");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
              <Upload className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <DialogTitle>
                {step === "upload" ? "Upload Staff Data" : "Preview & Import"}
              </DialogTitle>
              <p className="text-xs text-gray-500 mt-0.5">
                {step === "upload"
                  ? "Import staff members from Excel or CSV"
                  : hasFileCategory
                    ? "Categories detected from file"
                    : selectedCategory
                      ? `Importing as ${CATEGORY_OPTIONS.find(c => c.value === selectedCategory)?.label || ""}`
                      : "Select a category below"}
              </p>
            </div>
          </div>
        </DialogHeader>

        {step === "upload" ? (
          <div className="space-y-6">
            <div>
              <Label>Upload Excel or CSV File</Label>
              <div className="mt-2 border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-navy-400 transition-colors">
                <Upload className="h-10 w-10 mx-auto text-gray-400 mb-3" />
                <p className="text-sm text-gray-600 mb-2">
                  Drop your file here or click to browse
                </p>
                <p className="text-xs text-gray-400 mb-4">
                  Supports .xlsx, .xls, and .csv files. Include a &quot;Category&quot; column to assign categories per row, or select one below after upload.
                </p>
                <Input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="max-w-xs mx-auto"
                />
              </div>
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
        ) : (
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
                  setHasFileCategory(false);
                }}
              >
                Upload Different File
              </Button>
            </div>

            {/* Show category selector only when file doesn't have a category column */}
            {!hasFileCategory && (
              <div>
                <Label>Select Category for All Staff</Label>
                <Select
                  value={selectedCategory}
                  onValueChange={(val) => val && setSelectedCategory(val as StaffCategory)}
                >
                  <SelectTrigger className="w-full mt-1">
                    <SelectValue placeholder="Choose a staff category..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value} label={c.label}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400 mt-1">
                  No &quot;Category&quot; column detected. All rows will be imported under this category.
                </p>
              </div>
            )}

            <div className="border rounded-xl overflow-hidden">
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Subject / Designation</TableHead>
                      {hasFileCategory && <TableHead>Category</TableHead>}
                      <TableHead>Phone</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Qualifications</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedRows.map((row, i) => (
                      <TableRow
                        key={i}
                        className={
                          row.errors.length > 0 ? "bg-red-50" : undefined
                        }
                      >
                        <TableCell className="text-gray-400 text-xs">
                          {i + 1}
                        </TableCell>
                        <TableCell className="font-medium">
                          {row.name || "—"}
                        </TableCell>
                        <TableCell>{row.subject || "—"}</TableCell>
                        {hasFileCategory && (
                          <TableCell>
                            {resolveCategory(row.category) ? (
                              <Badge variant="secondary" className="text-xs">
                                {CATEGORY_OPTIONS.find(c => c.value === resolveCategory(row.category))?.label || row.category}
                              </Badge>
                            ) : (
                              <span className="text-xs text-red-500">{row.category || "—"}</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="text-gray-600">
                          {row.phone || "—"}
                        </TableCell>
                        <TableCell className="text-gray-600">
                          {row.email || "—"}
                        </TableCell>
                        <TableCell className="text-gray-600">
                          {row.qualifications || "—"}
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
                          <button
                            onClick={() => removeRow(i)}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || validRows.length === 0}
                className="bg-navy-900 hover:bg-navy-800 text-white"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Import {validRows.length} Staff Member{validRows.length === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
