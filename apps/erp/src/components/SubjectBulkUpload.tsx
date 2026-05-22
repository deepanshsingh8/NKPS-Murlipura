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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  Download,
  AlertCircle,
  CheckCircle2,
  X,
} from "lucide-react";

interface ParsedRow {
  class_name: string;
  section: string;
  stream: string;
  subject_name: string;
  subject_code: string;
  teacher_employee_id: string;
  errors: string[];
}

interface SubjectBulkUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// Flexible column name mapping
const COLUMN_ALIASES: Record<string, string[]> = {
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
    "branch",
    "specialization",
    "faculty",
    "group",
  ],
  subject_name: [
    "subject",
    "subject name",
    "subject title",
  ],
  subject_code: [
    "code",
    "subject code",
    "sub code",
  ],
  teacher_employee_id: [
    "teacher id",
    "teacher",
    "employee id",
    "emp id",
    "teacher employee id",
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

function validateRow(row: ParsedRow): string[] {
  const errors: string[] = [];
  if (!row.class_name || row.class_name.trim() === "") {
    errors.push("Class is required");
  }
  if (!row.subject_name || row.subject_name.trim() === "") {
    errors.push("Subject name is required");
  }
  return errors;
}

export function SubjectBulkUpload({
  open,
  onOpenChange,
  onSuccess,
}: SubjectBulkUploadProps) {
  const [step, setStep] = useState<"upload" | "preview">("upload");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");

  const resetState = () => {
    setStep("upload");
    setParsedRows([]);
    setFileName("");
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
            toast.error(
              "File must have a header row and at least one data row"
            );
            return;
          }

          const headers = rawRows[0].map(String);
          const columnMap = mapHeaders(headers);

          if (!Object.values(columnMap).includes("class_name")) {
            toast.error(
              'Could not find "Class" column. Please check the headers.'
            );
            return;
          }
          if (!Object.values(columnMap).includes("subject_name")) {
            toast.error(
              'Could not find "Subject Name" column. Please check the headers.'
            );
            return;
          }

          const parsed: ParsedRow[] = [];
          for (let i = 1; i < rawRows.length; i++) {
            const row = rawRows[i];
            if (
              !row ||
              row.every((cell) => !cell || String(cell).trim() === "")
            ) {
              continue;
            }

            const record: ParsedRow = {
              class_name: "",
              section: "",
              stream: "",
              subject_name: "",
              subject_code: "",
              teacher_employee_id: "",
              errors: [],
            };

            for (const [colIdx, field] of Object.entries(columnMap)) {
              const val = String(row[Number(colIdx)] ?? "").trim();
              if (field === "class_name") record.class_name = val;
              else if (field === "section") record.section = val || "A";
              else if (field === "stream") record.stream = val;
              else if (field === "subject_name") record.subject_name = val;
              else if (field === "subject_code") record.subject_code = val;
              else if (field === "teacher_employee_id")
                record.teacher_employee_id = val;
            }

            if (!record.section) record.section = "A";
            record.errors = validateRow(record);
            parsed.push(record);
          }

          if (parsed.length === 0) {
            toast.error("No valid data rows found");
            return;
          }

          setParsedRows(parsed);
          setStep("preview");
          toast.success(`Parsed ${parsed.length} row${parsed.length === 1 ? "" : "s"}`);
        } catch {
          toast.error("Failed to parse file. Ensure it is a valid Excel file.");
        }
      };
      reader.readAsArrayBuffer(file);
    },
    []
  );

  const handleDownloadTemplate = () => {
    const templateData = [
      ["Class", "Section", "Stream", "Subject Name", "Subject Code", "Teacher Employee ID"],
      ["V", "A", "", "Mathematics", "MATH", ""],
      ["V", "A", "", "English", "ENG", ""],
      ["V", "A", "", "Hindi", "HIN", "EMP001"],
      ["IX", "A", "", "Science", "SCI", ""],
      ["XI", "A", "Science", "Physics", "PHY", "EMP002"],
      ["XI", "A", "Science", "Chemistry", "CHEM", ""],
      ["XI", "A", "Commerce", "Accountancy", "ACC", ""],
    ];

    const ws = XLSX.utils.aoa_to_sheet(templateData);

    // Set column widths
    ws["!cols"] = [
      { wch: 8 },
      { wch: 8 },
      { wch: 12 },
      { wch: 20 },
      { wch: 14 },
      { wch: 20 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Subject Assignments");
    XLSX.writeFile(wb, "subject_assignments_template.xlsx");
    toast.success("Template downloaded");
  };

  const handleSubmit = async () => {
    const validRows = parsedRows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) {
      toast.error("No valid rows to upload");
      return;
    }

    const payload = {
      assignments: validRows.map((r) => ({
        class_name: r.class_name,
        section: r.section,
        stream: r.stream || undefined,
        subject_name: r.subject_name,
        subject_code: r.subject_code || undefined,
        teacher_employee_id: r.teacher_employee_id || undefined,
      })),
    };

    const rowCount = validRows.length;
    handleClose(false);
    toast.info(
      `Uploading ${rowCount} assignment${rowCount === 1 ? "" : "s"}...`,
      { duration: 5000 }
    );

    try {
      const res = await fetch("/api/subjects/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to import assignments");
        return;
      }

      if (data.created > 0) {
        toast.success(
          `Created ${data.created} assignment${data.created === 1 ? "" : "s"}`
        );
      }

      if (data.skipped > 0) {
        toast.info(
          `Skipped ${data.skipped} duplicate${data.skipped === 1 ? "" : "s"}`
        );
      }

      if (data.errors?.length > 0) {
        toast.warning(
          `${data.errors.length} row${data.errors.length === 1 ? "" : "s"} had errors`
        );
      }

      onSuccess();
    } catch {
      toast.error("Failed to connect to server");
    }
  };

  const validCount = parsedRows.filter((r) => r.errors.length === 0).length;
  const errorCount = parsedRows.filter((r) => r.errors.length > 0).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/10">
              <Upload className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <DialogTitle>Bulk Upload Subject Assignments</DialogTitle>
              <p className="text-xs text-gray-500 mt-0.5">
                Import subject-class assignments from an Excel file
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {step === "upload" && (
            <div className="space-y-4 py-4">
              <div className="border-2 border-dashed border-gray-200 dark:border-border rounded-xl p-8 text-center">
                <Upload className="h-8 w-8 mx-auto text-gray-400 mb-3" />
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                  Upload an Excel file (.xlsx, .xls) with subject assignments
                </p>
                <label className="inline-flex items-center gap-2 px-4 py-2 bg-navy-900 hover:bg-navy-800 text-white text-sm font-medium rounded-lg cursor-pointer transition-colors">
                  <Upload className="h-4 w-4" />
                  Choose File
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-blue-200 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-950/10 p-4">
                <p className="text-sm text-blue-800 dark:text-blue-300 font-medium mb-2">
                  Expected columns:
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-blue-700 dark:text-blue-400">
                  <span>
                    <strong>Class</strong> — e.g. V, IX, XI (required)
                  </span>
                  <span>
                    <strong>Section</strong> — e.g. A, B (defaults to A)
                  </span>
                  <span>
                    <strong>Stream</strong> — e.g. Science, Commerce (XI/XII
                    only)
                  </span>
                  <span>
                    <strong>Subject Name</strong> — e.g. Mathematics (required)
                  </span>
                  <span>
                    <strong>Subject Code</strong> — e.g. MATH (optional)
                  </span>
                  <span>
                    <strong>Teacher Employee ID</strong> — e.g. EMP001 (optional)
                  </span>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={handleDownloadTemplate}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    {fileName}
                  </span>
                  <Badge
                    variant="secondary"
                    className="bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 text-xs"
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    {validCount} valid
                  </Badge>
                  {errorCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs"
                    >
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {errorCount} error{errorCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStep("upload");
                    setParsedRows([]);
                    setFileName("");
                  }}
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>Section</TableHead>
                      <TableHead>Stream</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Teacher ID</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedRows.map((row, i) => (
                      <TableRow
                        key={i}
                        className={
                          row.errors.length > 0
                            ? "bg-red-50/50 dark:bg-red-950/10"
                            : ""
                        }
                      >
                        <TableCell className="text-xs text-gray-400">
                          {i + 1}
                        </TableCell>
                        <TableCell className="font-medium">
                          {row.class_name}
                        </TableCell>
                        <TableCell>{row.section}</TableCell>
                        <TableCell className="text-gray-500 dark:text-gray-400">
                          {row.stream || "—"}
                        </TableCell>
                        <TableCell className="font-medium">
                          {row.subject_name}
                        </TableCell>
                        <TableCell className="text-gray-500 dark:text-gray-400">
                          {row.subject_code || "—"}
                        </TableCell>
                        <TableCell className="text-gray-500 dark:text-gray-400">
                          {row.teacher_employee_id || "—"}
                        </TableCell>
                        <TableCell>
                          {row.errors.length > 0 ? (
                            <span className="text-xs text-red-600 dark:text-red-400">
                              {row.errors.join("; ")}
                            </span>
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        {step === "preview" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={validCount === 0}
              className="bg-navy-900 hover:bg-navy-800 text-white"
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload {validCount} Assignment{validCount === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
