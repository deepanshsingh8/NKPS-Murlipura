"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
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
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type {
  ResultMaster,
  ResultMasterSubject,
  ResultMasterSubjectRole,
  Subject,
} from "@nkps/shared/types";

interface SubjectRow {
  subject_id: string;
  subject_name: string;
  included: boolean;
  role: ResultMasterSubjectRole;
  pass_mark_value_override: number | ""; // "" = blank = use master default
  sort_order: number;
}

export function SubjectsTab({
  master,
  rows,
  classId,
  onSaved,
}: {
  master: ResultMaster;
  rows: ResultMasterSubject[];
  classId: string;
  onSaved: () => Promise<void>;
}) {
  const [classSubjects, setClassSubjects] = useState<Subject[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [form, setForm] = useState<SubjectRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Load class-scoped subjects via Supabase (authenticated-read RLS). Mirrors
  // the pattern in src/app/erp/exams/timetable/page.tsx.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingSubjects(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("class_subjects")
        .select("subjects(id, name, code, is_active, is_elective, created_at)")
        .eq("class_id", classId);
      if (cancelled) return;
      // Supabase's generated types pick an array shape for the embedded
      // relation, but with a singular FK the runtime value is a single row.
      const subs = (
        (data ?? []) as unknown as { subjects: Subject | null }[]
      )
        .map((cs) => cs.subjects)
        .filter((s): s is Subject => Boolean(s));
      subs.sort((a, b) => a.name.localeCompare(b.name));
      setClassSubjects(subs);
      setLoadingSubjects(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [classId]);

  // Merge the master's existing subject rows with the class subject list.
  useEffect(() => {
    const byId = new Map(rows.map((r) => [r.subject_id, r]));
    const merged: SubjectRow[] = classSubjects.map((s, idx) => {
      const existing = byId.get(s.id);
      return {
        subject_id: s.id,
        subject_name: s.name,
        included: Boolean(existing),
        role: existing?.role ?? "main",
        pass_mark_value_override:
          existing?.pass_mark_value_override === null ||
          existing?.pass_mark_value_override === undefined
            ? ""
            : existing.pass_mark_value_override,
        sort_order: existing?.sort_order ?? idx,
      };
    });
    merged.sort((a, b) => {
      if (a.included !== b.included) return a.included ? -1 : 1;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.subject_name.localeCompare(b.subject_name);
    });
    setForm(merged);
  }, [classSubjects, rows]);

  const unit = master.pass_mark_mode === "percentage" ? "%" : "marks";
  const masterValueStr = `${master.pass_mark_value}${
    master.pass_mark_mode === "percentage" ? "%" : " marks"
  }`;

  const updateRow = (subject_id: string, patch: Partial<SubjectRow>) => {
    setForm((prev) =>
      prev.map((r) =>
        r.subject_id === subject_id ? { ...r, ...patch } : r
      )
    );
  };

  const includedCount = form.filter((r) => r.included).length;
  const mainCount = form.filter((r) => r.included && r.role === "main").length;

  const validationError = useMemo(() => {
    if (form.length === 0) return null;
    if (mainCount === 0) {
      return "At least one main subject is required.";
    }
    for (const r of form) {
      if (!r.included) continue;
      if (r.pass_mark_value_override === "") continue;
      const v = Number(r.pass_mark_value_override);
      if (!Number.isFinite(v) || v < 0) {
        return `Invalid override for ${r.subject_name}.`;
      }
      if (master.pass_mark_mode === "percentage" && v > 100) {
        return `Override for ${r.subject_name} must be ≤ 100%.`;
      }
    }
    return null;
  }, [form, mainCount, master.pass_mark_mode]);

  const handleSave = async () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        subjects: form
          .filter((r) => r.included)
          .map((r) => ({
            subject_id: r.subject_id,
            role: r.role,
            pass_mark_value_override:
              r.pass_mark_value_override === ""
                ? null
                : Number(r.pass_mark_value_override),
            sort_order: Number(r.sort_order) || 0,
          })),
      };
      const res = await adminFetch(
        `/api/result-masters/${master.id}/subjects`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Failed to save subjects");
        return;
      }
      toast.success(
        `Saved ${payload.subjects.length} subject${payload.subjects.length === 1 ? "" : "s"}`
      );
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (loadingSubjects) {
    return (
      <Card className="bg-white dark:bg-card rounded-2xl">
        <CardContent className="py-10 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-navy-900 dark:text-white" />
        </CardContent>
      </Card>
    );
  }

  if (classSubjects.length === 0) {
    return (
      <Card className="bg-white dark:bg-card rounded-2xl">
        <CardContent className="py-10 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No subjects are assigned to this class yet. Add them under
            Academics → Subjects first, then return here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white dark:bg-card rounded-2xl">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base font-heading">
              Subjects ({includedCount} of {classSubjects.length})
            </CardTitle>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Pick which subjects appear on the final result and whether they
              count toward the main aggregate. Leave the override blank to use
              the master pass mark ({masterValueStr}).
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-gray-200 dark:border-border overflow-hidden">
          <div className="grid grid-cols-[48px_minmax(140px,2fr)_140px_140px_110px] gap-2 px-3 py-2 bg-gray-50 dark:bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <span>Incl.</span>
            <span>Subject</span>
            <span>Role</span>
            <span>{unit === "%" ? "% override" : "Marks override"}</span>
            <span>Sort</span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-border">
            {form.map((row) => (
              <div
                key={row.subject_id}
                className="grid grid-cols-[48px_minmax(140px,2fr)_140px_140px_110px] gap-2 px-3 py-2 items-center"
              >
                <Checkbox
                  checked={row.included}
                  onCheckedChange={(v) =>
                    updateRow(row.subject_id, { included: Boolean(v) })
                  }
                />
                <span className="text-sm truncate" title={row.subject_name}>
                  {row.subject_name}
                </span>
                <Select
                  value={row.role}
                  items={[
                    { value: "main", label: "Main" },
                    { value: "optional", label: "Optional" },
                  ]}
                  onValueChange={(v) => {
                    if (!v) return;
                    updateRow(row.subject_id, {
                      role: v as ResultMasterSubjectRole,
                    });
                  }}
                  disabled={!row.included}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue>
                      {row.role === "main" ? "Main" : "Optional"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectItem value="main" label="Main">
                      Main
                    </SelectItem>
                    <SelectItem value="optional" label="Optional">
                      Optional
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  step="0.5"
                  min={0}
                  max={master.pass_mark_mode === "percentage" ? 100 : undefined}
                  value={row.pass_mark_value_override}
                  onChange={(e) =>
                    updateRow(row.subject_id, {
                      pass_mark_value_override:
                        e.target.value === "" ? "" : Number(e.target.value),
                    })
                  }
                  disabled={!row.included}
                  placeholder={`(${master.pass_mark_value})`}
                  className="font-mono"
                  title={`Leave blank to use the master pass mark (${masterValueStr}).`}
                />
                <Input
                  type="number"
                  min={0}
                  step="1"
                  value={row.sort_order}
                  onChange={(e) =>
                    updateRow(row.subject_id, {
                      sort_order: Number(e.target.value) || 0,
                    })
                  }
                  disabled={!row.included}
                  className="font-mono"
                />
              </div>
            ))}
          </div>
        </div>

        {validationError && (
          <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            {validationError}
          </p>
        )}

        <div className="flex items-center justify-between pt-2">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {mainCount} main · {includedCount - mainCount} optional
          </p>
          <Button
            onClick={handleSave}
            disabled={saving || Boolean(validationError)}
            className="bg-navy-900 text-white hover:bg-navy-900/90"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Subjects
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
