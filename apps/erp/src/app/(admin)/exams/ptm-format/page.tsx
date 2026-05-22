"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { Input } from "@nkps/shared/components/ui/input";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Download,
  Plus,
  Trash2,
  FileText,
  Star,
} from "lucide-react";
import { formatClassName } from "@nkps/shared/lib/utils";
import type { Class, ExamType } from "@nkps/shared/types";

interface PtmFormat {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  intro_text: string | null;
  closing_text: string | null;
  show_student_details: boolean;
  show_photo: boolean;
  show_father_name: boolean;
  show_mother_name: boolean;
  show_performance_snapshot: boolean;
  show_teacher_remarks_section: boolean;
  teacher_remarks_lines: number;
  show_parent_signature: boolean;
  signature_labels: string[];
}

function blankTemplate(): PtmFormat {
  return {
    id: "__new__",
    name: "New Template",
    is_default: false,
    is_active: true,
    intro_text: "",
    closing_text: "",
    show_student_details: true,
    show_photo: false,
    show_father_name: true,
    show_mother_name: true,
    show_performance_snapshot: true,
    show_teacher_remarks_section: true,
    teacher_remarks_lines: 6,
    show_parent_signature: true,
    signature_labels: ["Class Teacher", "Parent Signature"],
  };
}

export default function AdminPtmFormatPage() {
  const [templates, setTemplates] = useState<PtmFormat[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<PtmFormat | null>(null);

  const [classes, setClasses] = useState<Class[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [genClassId, setGenClassId] = useState("");
  const [genExamId, setGenExamId] = useState<string>("__none__");
  const [genTemplateId, setGenTemplateId] = useState<string>("__default__");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      const supabase = createClient();

      const { data: currentYear } = await supabase
        .from("academic_years")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();

      if (currentYear) {
        const { data: cls } = await supabase
          .from("classes")
          .select("*, streams:stream_id(name)")
          .eq("academic_year_id", currentYear.id)
          .order("sort_order", { ascending: true });
        setClasses((cls ?? []) as unknown as Class[]);

        const { data: et } = await supabase
          .from("exam_types")
          .select("*")
          .eq("academic_year_id", currentYear.id)
          .order("sort_order", { ascending: true });
        setExamTypes((et ?? []) as ExamType[]);
      }

      const res = await fetch("/api/ptm-formats");
      const body = (await res.json()) as { data: PtmFormat[] };
      const list = body.data ?? [];
      setTemplates(list);
      const firstId =
        list.find((t) => t.is_default)?.id ?? list[0]?.id ?? "";
      setSelectedId(firstId);
      setLoading(false);
    }
    bootstrap();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDraft(null);
      return;
    }
    if (selectedId === "__new__") {
      setDraft(blankTemplate());
      return;
    }
    const found = templates.find((t) => t.id === selectedId);
    if (found) setDraft({ ...found });
  }, [selectedId, templates]);

  function patch(p: Partial<PtmFormat>) {
    setDraft((prev) => (prev ? { ...prev, ...p } : prev));
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const body = {
        name: draft.name,
        is_default: draft.is_default,
        is_active: draft.is_active,
        intro_text: draft.intro_text,
        closing_text: draft.closing_text,
        show_student_details: draft.show_student_details,
        show_photo: draft.show_photo,
        show_father_name: draft.show_father_name,
        show_mother_name: draft.show_mother_name,
        show_performance_snapshot: draft.show_performance_snapshot,
        show_teacher_remarks_section: draft.show_teacher_remarks_section,
        teacher_remarks_lines: draft.teacher_remarks_lines,
        show_parent_signature: draft.show_parent_signature,
        signature_labels: draft.signature_labels,
      };
      const isNew = draft.id === "__new__";
      const res = await fetch(
        isNew
          ? "/api/ptm-formats"
          : `/api/ptm-formats/${draft.id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: await getAuthHeader(),
          },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to save");
        return;
      }
      toast.success(isNew ? "Template created" : "Template saved");
      // Reload list
      const listRes = await fetch("/api/ptm-formats");
      const listBody = (await listRes.json()) as { data: PtmFormat[] };
      setTemplates(listBody.data ?? []);
      setSelectedId(data.data.id);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft || draft.id === "__new__") return;
    if (!confirm(`Delete template "${draft.name}"?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/ptm-formats/${draft.id}`, {
        method: "DELETE",
        headers: { Authorization: await getAuthHeader() },
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to delete");
        return;
      }
      toast.success("Template deleted");
      const listRes = await fetch("/api/ptm-formats");
      const listBody = (await listRes.json()) as { data: PtmFormat[] };
      const next = listBody.data ?? [];
      setTemplates(next);
      setSelectedId(next[0]?.id ?? "");
    } finally {
      setDeleting(false);
    }
  }

  async function handleGenerate() {
    if (!genClassId) return;
    setGenerating(true);
    try {
      const qs = new URLSearchParams({ class_id: genClassId });
      if (genExamId !== "__none__") qs.set("exam_type_id", genExamId);
      if (genTemplateId !== "__default__")
        qs.set("template_id", genTemplateId);
      const res = await fetch(`/api/ptm-format/pdf?${qs.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to generate");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? "ptm-format.pdf";
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } finally {
      setGenerating(false);
    }
  }

  const canGenerate = useMemo(
    () => Boolean(genClassId) && !generating,
    [genClassId, generating]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-gold-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          PTM Format
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Configure the printable handout given to parents before a
          parent-teacher meeting, and generate per-student copies for a
          class.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Template list */}
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-navy-900 dark:text-gold-500" />
              Templates
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedId("__new__")}
            >
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {templates.map((t) => {
                const active = selectedId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2 ${
                      active
                        ? "bg-navy-900 text-white"
                        : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    <span className="truncate">{t.name}</span>
                    <span className="flex items-center gap-1">
                      {t.is_default ? (
                        <Star
                          className={`h-3.5 w-3.5 ${active ? "text-yellow-300" : "text-yellow-500"}`}
                          fill="currentColor"
                        />
                      ) : null}
                      {!t.is_active ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1 py-0"
                        >
                          off
                        </Badge>
                      ) : null}
                    </span>
                  </button>
                );
              })}
              {templates.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 py-2">
                  No templates yet. Click &quot;New&quot; to create one.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Template editor */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              {draft
                ? draft.id === "__new__"
                  ? "New template"
                  : `Edit: ${draft.name}`
                : "Select a template"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!draft ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Pick a template from the list, or create a new one.
              </p>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">
                      Name
                    </label>
                    <Input
                      value={draft.name}
                      onChange={(e) => patch({ name: e.target.value })}
                    />
                  </div>
                  <div className="flex items-end gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.is_default}
                        onChange={(e) =>
                          patch({ is_default: e.target.checked })
                        }
                      />
                      Default
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.is_active}
                        onChange={(e) =>
                          patch({ is_active: e.target.checked })
                        }
                      />
                      Active
                    </label>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Intro text
                  </label>
                  <textarea
                    rows={3}
                    className="w-full rounded-md border border-gray-200 dark:border-border bg-white dark:bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500"
                    value={draft.intro_text ?? ""}
                    onChange={(e) => patch({ intro_text: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Closing text
                  </label>
                  <textarea
                    rows={2}
                    className="w-full rounded-md border border-gray-200 dark:border-border bg-white dark:bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500"
                    value={draft.closing_text ?? ""}
                    onChange={(e) => patch({ closing_text: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    ["show_student_details", "Student details"],
                    ["show_photo", "Photo"],
                    ["show_father_name", "Father's name"],
                    ["show_mother_name", "Mother's name"],
                    ["show_performance_snapshot", "Performance snapshot"],
                    ["show_teacher_remarks_section", "Teacher remarks"],
                    ["show_parent_signature", "Parent signature"],
                  ].map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={
                          (draft[key as keyof PtmFormat] as boolean) ?? false
                        }
                        onChange={(e) =>
                          patch({
                            [key]: e.target.checked,
                          } as Partial<PtmFormat>)
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Blank remark lines (0–20)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    value={draft.teacher_remarks_lines}
                    onChange={(e) =>
                      patch({
                        teacher_remarks_lines: Math.max(
                          0,
                          Math.min(
                            20,
                            Number.parseInt(e.target.value, 10) || 0
                          )
                        ),
                      })
                    }
                    className="w-28"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Signature labels (comma-separated)
                  </label>
                  <Input
                    value={draft.signature_labels.join(", ")}
                    onChange={(e) =>
                      patch({
                        signature_labels: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-gray-800">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDelete}
                    disabled={
                      draft.id === "__new__" ||
                      deleting ||
                      templates.length <= 1
                    }
                    className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {deleting ? "Deleting…" : "Delete"}
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    {saving ? "Saving…" : "Save template"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Generator */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4 text-navy-900 dark:text-gold-500" />
            Generate PDF
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Class</label>
              <Select
                value={genClassId}
                onValueChange={(v) => setGenClassId(v ?? "")}
                items={classes.map((c) => ({
                  value: c.id,
                  label: formatClassName(c),
                }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select class" />
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
              <label className="text-sm font-medium mb-1.5 block">
                Exam (performance snapshot)
              </label>
              <Select
                value={genExamId}
                onValueChange={(v) => setGenExamId(v ?? "__none__")}
                items={[
                  { value: "__none__", label: "(Skip performance snapshot)" },
                  ...examTypes.map((e) => ({ value: e.id, label: e.name })),
                ]}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" label="(Skip performance snapshot)">
                    (Skip performance snapshot)
                  </SelectItem>
                  {examTypes.map((e) => (
                    <SelectItem key={e.id} value={e.id} label={e.name}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Template
              </label>
              <Select
                value={genTemplateId}
                onValueChange={(v) => setGenTemplateId(v ?? "__default__")}
                items={[
                  { value: "__default__", label: "(Use default)" },
                  ...templates
                    .filter((t) => t.is_active)
                    .map((t) => ({
                      value: t.id,
                      label: `${t.name}${t.is_default ? " · default" : ""}`,
                    })),
                ]}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__" label="(Use default)">
                    (Use default)
                  </SelectItem>
                  {templates
                    .filter((t) => t.is_active)
                    .map((t) => (
                      <SelectItem
                        key={t.id}
                        value={t.id}
                        label={`${t.name}${t.is_default ? " · default" : ""}`}
                      >
                        {t.name}
                        {t.is_default ? " · default" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end">
            <Button onClick={handleGenerate} disabled={!canGenerate}>
              {generating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {generating ? "Generating…" : "Download PDF"}
            </Button>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3">
            One page per enrolled student. Performance snapshot is
            class-scope only; select an exam to include subject marks.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

async function getAuthHeader(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ? `Bearer ${session.access_token}` : "";
}
