"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nkps/shared/components/ui/dialog";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Loader2,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Users,
  CheckCircle2,
  CalendarCheck,
} from "lucide-react";
import { toast } from "sonner";
import { formatClassName } from "@nkps/shared/lib/utils";
import { adminFetch, adminDelete } from "@nkps/shared/lib/admin-api";
import type { Class, ExamType } from "@nkps/shared/types";

interface PublishStatus {
  total: number;
  published: number;
}

interface MarksheetVersion {
  id: string;
  version: number;
  published_at: string;
  unpublished_at: string | null;
  unpublish_reason: string | null;
}

interface StudentMarksheetRow {
  student_id: string;
  roll_number: number | null;
  full_name: string;
  admission_no: string;
  versions: MarksheetVersion[];
  active_version: MarksheetVersion | null;
}

// Lightweight count of active year_final publications for a class. The
// /finalize-year-final endpoint doesn't paginate per-student status today —
// we just track aggregate counts so the operator knows whether re-finalize
// will prompt for a reason and how many rows are live.
interface YearFinalStatus {
  enrolled: number;
  finalized_active: number;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AdminPublishPage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [selectedClassId, setSelectedClassId] = useUrlState("class_id");
  const [selectedExamTypeId, setSelectedExamTypeId] = useUrlState("exam_type_id");
  const [loading, setLoading] = useState(true);

  const [publishStatus, setPublishStatus] = useState<PublishStatus | null>(null);
  const [rows, setRows] = useState<StudentMarksheetRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [busy, setBusy] = useState(false);

  // Year-final mode (H16-A). Independent of the exam_type select — uses the
  // class's academic_year_id directly.
  const [yearFinalStatus, setYearFinalStatus] = useState<YearFinalStatus | null>(
    null
  );
  const [yearFinalBusy, setYearFinalBusy] = useState(false);
  const [yearFinalDialog, setYearFinalDialog] = useState<{
    open: boolean;
    mode: "unpublish";
  }>({ open: false, mode: "unpublish" });
  const [yearFinalReason, setYearFinalReason] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Unpublish-reason dialog
  const [unpublishDialog, setUnpublishDialog] = useState<{
    open: boolean;
    scope: "one" | "bulk";
    studentIds: string[];
  }>({ open: false, scope: "bulk", studentIds: [] });
  const [unpublishReason, setUnpublishReason] = useState("");

  useEffect(() => {
    async function bootstrap() {
      const supabase = createClient();
      const { data: currentYear } = await supabase
        .from("academic_years")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();
      if (currentYear?.id) {
        const [{ data: cls }, { data: ets }] = await Promise.all([
          supabase
            .from("classes")
            .select(
              "id, name, section, academic_year_id, sort_order, streams:stream_id(name)"
            )
            .eq("academic_year_id", currentYear.id)
            .order("sort_order", { ascending: true }),
          supabase
            .from("exam_types")
            .select("*")
            .eq("academic_year_id", currentYear.id)
            .order("sort_order", { ascending: true }),
        ]);
        setClasses((cls ?? []) as unknown as Class[]);
        setExamTypes((ets ?? []) as ExamType[]);
      }
      setLoading(false);
    }
    bootstrap();
  }, []);

  const fetchData = useCallback(async () => {
    if (!selectedClassId || !selectedExamTypeId) {
      setPublishStatus(null);
      setRows([]);
      setSelected(new Set());
      return;
    }
    setLoadingData(true);
    try {
      const q = new URLSearchParams({
        class_id: selectedClassId,
        exam_type_id: selectedExamTypeId,
      }).toString();
      const [statusRes, listRes] = await Promise.all([
        adminFetch(`/api/results/publish?${q}`),
        adminFetch(`/api/results/finalize-marksheet?${q}`),
      ]);
      if (statusRes.ok) {
        const data = await statusRes.json();
        setPublishStatus(data as PublishStatus);
      } else {
        setPublishStatus(null);
      }
      if (listRes.ok) {
        const data = await listRes.json();
        setRows((data.students ?? []) as StudentMarksheetRow[]);
      } else {
        setRows([]);
      }
      setSelected(new Set());
    } finally {
      setLoadingData(false);
    }
  }, [selectedClassId, selectedExamTypeId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function togglePublishPost(next: boolean) {
    if (!selectedClassId || !selectedExamTypeId) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Not authenticated");
        return;
      }
      const res = await fetch("/api/results/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          class_id: selectedClassId,
          exam_type_id: selectedExamTypeId,
          is_published: next,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to update publish state");
        return;
      }
      toast.success(`${next ? "Published" : "Unpublished"} ${data.affected} rows`);
      fetchData();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function finalize(
    studentIds?: string[],
    refinalizeReason?: string
  ) {
    if (!selectedClassId || !selectedExamTypeId) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Not authenticated");
        return;
      }
      const res = await fetch("/api/results/finalize-marksheet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          class_id: selectedClassId,
          exam_type_id: selectedExamTypeId,
          ...(studentIds && studentIds.length > 0 ? { student_ids: studentIds } : {}),
          ...(refinalizeReason ? { unpublish_reason_on_refinalize: refinalizeReason } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // The route returns 400 + prior_active_count when a reason is needed.
        // Prompt for it and retry once so the admin gets a one-step flow.
        if (
          res.status === 400 &&
          typeof data?.prior_active_count === "number" &&
          data.prior_active_count > 0 &&
          !refinalizeReason
        ) {
          const reason = window.prompt(
            `${data.prior_active_count} marksheet(s) are already finalized. Why are you re-finalizing? (e.g. "Marks corrected for English")`
          );
          if (reason && reason.trim()) {
            await finalize(studentIds, reason.trim());
            return;
          }
          toast.error("Re-finalize cancelled — reason required");
          return;
        }
        toast.error(data.error ?? "Finalize failed");
        return;
      }
      const msg = `Finalized ${data.finalized}` +
        (data.refinalized > 0 ? ` (${data.refinalized} re-finalized)` : "") +
        (data.skipped > 0 ? ` · ${data.skipped} skipped (no marks)` : "") +
        (data.errors?.length > 0 ? ` · ${data.errors.length} errors` : "");
      toast.success(msg);
      fetchData();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  function openUnpublishDialog(scope: "one" | "bulk", studentIds: string[]) {
    setUnpublishReason("");
    setUnpublishDialog({ open: true, scope, studentIds });
  }

  async function confirmUnpublish() {
    if (!selectedClassId || !selectedExamTypeId) return;
    const reason = unpublishReason.trim();
    if (!reason) {
      toast.error("Reason is required");
      return;
    }
    setBusy(true);
    try {
      const res = await adminDelete(
        "/api/results/finalize-marksheet",
        {
          class_id: selectedClassId,
          exam_type_id: selectedExamTypeId,
          unpublish_reason: reason,
          ...(unpublishDialog.studentIds.length > 0
            ? { student_ids: unpublishDialog.studentIds }
            : {}),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Unpublish failed");
        return;
      }
      toast.success(`Unpublished ${data.affected} marksheets`);
      setUnpublishDialog({ open: false, scope: "bulk", studentIds: [] });
      fetchData();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  // Resolve the class's academic_year_id from the loaded list. We rely on
  // it for the year-final flow; the per-exam flow uses exam_type_id only.
  const selectedClassYearId = useMemo(() => {
    const cls = classes.find((c) => c.id === selectedClassId);
    return cls?.academic_year_id ?? "";
  }, [classes, selectedClassId]);

  // Refresh year-final status whenever the class changes. Counts active
  // enrollments + the live `marksheet_publications` rows of kind='year_final'
  // for that (class, year). No dedicated list endpoint today — direct query
  // is fine for an aggregate.
  const fetchYearFinalStatus = useCallback(async () => {
    if (!selectedClassId || !selectedClassYearId) {
      setYearFinalStatus(null);
      return;
    }
    const supabase = createClient();
    const [{ count: enrolled }, { count: finalizedActive }] = await Promise.all([
      supabase
        .from("student_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("class_id", selectedClassId)
        .eq("academic_year_id", selectedClassYearId)
        .eq("status", "active"),
      supabase
        .from("marksheet_publications")
        .select("id", { count: "exact", head: true })
        .eq("class_id", selectedClassId)
        .eq("academic_year_id", selectedClassYearId)
        .eq("kind", "year_final")
        .is("unpublished_at", null),
    ]);
    setYearFinalStatus({
      enrolled: enrolled ?? 0,
      finalized_active: finalizedActive ?? 0,
    });
  }, [selectedClassId, selectedClassYearId]);

  useEffect(() => {
    fetchYearFinalStatus();
  }, [fetchYearFinalStatus]);

  async function finalizeYearFinal(reason?: string) {
    if (!selectedClassId || !selectedClassYearId) return;
    setYearFinalBusy(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Not authenticated");
        return;
      }
      const res = await fetch("/api/results/finalize-year-final", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          class_id: selectedClassId,
          academic_year_id: selectedClassYearId,
          ...(reason ? { unpublish_reason_on_refinalize: reason } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (
          res.status === 400 &&
          typeof data?.prior_active_count === "number" &&
          data.prior_active_count > 0 &&
          !reason
        ) {
          const promptReason = window.prompt(
            `${data.prior_active_count} year-final marksheet(s) are already finalized for this class. Why are you re-finalizing?`
          );
          if (promptReason && promptReason.trim()) {
            await finalizeYearFinal(promptReason.trim());
            return;
          }
          toast.error("Re-finalize cancelled — reason required");
          return;
        }
        toast.error(data.error ?? "Year-final finalize failed");
        return;
      }
      const msg =
        `Year-final: ${data.finalized}` +
        (data.refinalized > 0 ? ` (${data.refinalized} re-finalized)` : "") +
        (data.skipped > 0 ? ` · ${data.skipped} skipped (no marks)` : "") +
        (data.errors?.length > 0 ? ` · ${data.errors.length} errors` : "");
      toast.success(msg);
      fetchYearFinalStatus();
    } catch {
      toast.error("Network error");
    } finally {
      setYearFinalBusy(false);
    }
  }

  function openYearFinalUnpublishDialog() {
    setYearFinalReason("");
    setYearFinalDialog({ open: true, mode: "unpublish" });
  }

  async function confirmYearFinalUnpublish() {
    if (!selectedClassId || !selectedClassYearId) return;
    const reason = yearFinalReason.trim();
    if (!reason) {
      toast.error("Reason is required");
      return;
    }
    setYearFinalBusy(true);
    try {
      const res = await adminDelete("/api/results/finalize-year-final", {
        class_id: selectedClassId,
        academic_year_id: selectedClassYearId,
        unpublish_reason: reason,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Year-final unpublish failed");
        return;
      }
      toast.success(`Unpublished ${data.affected} year-final marksheet(s)`);
      setYearFinalDialog({ open: false, mode: "unpublish" });
      fetchYearFinalStatus();
    } catch {
      toast.error("Network error");
    } finally {
      setYearFinalBusy(false);
    }
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const toggleSelectAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.student_id)));
  };
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const summary = useMemo(() => {
    const finalized = rows.filter((r) => r.active_version).length;
    const pending = rows.length - finalized;
    return { total: rows.length, finalized, pending };
  }, [rows]);

  const activeSelectedIds = useMemo(
    () =>
      rows
        .filter((r) => selected.has(r.student_id) && r.active_version)
        .map((r) => r.student_id),
    [rows, selected]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Publish &amp; Finalize
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Two-stage publish: flip online visibility first, then snapshot the
          official marksheet PDF.
        </p>
      </div>

      <Card className="bg-white dark:bg-card rounded-2xl">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-900 dark:text-white">
                Class
              </label>
              <Select
                value={selectedClassId}
                items={classes.map((cls) => ({
                  value: cls.id,
                  label: formatClassName(cls),
                }))}
                onValueChange={(v) => v && setSelectedClassId(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((cls) => (
                    <SelectItem
                      key={cls.id}
                      value={cls.id}
                      label={formatClassName(cls)}
                    >
                      {formatClassName(cls)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-900 dark:text-white">
                Exam Type
              </label>
              <Select
                value={selectedExamTypeId}
                items={examTypes.map((et) => ({ value: et.id, label: et.name }))}
                onValueChange={(v) => v && setSelectedExamTypeId(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select exam" />
                </SelectTrigger>
                <SelectContent>
                  {examTypes.map((et) => (
                    <SelectItem key={et.id} value={et.id} label={et.name}>
                      {et.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedClassId && selectedExamTypeId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Stage 1: Online publish ───────────────────────────────── */}
          <Card className="bg-white dark:bg-card rounded-2xl">
            <CardHeader>
              <CardTitle className="text-navy-900 dark:text-white flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Stage 1 · Online Publish
              </CardTitle>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Toggle visibility for students and parents. Marks stay editable
                — re-publish after edits doesn&apos;t create a new version.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingData || !publishStatus ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : publishStatus.total === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
                  No results recorded for this class + exam yet.
                </p>
              ) : (
                <>
                  <div className="rounded-lg border border-gray-200 dark:border-border p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">
                        Result rows
                      </span>
                      <span className="font-medium text-navy-900 dark:text-white">
                        {publishStatus.total}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">
                        Published
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          publishStatus.published === publishStatus.total &&
                          publishStatus.published > 0
                            ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                            : "text-gray-500 dark:text-gray-400"
                        }
                      >
                        {publishStatus.published} / {publishStatus.total}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => togglePublishPost(true)}
                      disabled={busy || publishStatus.published === publishStatus.total}
                      className="flex-1 bg-navy-900 text-white hover:bg-navy-900/90"
                      size="sm"
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Publish all
                    </Button>
                    <Button
                      onClick={() => togglePublishPost(false)}
                      disabled={busy || publishStatus.published === 0}
                      variant="outline"
                      className="flex-1"
                      size="sm"
                    >
                      <EyeOff className="h-4 w-4 mr-2" />
                      Unpublish all
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Stage 2: Finalize marksheet ──────────────────────────── */}
          <Card className="bg-white dark:bg-card rounded-2xl">
            <CardHeader>
              <CardTitle className="text-navy-900 dark:text-white flex items-center gap-2">
                <Lock className="h-4 w-4" />
                Stage 2 · Finalize Marksheet
              </CardTitle>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Snapshot the official PDF per student. Subsequent mark edits
                do NOT change finalized marksheets. Re-finalize auto-bumps
                the version.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingData ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : rows.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
                  No active enrollments for this class.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg border border-gray-200 dark:border-border p-2 text-center">
                      <div className="text-gray-500 dark:text-gray-400">Students</div>
                      <div className="font-semibold text-navy-900 dark:text-white">
                        {summary.total}
                      </div>
                    </div>
                    <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-2 text-center">
                      <div className="text-gray-500 dark:text-gray-400">Finalized</div>
                      <div className="font-semibold text-green-700 dark:text-green-400">
                        {summary.finalized}
                      </div>
                    </div>
                    <div className="rounded-lg border border-gray-200 dark:border-border p-2 text-center">
                      <div className="text-gray-500 dark:text-gray-400">Pending</div>
                      <div className="font-semibold text-navy-900 dark:text-white">
                        {summary.pending}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      onClick={() => finalize()}
                      disabled={busy}
                      className="bg-navy-900 text-white hover:bg-navy-900/90"
                      size="sm"
                    >
                      <Lock className="h-4 w-4 mr-2" />
                      Finalize all
                    </Button>
                    {selected.size > 0 && (
                      <Button
                        onClick={() => finalize(Array.from(selected))}
                        disabled={busy}
                        variant="outline"
                        size="sm"
                      >
                        <Users className="h-4 w-4 mr-2" />
                        Finalize selected ({selected.size})
                      </Button>
                    )}
                    {activeSelectedIds.length > 0 && (
                      <Button
                        onClick={() =>
                          openUnpublishDialog("bulk", activeSelectedIds)
                        }
                        disabled={busy}
                        variant="outline"
                        size="sm"
                      >
                        <LockOpen className="h-4 w-4 mr-2" />
                        Unpublish selected ({activeSelectedIds.length})
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Year-final marksheet (H16-A) ────────────────────────────
          Independent of the exam-type selector — uses the class's
          academic_year_id. Snapshot version V2 captures the year-end
          aggregate so subsequent mark edits don't mutate the published
          year-final report cards. */}
      {selectedClassId && (
        <Card className="bg-white dark:bg-card rounded-2xl">
          <CardHeader>
            <CardTitle className="text-navy-900 dark:text-white flex items-center gap-2">
              <CalendarCheck className="h-4 w-4" />
              Year-Final Marksheet
            </CardTitle>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Snapshot the end-of-year aggregate (rank, division, final
              percentage) for the whole class. Use this once promotion is
              decided. Re-finalize requires a reason.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {yearFinalStatus === null ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-gray-200 dark:border-border p-2 text-center">
                    <div className="text-gray-500 dark:text-gray-400">
                      Active enrollments
                    </div>
                    <div className="font-semibold text-navy-900 dark:text-white">
                      {yearFinalStatus.enrolled}
                    </div>
                  </div>
                  <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-2 text-center">
                    <div className="text-gray-500 dark:text-gray-400">
                      Year-final finalized
                    </div>
                    <div className="font-semibold text-green-700 dark:text-green-400">
                      {yearFinalStatus.finalized_active}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => finalizeYearFinal()}
                    disabled={
                      yearFinalBusy || yearFinalStatus.enrolled === 0
                    }
                    className="bg-navy-900 text-white hover:bg-navy-900/90"
                    size="sm"
                  >
                    {yearFinalBusy && (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    )}
                    <Lock className="h-4 w-4 mr-2" />
                    {yearFinalStatus.finalized_active > 0
                      ? "Re-finalize all"
                      : "Finalize all"}
                  </Button>
                  {yearFinalStatus.finalized_active > 0 && (
                    <Button
                      onClick={openYearFinalUnpublishDialog}
                      disabled={yearFinalBusy}
                      variant="outline"
                      size="sm"
                    >
                      <LockOpen className="h-4 w-4 mr-2" />
                      Unpublish all year-final
                    </Button>
                  )}
                </div>
                {yearFinalStatus.enrolled === 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    No active enrollments to finalize.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {selectedClassId && selectedExamTypeId && rows.length > 0 && (
        <Card className="bg-white dark:bg-card rounded-2xl">
          <CardHeader>
            <CardTitle className="text-navy-900 dark:text-white">
              Students
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="h-4 w-4"
                      />
                    </TableHead>
                    <TableHead className="w-16">Roll</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead className="w-28">Admission</TableHead>
                    <TableHead>Marksheet status</TableHead>
                    <TableHead className="w-[220px] text-right">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const active = r.active_version;
                    return (
                      <TableRow key={r.student_id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selected.has(r.student_id)}
                            onChange={() => toggleSelect(r.student_id)}
                            className="h-4 w-4"
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {r.roll_number ?? "-"}
                        </TableCell>
                        <TableCell>{r.full_name}</TableCell>
                        <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                          {r.admission_no || "—"}
                        </TableCell>
                        <TableCell>
                          {active ? (
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className="bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />v
                                {active.version} · {formatWhen(active.published_at)}
                              </Badge>
                              {r.versions.length > 1 && (
                                <span className="text-[10px] text-gray-400">
                                  {r.versions.length} versions
                                </span>
                              )}
                            </div>
                          ) : r.versions.length > 0 ? (
                            <Badge
                              variant="outline"
                              className="text-gray-500 dark:text-gray-400"
                            >
                              Unpublished
                              {r.versions[0].unpublish_reason && (
                                <span className="ml-1 truncate max-w-[180px] inline-block align-bottom">
                                  · {r.versions[0].unpublish_reason}
                                </span>
                              )}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-gray-400 dark:text-gray-500"
                            >
                              Not finalized
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => finalize([r.student_id])}
                              disabled={busy}
                            >
                              {active ? "Re-finalize" : "Finalize"}
                            </Button>
                            {active && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  openUnpublishDialog("one", [r.student_id])
                                }
                                disabled={busy}
                              >
                                <LockOpen className="h-4 w-4 mr-1" />
                                Unpublish
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={yearFinalDialog.open}
        onOpenChange={(o) =>
          setYearFinalDialog((prev) => ({ ...prev, open: o }))
        }
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unpublish all year-final marksheets?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              This unpublishes every active year-final marksheet for the
              selected class. Future PDF downloads fall back to live data.
              A reason is required for audit.
            </p>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input
                value={yearFinalReason}
                onChange={(e) => setYearFinalReason(e.target.value)}
                placeholder="e.g. Promotion decisions changed for 3 students"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              onClick={confirmYearFinalUnpublish}
              disabled={yearFinalBusy || !yearFinalReason.trim()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {yearFinalBusy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Unpublish all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={unpublishDialog.open}
        onOpenChange={(o) =>
          setUnpublishDialog((prev) => ({ ...prev, open: o }))
        }
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unpublish marksheet?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Unpublishing hides the finalized marksheet; future PDF downloads
              will fall back to live data. A reason is required for audit.
            </p>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input
                value={unpublishReason}
                onChange={(e) => setUnpublishReason(e.target.value)}
                placeholder="e.g. Correction needed for Maths marks"
              />
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Scope: {unpublishDialog.studentIds.length} student
              {unpublishDialog.studentIds.length === 1 ? "" : "s"}
            </p>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              onClick={confirmUnpublish}
              disabled={busy || !unpublishReason.trim()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Unpublish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
