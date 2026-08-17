"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@nkps/shared/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import {
  SortFilterHead,
  TableFilterSummary,
  useTableControls,
  type TableColumns,
} from "@nkps/shared/components/ui/data-table";
import { toast } from "sonner";
import { Plus, Download, Trash2, Loader2, Search, UserCheck, FileText, Upload } from "lucide-react";
import { adminFetch, adminDelete } from "@nkps/shared/lib/admin-api";
import { uploadToStorage } from "@nkps/shared/lib/supabase/upload";
import { FileDropZone } from "@nkps/shared/components/FileDropZone";
import { AcademicYearSelect } from "@nkps/shared/components/AcademicYearSelect";
import type { TransferCertificate, Student } from "@nkps/shared/types";

export default function AdminTransferCertificatesPage() {
  const [certificates, setCertificates] = useState<TransferCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [academicYear, setAcademicYear] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Student search for linking
  const [studentSearch, setStudentSearch] = useState("");
  const [studentResults, setStudentResults] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [searchingStudents, setSearchingStudents] = useState(false);

  const searchStudents = useCallback(async (query: string) => {
    if (query.length < 2) {
      setStudentResults([]);
      return;
    }
    setSearchingStudents(true);
    // Read via the service-role API route: the browser client can't read the
    // students table (its RLS needs an admin session the CMS client lacks).
    const res = await adminFetch(
      `/api/transfer-certificates?studentSearch=${encodeURIComponent(query)}`
    );
    const json = await res.json().catch(() => ({}));
    setStudentResults(res.ok ? ((json.students as Student[]) ?? []) : []);
    setSearchingStudents(false);
  }, []);

  const selectStudent = (student: Student) => {
    setSelectedStudent(student);
    setStudentSearch("");
    setStudentResults([]);
  };

  const clearSelectedStudent = () => {
    setSelectedStudent(null);
  };

  const fetchCertificates = async () => {
    // Read via the service-role API route — the browser client can't read the
    // transfer_certificates table (RLS requires an authenticated session the
    // CMS browser client doesn't carry), which silently returned 0 rows.
    const res = await adminFetch("/api/transfer-certificates");
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      toast.error(json.error || "Failed to fetch certificates");
      setLoading(false);
      return;
    }

    setCertificates((json.certificates as TransferCertificate[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchCertificates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpload = async () => {
    if (!file) {
      toast.error("Please select a PDF file");
      return;
    }
    if (!selectedStudent) {
      toast.error("Link the TC to a student in the system");
      return;
    }
    if (!selectedStudent.date_of_birth) {
      toast.error(
        "Selected student has no date of birth on file. Update the student record first."
      );
      return;
    }
    if (!academicYear.trim()) {
      toast.error("Please select the academic year");
      return;
    }

    setUploading(true);

    try {
      const fileName = `${Date.now()}-${selectedStudent.full_name.replace(/\s+/g, "-").toLowerCase()}.pdf`;
      const url = await uploadToStorage("transfer-certificates", fileName, file);

      const res = await adminFetch("/api/transfer-certificates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          studentName: selectedStudent.full_name,
          academicYear: academicYear.trim(),
          admissionNo: selectedStudent.admission_no,
          studentId: selectedStudent.id,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Upload failed");
        return;
      }

      toast.success(
        data.studentClosed
          ? "TC uploaded — student marked terminated"
          : "TC uploaded — but student could not be closed. Please update status manually."
      );
      setDialogOpen(false);
      setFile(null);
      setSelectedStudent(null);
      fetchCertificates();
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (tc: TransferCertificate) => {
    try {
      const res = await adminFetch(`/api/transfer-certificates/${tc.id}/download`);
      const data = await res.json();
      if (!res.ok || !data.signedUrl) {
        toast.error(data.error || "Failed to fetch download link");
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Failed to download certificate");
    }
  };

  const handleDelete = async (tc: TransferCertificate) => {
    if (!confirm(`Delete TC for "${tc.student_name}"? This cannot be undone.`))
      return;

    try {
      const res = await adminDelete("/api/transfer-certificates", { id: tc.id, fileUrl: tc.file_url });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Delete failed");
        return;
      }

      toast.success("Transfer certificate deleted");
      fetchCertificates();
    } catch {
      toast.error("An unexpected error occurred");
    }
  };

  // Header sort/filter accessors — mirror what the matching cell renders.
  const columns = useMemo<TableColumns<TransferCertificate>>(
    () => ({
      student_name: {
        label: "Student Name",
        value: (tc) => tc.student_name,
        filter: "text",
      },
      admission_no: {
        label: "Admission No",
        value: (tc) => tc.admission_no || null,
        filter: "text",
      },
      academic_year: { label: "Academic Year", value: (tc) => tc.academic_year },
      upload_date: {
        label: "Upload Date",
        value: (tc) => new Date(tc.upload_date).toLocaleDateString(),
        sortValue: (tc) => new Date(tc.upload_date).getTime(),
      },
    }),
    []
  );

  const filtered = certificates.filter((tc) => {
    const q = searchQuery.toLowerCase();
    return (
      tc.student_name.toLowerCase().includes(q) ||
      (tc.admission_no && tc.admission_no.toLowerCase().includes(q))
    );
  });

  const table = useTableControls({ rows: filtered, columns });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Transfer Certificates
        </h1>

        <Button className="bg-navy-900 hover:bg-navy-800 text-white" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Upload TC
        </Button>

      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-500/10">
                <FileText className="h-5 w-5 text-gold-600" />
              </div>
              <div>
                <DialogTitle>Upload Transfer Certificate</DialogTitle>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Add a new TC to the school records</p>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5">
            {/* File Upload Zone */}
            <FileDropZone
              accept=".pdf"
              icon="pdf"
              onChange={(files) => setFile(files?.[0] ?? null)}
              value={file}
              label="Drop your PDF here or click to browse"
              hint="PDF files only, max 10MB"
            />

            {/* Student Search — required */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Link to Student <span className="text-red-500">*</span>
              </Label>
              {selectedStudent ? (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                    <UserCheck className="h-4 w-4 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-800 dark:text-green-300 truncate">
                      {selectedStudent.full_name}
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400">
                      Adm: {selectedStudent.admission_no}
                      {" · "}DOB:{" "}
                      {selectedStudent.date_of_birth
                        ? new Date(selectedStudent.date_of_birth).toLocaleDateString()
                        : "—"}
                      {selectedStudent.father_name && ` \u00B7 ${selectedStudent.father_name}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearSelectedStudent}
                    className="text-green-600 hover:text-red-600 h-7 px-2 text-xs"
                  >
                    Change
                  </Button>
                </div>
              ) : null}
              {selectedStudent && !selectedStudent.date_of_birth && (
                <p className="text-[11px] text-red-600 dark:text-red-400 leading-relaxed">
                  This student has no date of birth on file. The DOB is required so the
                  public lookup can find this TC. Update the student record before uploading.
                </p>
              )}
              {selectedStudent && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  On upload, this student will be marked inactive and their active enrollment terminated.
                </p>
              )}
              {!selectedStudent && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by name or admission number..."
                    value={studentSearch}
                    onChange={(e) => {
                      setStudentSearch(e.target.value);
                      searchStudents(e.target.value);
                    }}
                    className="pl-9"
                  />
                  {searchingStudents && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
                  )}
                  {studentResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {studentResults.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => selectStudent(s)}
                          className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-muted text-sm border-b border-gray-100 dark:border-border last:border-0 transition-colors"
                        >
                          <span className="font-medium">{s.full_name}</span>
                          <span className="text-gray-500 dark:text-gray-400 ml-2">({s.admission_no})</span>
                          {s.father_name && (
                            <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs">{"\u00B7 "}{s.father_name}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                A linked student record is required. The TC is matched against the
                student&apos;s name, admission number, and date of birth on upload.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="academic-year" className="text-xs font-medium">Academic Year *</Label>
              <AcademicYearSelect
                id="academic-year"
                value={academicYear}
                onChange={setAcademicYear}
                required
              />
            </div>

            <Button
              onClick={handleUpload}
              disabled={
                uploading ||
                !file ||
                !selectedStudent ||
                !selectedStudent.date_of_birth
              }
              className="w-full bg-navy-900 hover:bg-navy-800 text-white h-11 rounded-xl font-medium"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Certificate
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search by name or admission no..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="erp-table-container overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-gray-100 dark:bg-muted rounded animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            {searchQuery
              ? "No certificates match your search."
              : "No transfer certificates uploaded yet."}
          </div>
        ) : (
          <>
          <TableFilterSummary
            ctl={table}
            total={filtered.length}
            shown={table.rows.length}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <SortFilterHead ctl={table} col="student_name" />
                <SortFilterHead ctl={table} col="admission_no" />
                <SortFilterHead ctl={table} col="academic_year" />
                <SortFilterHead ctl={table} col="upload_date" />
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-gray-500 dark:text-gray-400">
                    No certificates match the column filters.
                  </TableCell>
                </TableRow>
              )}
              {table.rows.map((tc) => (
                <TableRow key={tc.id}>
                  <TableCell className="font-medium">
                    {tc.student_name}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-400">
                    {tc.admission_no || "—"}
                  </TableCell>
                  <TableCell>{tc.academic_year}</TableCell>
                  <TableCell>
                    {new Date(tc.upload_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleDownload(tc)}
                        className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-gray-100 dark:hover:bg-muted transition-colors"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(tc)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </>
        )}
      </div>
    </div>
  );
}
