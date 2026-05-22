"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  FileText,
  Upload,
  Trash2,
  Plus,
  Pencil,
  ExternalLink,
  ScrollText,
} from "lucide-react";
import { adminApi, adminFetch, adminDelete } from "@nkps/shared/lib/admin-api";
import { uploadToStorage } from "@nkps/shared/lib/supabase/upload";
import { FileDropZone } from "@nkps/shared/components/FileDropZone";
import type {
  DisclosureItem,
  DisclosureDocument,
  DisclosureBoardResult,
  ExamClass,
} from "@nkps/shared/types";

type TabKey = "general" | "documents" | "result_academics" | "staff" | "infrastructure";

const TABS: { key: TabKey; label: string }[] = [
  { key: "general", label: "A. General Information" },
  { key: "documents", label: "B. Documents & Info" },
  { key: "result_academics", label: "C. Result & Academics" },
  { key: "staff", label: "D. Staff (Teaching)" },
  { key: "infrastructure", label: "E. Infrastructure" },
];

export default function AdminDisclosurePage() {
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [items, setItems] = useState<DisclosureItem[]>([]);
  const [documents, setDocuments] = useState<DisclosureDocument[]>([]);
  const [boardResults, setBoardResults] = useState<DisclosureBoardResult[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const fetchData = useCallback(async () => {
    const [itemsRes, docsRes, resultsRes] = await Promise.all([
      supabase.from("disclosure_items").select("*").order("sort_order"),
      supabase.from("disclosure_documents").select("*").order("sort_order"),
      supabase
        .from("disclosure_board_results")
        .select("*")
        .order("exam_class")
        .order("sort_order"),
    ]);

    setItems((itemsRes.data as DisclosureItem[]) ?? []);
    setDocuments((docsRes.data as DisclosureDocument[]) ?? []);
    setBoardResults((resultsRes.data as DisclosureBoardResult[]) ?? []);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredItems = items.filter((i) => i.section === activeTab);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
          <ScrollText className="h-5 w-5 text-amber-600" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Mandatory Public Disclosure
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Manage CBSE mandatory disclosure information
          </p>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex flex-wrap gap-1 mb-6 p-1 bg-gray-100 dark:bg-muted rounded-lg">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-xs font-medium rounded-md transition-all ${
              activeTab === tab.key
                ? "bg-white dark:bg-card text-navy-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-navy-900 dark:hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {activeTab === "documents" ? (
            <DocumentsTab
              documents={documents}
              onRefresh={fetchData}
            />
          ) : activeTab === "result_academics" ? (
            <ResultAcademicsTab
              items={filteredItems}
              boardResults={boardResults}
              onRefresh={fetchData}
            />
          ) : (
            <TextItemsTab items={filteredItems} onRefresh={fetchData} />
          )}
        </>
      )}
    </div>
  );
}

/* ─── Text Items Tab (Sections A, D, E) ─── */

function TextItemsTab({
  items,
  onRefresh,
}: {
  items: DisclosureItem[];
  onRefresh: () => Promise<void>;
}) {
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const vals: Record<string, string> = {};
    items.forEach((item) => {
      vals[item.id] = item.value;
    });
    setEditValues(vals);
  }, [items]);

  const hasChanges = items.some(
    (item) => editValues[item.id] !== undefined && editValues[item.id] !== item.value
  );

  const handleSaveAll = async () => {
    const changed = items.filter(
      (item) => editValues[item.id] !== undefined && editValues[item.id] !== item.value
    );
    if (changed.length === 0) return;

    setSaving(true);
    const now = new Date().toISOString();
    const results = await Promise.all(
      changed.map((item) =>
        adminApi({
          action: "update",
          table: "disclosure_items",
          data: { value: editValues[item.id], updated_at: now },
          match: { column: "id", value: item.id },
        })
      )
    );

    const failed = results.filter((r) => !r.success);
    if (failed.length === 0) {
      toast.success(`Saved ${changed.length} field${changed.length > 1 ? "s" : ""}`);
      await onRefresh();
    } else {
      toast.error(`${failed.length} field(s) failed to save`);
    }
    setSaving(false);
  };

  return (
    <div className="erp-table-container p-6">
      <div className="space-y-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="pb-4 border-b border-gray-100 dark:border-gray-800 last:border-0 last:pb-0"
          >
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                {item.label}
              </Label>
              <Input
                value={editValues[item.id] ?? ""}
                onChange={(e) =>
                  setEditValues((prev) => ({
                    ...prev,
                    [item.id]: e.target.value,
                  }))
                }
                placeholder={`Enter ${item.label.toLowerCase()}`}
              />
            </div>
          </div>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="text-center py-8 text-gray-500">
          No items found for this section. Run the seed SQL to populate.
        </p>
      ) : (
        <div className="flex justify-end mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
          <Button
            onClick={handleSaveAll}
            disabled={saving || !hasChanges}
            className="bg-navy-900 hover:bg-navy-800 text-white"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Section
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── Documents Tab (Section B) ─── */

function DocumentsTab({
  documents,
  onRefresh,
}: {
  documents: DisclosureDocument[];
  onRefresh: () => Promise<void>;
}) {
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File | null>>(
    {}
  );

  const handleUpload = async (doc: DisclosureDocument) => {
    const file = pendingFiles[doc.doc_key];
    if (!file) {
      toast.error("Please select a file first");
      return;
    }

    setUploadingKey(doc.doc_key);

    try {
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const fileName = `${doc.doc_key}-${Date.now()}.${fileExt}`;
      const url = await uploadToStorage("disclosure-documents", fileName, file);

      const res = await adminFetch("/api/disclosure-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, fileName: file.name, docKey: doc.doc_key }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Uploaded "${doc.label}"`);
        setPendingFiles((prev) => ({ ...prev, [doc.doc_key]: null }));
        await onRefresh();
      } else {
        toast.error(data.error || "Upload failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    }
    setUploadingKey(null);
  };

  const handleDelete = async (doc: DisclosureDocument) => {
    if (!doc.file_url) return;
    if (!confirm(`Remove the uploaded file for "${doc.label}"?`)) return;

    setUploadingKey(doc.doc_key);
    try {
      const res = await adminDelete("/api/disclosure-documents", {
        id: doc.id,
        fileUrl: doc.file_url,
      });
      const data = await res.json();
      if (data.success) {
        toast.success("File removed");
        await onRefresh();
      } else {
        toast.error(data.error || "Failed to remove");
      }
    } catch {
      toast.error("Failed to remove");
    }
    setUploadingKey(null);
  };

  return (
    <div className="space-y-4">
      {documents.map((doc) => (
        <div
          key={doc.id}
          className="erp-table-container p-5"
        >
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-navy-900 dark:text-white truncate">
                  {doc.label}
                </p>
                {doc.file_url ? (
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      Uploaded
                    </span>
                    <span className="text-xs text-gray-400">
                      {doc.file_name}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">Not uploaded</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {doc.file_url && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(doc.file_url!, "_blank")}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(doc)}
                    disabled={uploadingKey === doc.doc_key}
                    className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    {uploadingKey === doc.doc_key ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <FileDropZone
                accept=".pdf,.jpg,.jpeg,.png"
                icon="pdf"
                onChange={(files) => {
                  const file = files?.[0] ?? null;
                  setPendingFiles((prev) => ({
                    ...prev,
                    [doc.doc_key]: file,
                  }));
                }}
                value={pendingFiles[doc.doc_key] ?? null}
                label={
                  doc.file_url
                    ? "Drop a new file to replace"
                    : "Drop file here or click to browse"
                }
                hint="PDF, JPG, or PNG. Max 10MB."
              />
            </div>
            <Button
              onClick={() => handleUpload(doc)}
              disabled={
                !pendingFiles[doc.doc_key] || uploadingKey === doc.doc_key
              }
              className="bg-navy-900 hover:bg-navy-800 text-white"
            >
              {uploadingKey === doc.doc_key ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {doc.file_url ? "Replace" : "Upload"}
            </Button>
          </div>
        </div>
      ))}
      {documents.length === 0 && (
        <div className="erp-table-container p-6">
          <p className="text-center text-gray-500">
            No document slots found. Run the seed SQL to populate.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Result & Academics Tab (Section C) ─── */

function ResultAcademicsTab({
  items,
  boardResults,
  onRefresh,
}: {
  items: DisclosureItem[];
  boardResults: DisclosureBoardResult[];
  onRefresh: () => Promise<void>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingResult, setEditingResult] =
    useState<DisclosureBoardResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Board result form state
  const [examClass, setExamClass] = useState<ExamClass>("X");
  const [academicYear, setAcademicYear] = useState("");
  const [registered, setRegistered] = useState("");
  const [passed, setPassed] = useState("");
  const [passPercentage, setPassPercentage] = useState("");
  const [remarks, setRemarks] = useState("");

  const resetForm = () => {
    setExamClass("X");
    setAcademicYear("");
    setRegistered("");
    setPassed("");
    setPassPercentage("");
    setRemarks("");
    setEditingResult(null);
  };

  const openAdd = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (r: DisclosureBoardResult) => {
    setEditingResult(r);
    setExamClass(r.exam_class);
    setAcademicYear(r.academic_year);
    setRegistered(String(r.registered));
    setPassed(String(r.passed));
    setPassPercentage(String(r.pass_percentage));
    setRemarks(r.remarks ?? "");
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!academicYear) {
      toast.error("Please enter the academic year");
      return;
    }

    setSubmitting(true);
    const data = {
      exam_class: examClass,
      academic_year: academicYear,
      registered: parseInt(registered) || 0,
      passed: parseInt(passed) || 0,
      pass_percentage: parseFloat(passPercentage) || 0,
      remarks: remarks || null,
      updated_at: new Date().toISOString(),
    };

    const result = editingResult
      ? await adminApi({
          action: "update",
          table: "disclosure_board_results",
          data,
          match: { column: "id", value: editingResult.id },
        })
      : await adminApi({
          action: "insert",
          table: "disclosure_board_results",
          data: { ...data, sort_order: boardResults.length },
        });

    if (result.success) {
      toast.success(
        editingResult ? "Result updated" : "Result added"
      );
      setDialogOpen(false);
      resetForm();
      await onRefresh();
    } else {
      toast.error(result.error || "Failed to save");
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this board result entry?")) return;
    const result = await adminApi({
      action: "delete",
      table: "disclosure_board_results",
      match: { column: "id", value: id },
    });
    if (result.success) {
      toast.success("Deleted");
      await onRefresh();
    } else {
      toast.error("Failed to delete");
    }
  };

  const classXResults = boardResults.filter((r) => r.exam_class === "X");
  const classXIIResults = boardResults.filter((r) => r.exam_class === "XII");

  return (
    <div className="space-y-6">
      {/* Text fields */}
      <TextItemsTab items={items} onRefresh={onRefresh} />

      {/* Board Results */}
      <div className="erp-table-container p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading text-lg font-bold text-navy-900 dark:text-white">
            Last Three-Year Board Examination Results
          </h2>
          <Button
            onClick={openAdd}
            className="bg-navy-900 hover:bg-navy-800 text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Result
          </Button>
        </div>

        {/* Class X */}
        <h3 className="text-sm font-semibold text-navy-800 dark:text-gray-200 mb-2 mt-4">
          Class X
        </h3>
        {classXResults.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Academic Year</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead>Passed</TableHead>
                <TableHead>Pass %</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classXResults.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.academic_year}
                  </TableCell>
                  <TableCell>{r.registered}</TableCell>
                  <TableCell>{r.passed}</TableCell>
                  <TableCell>{r.pass_percentage}%</TableCell>
                  <TableCell className="text-gray-500">
                    {r.remarks || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(r)}
                        aria-label="Edit Class X result"
                        className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(r.id)}
                        aria-label="Delete Class X result"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-gray-400 py-3">
            No Class X results added yet.
          </p>
        )}

        {/* Class XII */}
        <h3 className="text-sm font-semibold text-navy-800 dark:text-gray-200 mb-2 mt-6">
          Class XII
        </h3>
        {classXIIResults.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Academic Year</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead>Passed</TableHead>
                <TableHead>Pass %</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classXIIResults.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.academic_year}
                  </TableCell>
                  <TableCell>{r.registered}</TableCell>
                  <TableCell>{r.passed}</TableCell>
                  <TableCell>{r.pass_percentage}%</TableCell>
                  <TableCell className="text-gray-500">
                    {r.remarks || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(r)}
                        aria-label="Edit Class XII result"
                        className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(r.id)}
                        aria-label="Delete Class XII result"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-gray-400 py-3">
            No Class XII results added yet.
          </p>
        )}
      </div>

      {/* Add/Edit Board Result Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
                <ScrollText className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <DialogTitle>
                  {editingResult ? "Edit Board Result" : "Add Board Result"}
                </DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Enter board examination result data
                </p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Class</Label>
                <Select
                  value={examClass}
                  onValueChange={(val) => val && setExamClass(val as ExamClass)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="X">Class X</SelectItem>
                    <SelectItem value="XII">Class XII</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Academic Year</Label>
                <Input
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  placeholder="e.g. 2023-24"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Registered</Label>
                <Input
                  type="number"
                  value={registered}
                  onChange={(e) => setRegistered(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Passed</Label>
                <Input
                  type="number"
                  value={passed}
                  onChange={(e) => setPassed(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Pass %</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={passPercentage}
                  onChange={(e) => setPassPercentage(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Remarks (optional)</Label>
              <Input
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Any additional notes"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-navy-900 hover:bg-navy-800 text-white"
              >
                {submitting && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {editingResult ? "Update" : "Add Result"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
