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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  FileText,
  Upload,
  Trash2,
  Plus,
  ExternalLink,
  NotebookPen,
} from "lucide-react";
import { adminFetch, adminDelete } from "@nkps/shared/lib/admin-api";
import { uploadToStorage } from "@nkps/shared/lib/supabase/upload";
import { FileDropZone } from "@nkps/shared/components/FileDropZone";
import { AcademicYearSelect } from "@nkps/shared/components/AcademicYearSelect";
import {
  HOLIDAY_HOMEWORK_CLASSES,
  HOLIDAY_HOMEWORK_SESSIONS,
} from "@nkps/shared/lib/constants";
import type { HolidayHomework } from "@nkps/shared/types";

const CLASS_INDEX = new Map<string, number>(
  HOLIDAY_HOMEWORK_CLASSES.map((c, i) => [c, i])
);

export default function AdminHolidayHomeworkPage() {
  const [items, setItems] = useState<HolidayHomework[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [classGrade, setClassGrade] = useState<string>(
    HOLIDAY_HOMEWORK_CLASSES[0]
  );
  const [session, setSession] = useState<string>(HOLIDAY_HOMEWORK_SESSIONS[0]);
  const [academicYear, setAcademicYear] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const supabase = createClient();

  const fetchData = useCallback(async () => {
    const { data } = await supabase
      .from("holiday_homework")
      .select("*")
      .order("sort_order");
    setItems((data as HolidayHomework[]) ?? []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const resetForm = () => {
    setTitle("");
    setClassGrade(HOLIDAY_HOMEWORK_CLASSES[0]);
    setSession(HOLIDAY_HOMEWORK_SESSIONS[0]);
    setAcademicYear("");
    setFile(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Please enter a title");
      return;
    }
    if (!academicYear) {
      toast.error("Please select an academic year");
      return;
    }
    if (!file) {
      toast.error("Please select a PDF file");
      return;
    }

    setSubmitting(true);
    try {
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const fileName = `homework-${Date.now()}.${fileExt}`;
      const url = await uploadToStorage("holiday-homework", fileName, file);

      const res = await adminFetch("/api/holiday-homework", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          fileName: file.name,
          title: title.trim(),
          classGrade,
          session,
          academicYear,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Added homework for Class ${classGrade}`);
        setDialogOpen(false);
        resetForm();
        await fetchData();
      } else {
        toast.error(data.error || "Upload failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    }
    setSubmitting(false);
  };

  const handleDelete = async (item: HolidayHomework) => {
    if (!confirm(`Delete "${item.title}" (Class ${item.class_grade})?`)) return;
    setDeletingId(item.id);
    try {
      const res = await adminDelete("/api/holiday-homework", {
        id: item.id,
        fileUrl: item.file_url,
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Deleted");
        await fetchData();
      } else {
        toast.error(data.error || "Failed to delete");
      }
    } catch {
      toast.error("Failed to delete");
    }
    setDeletingId(null);
  };

  // Group by class, ordered Nursery → XII (unknown classes sorted last).
  const classesPresent = Array.from(new Set(items.map((i) => i.class_grade))).sort(
    (a, b) =>
      (CLASS_INDEX.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (CLASS_INDEX.get(b) ?? Number.MAX_SAFE_INTEGER)
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
            <NotebookPen className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
              Holiday Homework
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Manage per-class holiday homework PDFs
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setDialogOpen(true);
          }}
          className="bg-navy-900 hover:bg-navy-800 text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Homework
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : items.length === 0 ? (
        <div className="erp-table-container p-10 text-center">
          <p className="text-gray-500">
            No holiday homework yet. Click &ldquo;Add Homework&rdquo; to upload a PDF.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {classesPresent.map((cls) => (
            <div key={cls}>
              <h2 className="text-sm font-semibold text-navy-800 dark:text-gray-200 mb-2">
                Class {cls}
              </h2>
              <div className="space-y-3">
                {items
                  .filter((i) => i.class_grade === cls)
                  .map((item) => (
                    <div key={item.id} className="erp-table-container p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                            <FileText className="h-4 w-4 text-blue-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-navy-900 dark:text-white truncate">
                              {item.title}
                            </p>
                            <span className="text-xs text-gray-400">
                              {item.session} · {item.academic_year}
                              {item.file_name ? ` · ${item.file_name}` : ""}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(item.file_url, "_blank")}
                          >
                            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                            View
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(item)}
                            disabled={deletingId === item.id}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            {deletingId === item.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
                <NotebookPen className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <DialogTitle>Add Holiday Homework</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Upload a PDF for a class and break
                </p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Summer Break Homework"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Class</Label>
                <Select
                  value={classGrade}
                  onValueChange={(val) => val && setClassGrade(val)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOLIDAY_HOMEWORK_CLASSES.map((c) => (
                      <SelectItem key={c} value={c}>
                        Class {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Break</Label>
                <Select
                  value={session}
                  onValueChange={(val) => val && setSession(val)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOLIDAY_HOMEWORK_SESSIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Academic Year</Label>
              <AcademicYearSelect
                value={academicYear}
                onChange={setAcademicYear}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">PDF File</Label>
              <FileDropZone
                accept=".pdf"
                icon="pdf"
                onChange={(files) => setFile(files?.[0] ?? null)}
                value={file}
                label="Drop PDF here or click to browse"
                hint="PDF only. Max 10MB."
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
                {submitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Upload
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
