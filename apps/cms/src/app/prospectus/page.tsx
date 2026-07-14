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
import { toast } from "sonner";
import {
  Loader2,
  FileText,
  Upload,
  Trash2,
  Plus,
  ExternalLink,
  BookText,
} from "lucide-react";
import { adminFetch, adminDelete } from "@nkps/shared/lib/admin-api";
import { uploadToStorage } from "@nkps/shared/lib/supabase/upload";
import { FileDropZone } from "@nkps/shared/components/FileDropZone";
import type { ProspectusDocument } from "@nkps/shared/types";

export default function AdminProspectusPage() {
  const [documents, setDocuments] = useState<ProspectusDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const supabase = createClient();

  const fetchData = useCallback(async () => {
    const { data } = await supabase
      .from("prospectus_documents")
      .select("*")
      .order("sort_order");
    setDocuments((data as ProspectusDocument[]) ?? []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const resetForm = () => {
    setTitle("");
    setFile(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Please enter a title");
      return;
    }
    if (!file) {
      toast.error("Please select a PDF file");
      return;
    }

    setSubmitting(true);
    try {
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const fileName = `prospectus-${Date.now()}.${fileExt}`;
      const url = await uploadToStorage("prospectus", fileName, file);

      const res = await adminFetch("/api/prospectus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, fileName: file.name, title: title.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Added "${title.trim()}"`);
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

  const handleDelete = async (doc: ProspectusDocument) => {
    if (!confirm(`Delete "${doc.title}"?`)) return;
    setDeletingId(doc.id);
    try {
      const res = await adminDelete("/api/prospectus", {
        id: doc.id,
        fileUrl: doc.file_url,
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

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
            <BookText className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
              Prospectus
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Manage downloadable prospectus documents
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
          Add Document
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : documents.length === 0 ? (
        <div className="erp-table-container p-10 text-center">
          <p className="text-gray-500">
            No prospectus documents yet. Click &ldquo;Add Document&rdquo; to upload one.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <div key={doc.id} className="erp-table-container p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                    <FileText className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-navy-900 dark:text-white truncate">
                      {doc.title}
                    </p>
                    <span className="text-xs text-gray-400">
                      {doc.file_name}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(doc.file_url, "_blank")}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(doc)}
                    disabled={deletingId === doc.id}
                    className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    {deletingId === doc.id ? (
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
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
                <BookText className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <DialogTitle>Add Prospectus Document</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Upload a PDF for visitors to download
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
                placeholder="e.g. Prospectus 2026-27"
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
