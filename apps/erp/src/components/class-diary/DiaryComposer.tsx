"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Paperclip, Send, X, FileText, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nkps/shared/components/ui/dialog";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Textarea } from "@nkps/shared/components/ui/textarea";
import { NativeSelect } from "@nkps/shared/components/ui/native-select";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import { Field, FieldHint, FieldRow } from "@nkps/shared/components/ui/field";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { compressImage, swapToWebpExtension } from "@nkps/shared/lib/image-compress";
import { todayISO } from "@nkps/shared/lib/date";
import { cn } from "@nkps/shared/lib/utils";
import { KIND_META, KIND_ORDER, type DiaryKind, type DiaryPost } from "./shared";

const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf,.heic,.pdf";

interface PendingFile {
  path: string;
  name: string;
  type: string;
  size: number;
}

export interface ComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classes: { id: string; label: string }[];
  subjectsByClass: Record<string, { id: string; name: string }[]>;
  canPostSchoolWide: boolean;
  /** Pre-selected class (the board's current filter). */
  defaultClassId?: string | null;
  /** Editing an existing post rather than writing a new one. */
  editing?: DiaryPost | null;
  onSaved: () => void;
}

export function DiaryComposer({
  open,
  onOpenChange,
  classes,
  subjectsByClass,
  canPostSchoolWide,
  defaultClassId,
  editing,
  onSaved,
}: ComposerProps) {
  const [kind, setKind] = useState<DiaryKind>("homework");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [schoolWide, setSchoolWide] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [postDate, setPostDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [pinned, setPinned] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Reset whenever the dialog opens, from the post being edited if any.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setKind(editing.kind);
      setClassIds(editing.class_id ? [editing.class_id] : []);
      setSchoolWide(editing.class_id === null);
      setSubjectId(editing.subject_id ?? "");
      setTitle(editing.title);
      setBody(editing.body);
      setPostDate(editing.post_date);
      setDueDate(editing.due_date ?? "");
      setPinned(editing.is_pinned);
      setFiles(editing.attachments.map(({ path, name, type, size }) => ({ path, name, type, size })));
    } else {
      setKind("homework");
      const preset =
        defaultClassId && classes.some((c) => c.id === defaultClassId)
          ? [defaultClassId]
          : classes.length === 1
            ? [classes[0].id]
            : [];
      setClassIds(preset);
      setSchoolWide(false);
      setSubjectId("");
      setTitle("");
      setBody("");
      setPostDate(todayISO());
      setDueDate("");
      setPinned(false);
      setFiles([]);
    }
  }, [open, editing, defaultClassId, classes]);

  const isHomework = kind === "homework" || kind === "holiday_homework";

  // A subject only makes sense for one class; across several the subject lists
  // differ, so the picker is offered only when exactly one class is chosen.
  const subjects = useMemo(
    () => (!schoolWide && classIds.length === 1 ? subjectsByClass[classIds[0]] ?? [] : []),
    [schoolWide, classIds, subjectsByClass]
  );

  const toggleClass = (id: string) =>
    setClassIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  async function uploadOne(original: File): Promise<PendingFile | null> {
    // Phone photos are 3–6 MB; the re-encode brings them to a few hundred KB,
    // which is what makes a 30-photo function album viable on a parent's data
    // plan. PDFs pass through untouched.
    const file = await compressImage(original);
    const name = file === original ? original.name : swapToWebpExtension(original.name);
    if (file.size > MAX_BYTES) {
      toast.error(`${original.name} is larger than 10 MB`);
      return null;
    }
    const res = await adminFetch("/api/class-diary/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: name, size: file.size }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? `Could not upload ${original.name}`);
      return null;
    }
    const supabase = createClient();
    const { error } = await supabase.storage
      .from("class-diary")
      .uploadToSignedUrl(data.path, data.token, file, { contentType: data.contentType });
    if (error) {
      toast.error(`Could not upload ${original.name}: ${error.message}`);
      return null;
    }
    return { path: data.path, name, type: data.contentType, size: file.size };
  }

  async function onPickFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const picked = Array.from(list).slice(0, Math.max(0, MAX_FILES - files.length));
    if (picked.length < list.length) toast.warning(`Up to ${MAX_FILES} files per post`);
    setUploading((n) => n + picked.length);
    await Promise.all(
      picked.map(async (f) => {
        try {
          const done = await uploadOne(f);
          if (done) setFiles((prev) => [...prev, done]);
        } finally {
          setUploading((n) => n - 1);
        }
      })
    );
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit() {
    if (!title.trim()) {
      toast.error("Add a title");
      return;
    }
    if (!editing && !schoolWide && classIds.length === 0) {
      toast.error("Pick at least one class");
      return;
    }
    if (dueDate && dueDate < postDate) {
      toast.error("The due date is before the post date");
      return;
    }
    setSaving(true);
    try {
      const common = {
        kind,
        title: title.trim(),
        body,
        subject_id: subjects.length > 0 && subjectId ? subjectId : null,
        post_date: postDate,
        due_date: isHomework && dueDate ? dueDate : null,
        attachments: files,
        is_pinned: pinned,
      };
      const res = editing
        ? await adminFetch(`/api/class-diary/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(canPostSchoolWide ? common : { ...common, is_pinned: undefined }),
          })
        : await adminFetch("/api/class-diary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...common,
              class_ids: schoolWide ? [] : classIds,
              school_wide: schoolWide,
            }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not save");
        return;
      }
      toast.success(
        editing
          ? "Post updated"
          : data.count > 1
            ? `Posted to ${data.count} classes`
            : "Posted"
      );
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit post" : "New post"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Changes show up for families the next time they open the diary."
              : "Families of every student in the chosen classes see this in their portal."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <Label>Type</Label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type">
              {KIND_ORDER.map((k) => {
                const meta = KIND_META[k];
                const Icon = meta.icon;
                const active = kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setKind(k)}
                    className={cn(
                      "inline-flex min-h-11 sm:min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                      active
                        ? "border-navy-900 bg-navy-900 text-white dark:border-gold-500 dark:bg-gold-500 dark:text-navy-900"
                        : "border-gray-200 dark:border-border text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-muted"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </Field>

          {!editing && (
            <Field>
              <Label>Classes</Label>
              {canPostSchoolWide && (
                <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={schoolWide}
                    onCheckedChange={(v) => setSchoolWide(v === true)}
                  />
                  Whole school (every family)
                </label>
              )}
              {!schoolWide && (
                <div className="max-h-48 overflow-y-auto rounded-xl border border-gray-200 dark:border-border p-2">
                  {classes.length === 0 ? (
                    <p className="p-2 text-sm text-gray-500">
                      You are not assigned to any class this session.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                      {classes.map((c) => (
                        <label
                          key={c.id}
                          className="flex min-h-11 sm:min-h-9 items-center gap-2 rounded-lg px-2 text-sm hover:bg-gray-50 dark:hover:bg-muted"
                        >
                          <Checkbox
                            checked={classIds.includes(c.id)}
                            onCheckedChange={() => toggleClass(c.id)}
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!schoolWide && classIds.length > 1 && (
                <FieldHint>
                  Posted to {classIds.length} classes — each class gets its own copy.
                </FieldHint>
              )}
            </Field>
          )}

          {isHomework && subjects.length > 0 && (
            <Field>
              <Label htmlFor="diary-subject">Subject</Label>
              <NativeSelect
                id="diary-subject"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="w-full"
              >
                <option value="">— Not subject-specific —</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}

          <Field>
            <Label htmlFor="diary-title">Title</Label>
            <Input
              id="diary-title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                kind === "homework"
                  ? "e.g. Maths — Exercise 4.2, Q1–10"
                  : kind === "fee_reminder"
                    ? "e.g. Second instalment due 10 October"
                    : kind === "photos"
                      ? "e.g. Annual Day 2026"
                      : "e.g. School closed on Friday"
              }
            />
          </Field>

          <Field>
            <Label htmlFor="diary-body">Details</Label>
            <Textarea
              id="diary-body"
              value={body}
              maxLength={5000}
              rows={5}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write it the way you would in the class group."
            />
          </Field>

          <FieldRow>
            <Field>
              <Label htmlFor="diary-date">Date</Label>
              <Input
                id="diary-date"
                type="date"
                value={postDate}
                onChange={(e) => setPostDate(e.target.value)}
              />
            </Field>
            {isHomework && (
              <Field>
                <Label htmlFor="diary-due">Submit by (optional)</Label>
                <Input
                  id="diary-due"
                  type="date"
                  value={dueDate}
                  min={postDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Field>
            )}
          </FieldRow>

          <Field>
            <Label>Photos &amp; files</Label>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => onPickFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={files.length >= MAX_FILES || uploading > 0}
              className="w-full sm:w-auto"
            >
              {uploading > 0 ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4 mr-2" />
              )}
              {uploading > 0 ? `Uploading ${uploading}…` : "Attach photos or PDFs"}
            </Button>
            <FieldHint>Up to {MAX_FILES} files, 10 MB each. Photos are resized for phones.</FieldHint>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {files.map((f) => (
                  <li
                    key={f.path}
                    className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 dark:border-border px-3 text-sm"
                  >
                    {f.type.startsWith("image/") ? (
                      <ImageIcon className="h-4 w-4 shrink-0 text-gray-500" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-gray-500" />
                    )}
                    <span className="truncate">{f.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setFiles((prev) => prev.filter((p) => p.path !== f.path))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Field>

          {canPostSchoolWide && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox checked={pinned} onCheckedChange={(v) => setPinned(v === true)} />
              Pin to the top of the diary
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving || uploading > 0}
            className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {editing ? "Save" : "Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
