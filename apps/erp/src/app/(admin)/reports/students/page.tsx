"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
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
import { Tabs, TabsList, TabsTrigger } from "@nkps/shared/components/ui/tabs";
import { toast } from "sonner";
import {
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Play,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  REPORT_FIELDS,
  REPORT_GROUPS,
  REPORT_FOCUSES,
  ALWAYS_FIELD_KEYS,
  SORTABLE_FIELDS,
  isReportFocus,
  type ReportGroup,
} from "@nkps/shared/lib/report-fields";
import {
  ENROLLMENT_STATUSES,
  emptyReportFilters,
  type ReportExportFormat,
  type ReportFiltersInput,
  type TriState,
} from "@nkps/shared/lib/report-filters";
import { formatClassName } from "@nkps/shared/lib/utils";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";

interface Option {
  id: string;
  name: string;
  section?: string | null;
}

/**
 * A class chip. `stream_name` matters: XI and XII exist once per stream, so
 * "XI - A" alone renders three identical, unpickable chips (Arts, Science,
 * Commerce). formatClassName() appends the stream when there is one.
 */
interface ClassOption extends Option {
  section: string;
  stream_name: string | null;
}

interface Preset {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  fields: string[];
  is_shared: boolean;
  can_edit: boolean;
  is_system: boolean;
}

interface PreviewState {
  columns: { key: string; label: string; numeric: boolean }[];
  headers: string[];
  rows: (string | number | null)[][];
  total: number;
  sessionName: string;
  withheld: number;
}

const FILTER_TABS = [
  { key: "basics", label: "Basics" },
  { key: "demographics", label: "Demographics" },
  { key: "enrolment", label: "Enrolment" },
  { key: "sorting", label: "Sorting" },
] as const;

/** Preview page size. Exports are unpaged. */
const PREVIEW_ROWS = 50;

/** Columns above which a print/PDF layout starts to get tight. */
const WIDE_REPORT_COLUMNS = 12;

/** Hard PDF limit. Must match PDF_MAX_COLUMNS in the export route. */
const PDF_MAX_COLUMNS = 20;

export default function StudentReportPage() {
  const supabase = useMemo(() => createClient(), []);

  const [years, setYears] = useState<Option[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [streams, setStreams] = useState<Option[]>([]);
  const [houses, setHouses] = useState<Option[]>([]);
  const [subjects, setSubjects] = useState<Option[]>([]);
  const [loadingMasters, setLoadingMasters] = useState(true);

  // Session lives in the URL so a report is a shareable link. The full field
  // selection deliberately does not — a 100-key query string is unusable, and
  // saved presets (a later phase) are the real answer to reusing a selection.
  const [sessionId, setSessionId] = useUrlState("session");
  // ?focus=fees|attendance|results — the Fee / Attendance / Result entry points
  // on /reports. A starting selection, not a restriction: the picker stays
  // fully open, so these are shortcuts into the one builder rather than three
  // separate, weaker screens. It also means a single sheet can combine fee
  // balance, attendance % and class, which siloed reports could never do.
  const [focus] = useUrlState("focus");

  const [filters, setFilters] = useState<ReportFiltersInput>(() => {
    const base = emptyReportFilters("");
    if (!isReportFocus(focus)) return base;
    const f = REPORT_FOCUSES[focus];
    return { ...base, sort_by: f.sort_by, sort_dir: f.sort_dir };
  });
  const [selected, setSelected] = useState<string[]>(() =>
    isReportFocus(focus)
      ? [...REPORT_FOCUSES[focus].fields]
      : ["admission_no", "class_section", "father_name"]
  );
  const [fieldSearch, setFieldSearch] = useState("");
  const [tab, setTab] = useState<(typeof FILTER_TABS)[number]["key"]>("basics");

  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePresetId, setActivePresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState<ReportExportFormat | null>(null);

  // ── Masters ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [yearsRes, streamsRes, housesRes, subjectsRes] = await Promise.all([
        supabase.from("academic_years").select("id, name, is_current").order("name", { ascending: false }),
        // kind='stream' only — a wing is not something a report filters by.
        // (migration 118)
        supabase.from("streams").select("id, name").eq("kind", "stream").eq("is_active", true).order("sort_order"),
        supabase.from("houses").select("id, name").eq("is_active", true).order("sort_order"),
        supabase.from("subjects").select("id, name").eq("is_active", true).order("name"),
      ]);
      if (cancelled) return;

      const yearRows = (yearsRes.data ?? []) as (Option & { is_current?: boolean })[];
      setYears(yearRows);
      setStreams((streamsRes.data ?? []) as Option[]);
      setHouses((housesRes.data ?? []) as Option[]);
      setSubjects((subjectsRes.data ?? []) as Option[]);

      // Default to the current session rather than the newest: a school mid-way
      // through a year should not have to change the dropdown every time.
      const initial =
        sessionId || yearRows.find((y) => y.is_current)?.id || yearRows[0]?.id || "";
      if (initial) {
        setSessionId(initial);
        setFilters((f) => ({ ...f, session_id: initial }));
      }
      setLoadingMasters(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Classes are year-scoped, so the list reloads whenever the session changes —
  // and any class filter from the previous session is cleared, because those
  // ids do not exist in the new one.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("classes")
        .select("id, name, section, sort_order, streams(name)")
        .eq("academic_year_id", sessionId)
        .order("sort_order");
      if (cancelled) return;
      setClasses(
        (data ?? []).map((c) => {
          const row = c as unknown as {
            id: string;
            name: string;
            section: string | null;
            streams: { name: string } | { name: string }[] | null;
          };
          const rel = row.streams;
          return {
            id: row.id,
            name: row.name,
            section: row.section ?? "",
            stream_name: (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? null,
          };
        })
      );
      setFilters((f) => ({ ...f, session_id: sessionId, class_ids: [] }));
      setPreview(null);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Chips grouped by class name: "XI" then its three stream sections, rather
  // than 30 undifferentiated pills in one wrap. Insertion order is preserved,
  // and the query already sorts by sort_order, so classes stay in school order.
  const classGroups = useMemo(() => {
    const groups = new Map<string, ClassOption[]>();
    for (const c of classes) {
      const list = groups.get(c.name) ?? [];
      list.push(c);
      groups.set(c.name, list);
    }
    return [...groups.entries()].map(([name, items]) => ({ name, items }));
  }, [classes]);

  const selectedClassIds = useMemo(
    () => new Set(filters.class_ids ?? []),
    [filters.class_ids]
  );

  // ── Presets ───────────────────────────────────────────────────────────────
  const loadPresets = useCallback(async () => {
    try {
      const res = await adminFetch("/api/reports/presets");
      const json = await res.json();
      if (res.ok) setPresets(json.data ?? []);
    } catch {
      // A preset list that fails to load must not block the builder itself.
    }
  }, []);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  const applyPreset = useCallback(
    (id: string) => {
      const preset = presets.find((p) => p.id === id);
      if (!preset) return;
      setActivePresetId(id);
      setPresetName(preset.can_edit ? preset.name : `${preset.name} (copy)`);
      setSelected(preset.fields);
      // The stored session id is deliberately discarded in favour of whatever
      // the picker currently holds, so "Contact Sheet" works in any year
      // instead of silently reporting on the year it was saved in.
      setFilters({
        ...emptyReportFilters(sessionId ?? ""),
        ...(preset.filters as Partial<ReportFiltersInput>),
        session_id: sessionId ?? "",
      });
      setPreview(null);
      toast.success(`Loaded “${preset.name}”`);
    },
    [presets, sessionId]
  );

  const savePreset = useCallback(async () => {
    const name = presetName.trim();
    if (!name) {
      toast.error("Give the preset a name");
      return;
    }
    setSavingPreset(true);
    try {
      const res = await adminFetch("/api/reports/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          entity: "students",
          // Session is stripped before saving: a preset is a shape, not a year.
          filters: { ...filters, session_id: undefined },
          fields: selected,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Failed to save preset");
        return;
      }
      toast.success(`Saved “${name}”`);
      setActivePresetId(json.data.id);
      await loadPresets();
    } catch {
      toast.error("Failed to save preset");
    } finally {
      setSavingPreset(false);
    }
  }, [presetName, filters, selected, loadPresets]);

  const deletePreset = useCallback(async () => {
    const preset = presets.find((p) => p.id === activePresetId);
    if (!preset) return;
    if (!confirm(`Delete the preset “${preset.name}”?`)) return;
    try {
      const res = await adminFetch(
        `/api/reports/presets?id=${encodeURIComponent(preset.id)}`,
        { method: "DELETE" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Failed to delete preset");
        return;
      }
      toast.success(`Deleted “${preset.name}”`);
      setActivePresetId("");
      setPresetName("");
      await loadPresets();
    } catch {
      toast.error("Failed to delete preset");
    }
  }, [activePresetId, presets, loadPresets]);

  const activePreset = presets.find((p) => p.id === activePresetId);

  // ── Field picker ──────────────────────────────────────────────────────────
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const grouped = useMemo(() => {
    const needle = fieldSearch.trim().toLowerCase();
    const out: { group: ReportGroup; fields: typeof REPORT_FIELDS }[] = [];
    for (const group of REPORT_GROUPS) {
      const fields = REPORT_FIELDS.filter(
        (f) =>
          f.group === group &&
          (!needle || f.label.toLowerCase().includes(needle))
      );
      if (fields.length) out.push({ group, fields });
    }
    return out;
  }, [fieldSearch]);

  const toggleField = useCallback((key: string) => {
    if (ALWAYS_FIELD_KEYS.includes(key)) return;
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  const toggleGroup = useCallback(
    (group: ReportGroup, on: boolean) => {
      const keys = REPORT_FIELDS.filter(
        (f) => f.group === group && !f.always
      ).map((f) => f.key);
      setSelected((prev) =>
        on
          ? [...prev, ...keys.filter((k) => !prev.includes(k))]
          : prev.filter((k) => !keys.includes(k))
      );
    },
    []
  );

  // ── Run / export ──────────────────────────────────────────────────────────
  const payload = useMemo(
    () => ({ ...filters, session_id: sessionId, fields: selected }),
    [filters, sessionId, selected]
  );

  const runPreview = useCallback(async () => {
    if (!sessionId) {
      toast.error("Pick a session first");
      return;
    }
    setRunning(true);
    try {
      const res = await adminFetch("/api/reports/students/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: payload, page: 1, page_size: PREVIEW_ROWS }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Failed to run report");
        return;
      }
      setPreview({
        columns: json.columns,
        headers: json.headers,
        rows: json.rows,
        total: json.total,
        sessionName: json.session?.name ?? "",
        withheld: json.withheld_fields ?? 0,
      });
      if (json.withheld_fields > 0) {
        toast.warning(
          `${json.withheld_fields} restricted column(s) were withheld from this report`
        );
      }
      if (json.total === 0) toast.info("No students matched these filters");
    } catch {
      toast.error("Failed to run report");
    } finally {
      setRunning(false);
    }
  }, [payload, sessionId]);

  const exportReport = useCallback(
    async (format: ReportExportFormat) => {
      if (!sessionId) {
        toast.error("Pick a session first");
        return;
      }
      setExporting(format);
      try {
        // Plain fetch, not adminFetch: the export route authenticates by
        // cookie (see its header comment), and it streams a file rather than
        // JSON, so the response is read as a blob.
        const res = await fetch(`/api/reports/students/export?format=${format}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ filters: payload }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          toast.error(json.error ?? "Export failed");
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download =
          res.headers
            .get("Content-Disposition")
            ?.match(/filename="([^"]+)"/)?.[1] ?? `student-report.${format}`;
        link.click();
        URL.revokeObjectURL(url);
        toast.success(`Downloaded ${format.toUpperCase()}`);
      } catch {
        toast.error("Export failed");
      } finally {
        setExporting(null);
      }
    },
    [payload, sessionId]
  );

  // ── Filter helpers ────────────────────────────────────────────────────────
  /** base-ui Select emits `string | null`, and "all"/"none" are the
   *  no-filter sentinels. Both collapse to "" — the schema's "absent". */
  const pick = (v: string | null): string =>
    !v || v === "all" || v === "none" ? "" : v;

  const set = <K extends keyof ReportFiltersInput>(
    key: K,
    value: ReportFiltersInput[K]
  ) => setFilters((f) => ({ ...f, [key]: value }));

  const triState = (
    label: string,
    key: "is_rte" | "is_bpl" | "is_ews" | "is_cwsn" | "is_staff_ward" | "has_transport"
  ) => (
    <div key={key} className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select
        value={(filters[key] as TriState) ?? "both"}
        onValueChange={(v) => set(key, (v ?? "both") as TriState)}
      >
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="both" label="Both">Both</SelectItem>
          <SelectItem value="yes" label="Yes">Yes</SelectItem>
          <SelectItem value="no" label="No">No</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  const totalColumns = selected.length + ALWAYS_FIELD_KEYS.length;
  const columnWarning = totalColumns > WIDE_REPORT_COLUMNS;
  // Mirrors PDF_MAX_COLUMNS in the export route. Disabling the button beats
  // letting the request 400 — the user learns the limit before they wait.
  const tooWideToPrint = totalColumns > PDF_MAX_COLUMNS;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-navy-900 dark:text-white">
            {isReportFocus(focus) ? REPORT_FOCUSES[focus].label : "Student Custom Report"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Pick the students, pick the columns, get a sheet.
            {isReportFocus(focus)
              ? " Started from a suggested column set — change anything you like."
              : ""}
          </p>
        </div>
        <div className="erp-page-actions">
          <Button onClick={runPreview} disabled={running || loadingMasters}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Preview
          </Button>
          <Button
            variant="outline"
            onClick={() => exportReport("csv")}
            disabled={!!exporting || loadingMasters}
          >
            {exporting === "csv" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => exportReport("xlsx")}
            disabled={!!exporting || loadingMasters}
          >
            {exporting === "xlsx" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-2 h-4 w-4" />
            )}
            Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => exportReport("pdf")}
            disabled={!!exporting || loadingMasters || tooWideToPrint}
            title={
              tooWideToPrint
                ? `${totalColumns} columns is too many to print legibly — use Excel`
                : undefined
            }
          >
            {exporting === "pdf" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileText className="mr-2 h-4 w-4" />
            )}
            PDF
          </Button>
        </div>
      </div>

      {/* ── Presets ── */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white dark:bg-card p-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Saved report</Label>
          <Select value={activePresetId} onValueChange={(v) => applyPreset(v ?? "")}>
            <SelectTrigger className="h-9 w-[240px]">
              <SelectValue placeholder="Load a saved report…" />
            </SelectTrigger>
            <SelectContent>
              {presets.length === 0 && (
                <SelectItem value="" label="No saved reports" disabled>
                  No saved reports yet
                </SelectItem>
              )}
              {presets.map((p) => (
                <SelectItem key={p.id} value={p.id} label={p.name}>
                  {p.name}
                  {p.is_shared ? " · shared" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Save current selection as</Label>
          <Input
            className="h-9 w-[220px]"
            placeholder="e.g. Bus route contact list"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
          />
        </div>

        <Button
          variant="outline"
          onClick={savePreset}
          disabled={savingPreset || !presetName.trim()}
        >
          {savingPreset ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save
        </Button>

        {activePreset?.can_edit && (
          <Button
            variant="outline"
            onClick={deletePreset}
            className="text-red-600 dark:text-red-400 hover:text-red-700"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        )}

        {activePreset?.is_system && (
          <span className="pb-2 text-xs text-muted-foreground">
            Built-in report — saving under a new name makes your own copy.
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* ── Filters ── */}
        <div className="min-w-0 rounded-lg border bg-white dark:bg-card">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="w-full justify-start rounded-b-none border-b bg-transparent px-2">
              {FILTER_TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {tab === "basics" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    Session <span className="text-red-500">*</span>
                  </Label>
                  <Select value={sessionId ?? ""} onValueChange={(v) => setSessionId(v ?? "")}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select session" />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y.id} value={y.id} label={y.name}>
                          {y.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">
                      Classes{" "}
                      <span className="font-normal text-muted-foreground">
                        {selectedClassIds.size === 0
                          ? "— none selected, so all classes"
                          : `— ${selectedClassIds.size} selected`}
                      </span>
                    </Label>
                    {classes.length > 0 && (
                      <div className="flex gap-3 text-xs">
                        <button
                          type="button"
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                          onClick={() => set("class_ids", classes.map((c) => c.id))}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-red-600"
                          onClick={() => set("class_ids", [])}
                          disabled={selectedClassIds.size === 0}
                        >
                          Clear
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1 rounded-md border p-2">
                    {classes.length === 0 && (
                      <span className="px-1 text-xs text-muted-foreground">
                        No classes in this session
                      </span>
                    )}
                    {classGroups.map((group) => {
                      const allOn =
                        group.items.length > 0 &&
                        group.items.every((c) => selectedClassIds.has(c.id));
                      return (
                        <div
                          key={group.name}
                          className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-gray-50 dark:hover:bg-white/5"
                        >
                          {/* Clicking the class name takes all its sections and
                              streams at once — the common case for XI/XII. */}
                          <button
                            type="button"
                            onClick={() => {
                              const ids = group.items.map((c) => c.id);
                              set(
                                "class_ids",
                                allOn
                                  ? (filters.class_ids ?? []).filter(
                                      (id) => !ids.includes(id)
                                    )
                                  : [
                                      ...(filters.class_ids ?? []),
                                      ...ids.filter((id) => !selectedClassIds.has(id)),
                                    ]
                              );
                            }}
                            className={`w-16 shrink-0 rounded px-1.5 py-1 text-left text-xs font-medium transition ${
                              allOn
                                ? "text-blue-700"
                                : "text-gray-600 dark:text-gray-400 hover:text-blue-600"
                            }`}
                            title={`Select all of ${group.name}`}
                          >
                            {group.name}
                          </button>
                          <div className="flex flex-wrap gap-1.5">
                            {group.items.map((c) => {
                              const on = selectedClassIds.has(c.id);
                              // formatClassName appends "(Science)" etc., which
                              // is what makes the three XI-A rows distinct.
                              const label = formatClassName({
                                name: c.name,
                                section: c.section,
                                stream_name: c.stream_name,
                              });
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() =>
                                    set(
                                      "class_ids",
                                      on
                                        ? (filters.class_ids ?? []).filter(
                                            (id) => id !== c.id
                                          )
                                        : [...(filters.class_ids ?? []), c.id]
                                    )
                                  }
                                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                                    on
                                      ? "border-blue-600 bg-blue-600 text-white"
                                      : "border-gray-300 dark:border-border bg-white dark:bg-card hover:border-blue-400"
                                  }`}
                                >
                                  {/* The class name is already the row label. */}
                                  {label.replace(`${c.name} - `, "")}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Student Name contains</Label>
                  <Input
                    className="h-9"
                    value={filters.name_contains ?? ""}
                    onChange={(e) => set("name_contains", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Father&apos;s Name contains</Label>
                  <Input
                    className="h-9"
                    value={filters.father_name_contains ?? ""}
                    onChange={(e) => set("father_name_contains", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Section</Label>
                  <Input
                    className="h-9"
                    value={filters.section ?? ""}
                    onChange={(e) => set("section", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Admission Date from</Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={filters.admission_date_from ?? ""}
                    onChange={(e) => set("admission_date_from", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Admission Date to</Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={filters.admission_date_to ?? ""}
                    onChange={(e) => set("admission_date_to", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Date of Birth from</Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={filters.dob_from ?? ""}
                    onChange={(e) => set("dob_from", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Date of Birth to</Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={filters.dob_to ?? ""}
                    onChange={(e) => set("dob_to", e.target.value)}
                  />
                </div>
              </>
            )}

            {tab === "demographics" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Gender</Label>
                  <Select
                    value={filters.gender ?? "all"}
                    onValueChange={(v) => set("gender", pick(v))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" label="All">All</SelectItem>
                      <SelectItem value="male" label="Male">Male</SelectItem>
                      <SelectItem value="female" label="Female">Female</SelectItem>
                      <SelectItem value="other" label="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <Select
                    value={filters.category ?? "all"}
                    onValueChange={(v) => set("category", pick(v))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" label="All">All</SelectItem>
                      {["General", "SC", "ST", "OBC", "MBC"].map((c) => (
                        <SelectItem key={c} value={c} label={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Rural / Urban</Label>
                  <Select
                    value={filters.area_type ?? "all"}
                    onValueChange={(v) => set("area_type", pick(v))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" label="All">All</SelectItem>
                      <SelectItem value="rural" label="Rural">Rural</SelectItem>
                      <SelectItem value="urban" label="Urban">Urban</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {triState("RTE", "is_rte")}
                {triState("BPL", "is_bpl")}
                {triState("EWS", "is_ews")}
                {triState("CWSN", "is_cwsn")}
                {triState("Staff Ward", "is_staff_ward")}
              </>
            )}

            {tab === "enrolment" && (
              <>
                <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                  <Label className="text-xs">Status</Label>
                  <div className="flex flex-wrap gap-3 rounded-md border p-2">
                    {ENROLLMENT_STATUSES.map((s) => {
                      const on = (filters.statuses ?? []).includes(s);
                      return (
                        <label
                          key={s}
                          className="flex cursor-pointer items-center gap-2 text-sm capitalize"
                        >
                          <Checkbox
                            checked={on}
                            onCheckedChange={() => {
                              const cur = filters.statuses ?? [];
                              const next = on
                                ? cur.filter((v) => v !== s)
                                : [...cur, s];
                              // At least one status must stay ticked; an empty
                              // set is a report of nothing, which reads as a bug.
                              if (next.length) set("statuses", next);
                            }}
                          />
                          {s}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Stream</Label>
                  <Select
                    value={filters.stream_id ?? "all"}
                    onValueChange={(v) => set("stream_id", pick(v))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" label="All">All</SelectItem>
                      {streams.map((s) => (
                        <SelectItem key={s.id} value={s.id} label={s.name}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">House</Label>
                  <Select
                    value={filters.house_id ?? "all"}
                    onValueChange={(v) => set("house_id", pick(v))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" label="All">All</SelectItem>
                      {houses.map((h) => (
                        <SelectItem key={h.id} value={h.id} label={h.name}>
                          {h.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Subject</Label>
                  <Select
                    value={filters.subject_id ?? "all"}
                    onValueChange={(v) => set("subject_id", pick(v))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" label="All">All</SelectItem>
                      {subjects.map((s) => (
                        <SelectItem key={s.id} value={s.id} label={s.name}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {triState("Transport", "has_transport")}
                <div className="space-y-1.5">
                  <Label className="text-xs">Fee Status</Label>
                  <Select
                    value={filters.fee_status ?? "all"}
                    onValueChange={(v) =>
                      set("fee_status", (v ?? "all") as "all" | "due" | "clear")
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" label="All">All</SelectItem>
                      <SelectItem value="due" label="Has dues">
                        Has dues
                      </SelectItem>
                      <SelectItem value="clear" label="Cleared">
                        Cleared
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Balance for this session
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Attendance below (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="h-9"
                    placeholder="e.g. 75"
                    value={filters.attendance_below ?? ""}
                    onChange={(e) =>
                      set(
                        "attendance_below",
                        e.target.value === "" ? "" : Number(e.target.value)
                      )
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Students with nothing marked are excluded
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">New / Old</Label>
                  <Select
                    value={filters.new_old ?? "both"}
                    onValueChange={(v) =>
                      set("new_old", (v ?? "both") as "both" | "new" | "old")
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="both" label="Both">Both</SelectItem>
                      <SelectItem value="new" label="New">
                        New (admitted this session)
                      </SelectItem>
                      <SelectItem value="old" label="Old">Old</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {tab === "sorting" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Sort By</Label>
                  <Select
                    value={filters.sort_by ?? "none"}
                    onValueChange={(v) => set("sort_by", pick(v))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" label="Default (name)">
                        Default (name)
                      </SelectItem>
                      {SORTABLE_FIELDS.map((f) => (
                        <SelectItem key={f.key} value={f.key} label={f.label}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Direction</Label>
                  <Select
                    value={filters.sort_dir ?? "asc"}
                    onValueChange={(v) => set("sort_dir", (v ?? "asc") as "asc" | "desc")}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asc" label="Ascending">Ascending</SelectItem>
                      <SelectItem value="desc" label="Descending">Descending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div />
                <div className="space-y-1.5">
                  <Label className="text-xs">Then By</Label>
                  <Select
                    value={filters.then_by ?? "none"}
                    onValueChange={(v) => set("then_by", pick(v))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" label="None">None</SelectItem>
                      {SORTABLE_FIELDS.filter((f) => f.key !== filters.sort_by).map(
                        (f) => (
                          <SelectItem key={f.key} value={f.key} label={f.label}>
                            {f.label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Direction</Label>
                  <Select
                    value={filters.then_dir ?? "asc"}
                    onValueChange={(v) => set("then_dir", (v ?? "asc") as "asc" | "desc")}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asc" label="Ascending">Ascending</SelectItem>
                      <SelectItem value="desc" label="Descending">Descending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Field picker ── */}
        <div className="min-w-0 flex max-h-[70dvh] flex-col rounded-lg border bg-white dark:bg-card">
          <div className="space-y-2 border-b p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Display / Print Fields</span>
              <Badge variant="secondary">
                {totalColumns} selected
              </Badge>
            </div>
            {/* The old ERP's worst UI: 111 unlabelled checkboxes in a 200px
                scroller with no search. This is the fix. */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-7 text-sm"
                placeholder="Search fields…"
                value={fieldSearch}
                onChange={(e) => setFieldSearch(e.target.value)}
              />
            </div>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => setSelected([])}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-600"
              >
                <X className="h-3 w-3" /> Clear selection
              </button>
            )}
            {columnWarning && (
              <p className="rounded bg-amber-50 dark:bg-amber-950/30 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
                {totalColumns} columns — fine for Excel
                {tooWideToPrint ? ", too wide for PDF" : ", tight in print"}.
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {grouped.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No fields match “{fieldSearch}”
              </p>
            )}
            {grouped.map(({ group, fields }) => {
              const selectable = fields.filter((f) => !f.always);
              const allOn =
                selectable.length > 0 &&
                selectable.every((f) => selectedSet.has(f.key));
              return (
                <div key={group} className="mb-4">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group}
                    </span>
                    {selectable.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleGroup(group, !allOn)}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {allOn ? "None" : "All"}
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {fields.map((f) => (
                      <label
                        key={f.key}
                        className={`flex items-center gap-2 rounded px-1 py-0.5 text-sm ${
                          f.always
                            ? "cursor-default opacity-60"
                            : "cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5"
                        }`}
                      >
                        <Checkbox
                          checked={f.always || selectedSet.has(f.key)}
                          disabled={f.always}
                          onCheckedChange={() => toggleField(f.key)}
                        />
                        <span className="flex-1">{f.label}</span>
                        {f.sensitive && (
                          <span
                            title="Restricted — admins only"
                            className="text-[10px] uppercase text-amber-600 dark:text-amber-400"
                          >
                            PII
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Preview ── */}
      {preview && (
        <div className="rounded-lg border bg-white dark:bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div className="text-sm">
              <span className="font-medium">{preview.total}</span> student
              {preview.total === 1 ? "" : "s"} · session {preview.sessionName}
              {preview.total > preview.rows.length && (
                <span className="text-muted-foreground">
                  {" "}
                  · showing first {preview.rows.length}
                </span>
              )}
            </div>
            {preview.withheld > 0 && (
              <Badge variant="secondary" className="bg-amber-100 dark:bg-amber-950/30 text-amber-900 dark:text-amber-300">
                {preview.withheld} column(s) withheld
              </Badge>
            )}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {preview.headers.map((h, i) => (
                    <TableHead key={i} className="whitespace-nowrap">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row, r) => (
                  <TableRow key={r}>
                    {row.map((cell, c) => (
                      <TableCell
                        key={c}
                        className={`whitespace-nowrap ${
                          preview.columns[c]?.numeric ? "text-right tabular-nums" : ""
                        }`}
                      >
                        {cell ?? ""}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
