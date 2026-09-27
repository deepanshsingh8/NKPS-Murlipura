"use client";

/**
 * §5 Class XI/XII Elective Manager.
 *
 * The page works on ONE class at a time — the switcher in the header scopes
 * everything below it: the slot option lists, the progress counts and the
 * student table. XI and XII are run as separate exercises by the office, and
 * showing both at once meant scrolling past a hundred irrelevant rows to find
 * the six students who still had not picked.
 *
 * A subject offered to both classes is stored ONCE (the table is
 * UNIQUE(slot, subject_id)) and listed in both tabs — see
 * @nkps/shared/lib/electives for the rule the server shares with this page.
 *
 * Backed by /api/electives, /api/electives/options, /api/electives/students.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@nkps/shared/components/ui/button";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import { Label } from "@nkps/shared/components/ui/label";
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
  SortFilterHead,
  TableFilterSummary,
  useTableControls,
  type TableColumns,
} from "@nkps/shared/components/ui/data-table";
import { TableExportButton } from "@nkps/shared/components/ui/table-export-button";
import { AcademicSessionPicker } from "@nkps/shared/components/AcademicSessionPicker";
import { useAcademicSession } from "@nkps/shared/lib/hooks/use-academic-session";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  Check,
  ChevronDown,
  GraduationCap,
  Loader2,
  Plus,
  Trash2,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import {
  ELECTIVE_CLASSES,
  isElectiveClass,
  normaliseElectiveClasses,
  optionAppliesTo,
  type ElectiveClass,
} from "@nkps/shared/lib/electives";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { cn } from "@nkps/shared/lib/utils";
import { toast } from "sonner";

interface SlotOption {
  id: string;
  slot: number;
  subject_id: string;
  label: string | null;
  sort_order: number;
  // NULL/absent on rows written before the lists were split — treated as
  // "both" by normaliseElectiveClasses so nothing silently disappears.
  applies_to_classes: string[] | null;
  subjects: {
    id: string;
    name: string;
    code: string | null;
    nickname: string | null;
  } | null;
}

// Supabase returns embedded resources as either an object or a single-element
// array depending on the relationship; the StudentRow uses a union to match.
type Embedded<T> = T | T[] | null;

interface StudentRow {
  id: string;
  student_id: string;
  class_id: string;
  stream_id: string | null;
  classes: Embedded<{ id: string; name: string; section: string }>;
  streams: Embedded<{ id: string; name: string }>;
  students: Embedded<{ id: string; admission_no: string; full_name: string }>;
}

function pickOne<T>(x: Embedded<T>): T | null {
  if (!x) return null;
  return Array.isArray(x) ? x[0] ?? null : x;
}

interface Pick {
  student_id: string;
  elective_slot: number;
  subject_id: string;
  subject_name: string;
}

interface SubjectLite {
  id: string;
  name: string;
  code: string | null;
}

const SLOTS = [5, 6] as const;

/** Compact figure above the table — total, done, outstanding. */
function StatTile({
  icon: Icon,
  label,
  value,
  tone = "neutral",
  active = false,
  onClick,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone?: "neutral" | "good" | "warn";
  active?: boolean;
  onClick?: () => void;
}) {
  const tones = {
    neutral: "text-navy-900 dark:text-white",
    good: "text-green-700 dark:text-green-400",
    warn: "text-amber-700 dark:text-amber-400",
  };
  const content = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tones[tone])}>
        {value}
      </div>
    </>
  );

  if (!onClick) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-border px-4 py-3">
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "cursor-pointer rounded-xl border px-4 py-3 text-left transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-900 dark:focus-visible:ring-white",
        active
          ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20"
          : "border-gray-200 hover:bg-gray-50 dark:border-border dark:hover:bg-muted"
      )}
    >
      {content}
      <span className="mt-0.5 block text-[10px] text-gray-400">
        {active ? "Showing only these — click to clear" : "Click to filter"}
      </span>
    </button>
  );
}

export default function ElectivesPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<SlotOption[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [allSubjects, setAllSubjects] = useState<SubjectLite[]>([]);

  // Which class the whole page is scoped to, mirrored into ?class= so the view
  // is bookmarkable and survives back-navigation — the same useUrlState hook
  // the fees, results and result-master screens use. It writes through
  // history.replaceState rather than the router, so switching class does not
  // re-run the route or refetch. An unrecognised ?class= falls back to XI.
  const [classParam, setClassParam] = useUrlState("class", ELECTIVE_CLASSES[0]);
  const classTab: ElectiveClass = isElectiveClass(classParam)
    ? classParam
    : ELECTIVE_CLASSES[0];
  // null = follow the default for this class (open when it has no options yet,
  // so the admin is not staring at a table of empty dropdowns with no
  // explanation); true/false once they have chosen for themselves.
  const [optionsOpenOverride, setOptionsOpenOverride] = useState<boolean | null>(null);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [newSubjectIdBySlot, setNewSubjectIdBySlot] = useState<Record<number, string>>({});
  const [savingStudent, setSavingStudent] = useState<string | null>(null);
  // Transient per-cell ticks. A toast per save was unusable when working down
  // a class list; the confirmation belongs on the row that changed.
  const [justSaved, setJustSaved] = useState<Record<string, boolean>>({});

  // Bulk assign
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSlot, setBulkSlot] = useState<string>(String(SLOTS[0]));
  const [bulkSubjectId, setBulkSubjectId] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);

  // `background` keeps the table on screen while re-reading after a write.
  // Without it, changing one dropdown swapped the entire page for the loading
  // skeleton — unusable when working down a class list.
  // Elective picks belong to a session — a student's XI choices are not
  // their XII ones — so which session is on screen decides what this shows.
  const session = useAcademicSession();
  const sessionId = session.sessionId;

  const refresh = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    const [eRes, sRes] = await Promise.all([
      adminFetch(
        sessionId
          ? `/api/electives?academic_year_id=${sessionId}`
          : "/api/electives"
      ),
      supabase.from("subjects").select("id, name, code").eq("is_active", true).order("name"),
    ]);
    if (!eRes.ok) {
      toast.error("Failed to load electives");
      setLoading(false);
      return;
    }
    const data = await eRes.json();
    setOptions(data.options ?? []);
    setStudents(data.students ?? []);
    setPicks(data.picks ?? []);
    setAllSubjects((sRes.data as SubjectLite[]) ?? []);
    setLoading(false);
  }, [supabase, sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Switching class resets anything scoped to the old one — a selection or a
  // filter carried across would act on students no longer on screen.
  const switchClass = useCallback(
    (cls: ElectiveClass) => {
      setClassParam(cls);
      setSelectedIds(new Set());
      setIncompleteOnly(false);
      setBulkSubjectId("");
      setOptionsOpenOverride(null);
    },
    [setClassParam]
  );

  // ── Options, bucketed by class then slot ──
  // Built once per fetch rather than per rendered cell; the student table
  // reads it for every row.
  const optionsByClassSlot = useMemo(() => {
    const byClass = new Map<string, Map<number, SlotOption[]>>();
    for (const cls of ELECTIVE_CLASSES) byClass.set(cls, new Map());
    for (const o of options) {
      for (const cls of ELECTIVE_CLASSES) {
        if (!optionAppliesTo(o.applies_to_classes, cls)) continue;
        const bySlot = byClass.get(cls)!;
        const arr = bySlot.get(o.slot) ?? [];
        arr.push(o);
        bySlot.set(o.slot, arr);
      }
    }
    return byClass;
  }, [options]);

  const optionsFor = useCallback(
    (cls: string, slot: number) => optionsByClassSlot.get(cls)?.get(slot) ?? [],
    [optionsByClassSlot]
  );

  const tabHasOptions = useMemo(
    () => SLOTS.some((slot) => optionsFor(classTab, slot).length > 0),
    [optionsFor, classTab]
  );

  const optionsOpen = optionsOpenOverride ?? !tabHasOptions;

  const pickFor = useCallback(
    (studentId: string, slot: number) =>
      picks.find((p) => p.student_id === studentId && p.elective_slot === slot),
    [picks]
  );

  // ── Students, scoped to the selected class ──
  const classStudents = useMemo(
    () => students.filter((s) => pickOne(s.classes)?.name === classTab),
    [students, classTab]
  );

  const isComplete = useCallback(
    (studentId: string) => SLOTS.every((slot) => pickFor(studentId, slot)),
    [pickFor]
  );

  const stats = useMemo(() => {
    const total = classStudents.length;
    const complete = classStudents.filter((s) => isComplete(s.student_id)).length;
    return { total, complete, outstanding: total - complete };
  }, [classStudents, isComplete]);

  const visibleStudents = useMemo(
    () =>
      incompleteOnly
        ? classStudents.filter((s) => !isComplete(s.student_id))
        : classStudents,
    [classStudents, incompleteOnly, isComplete]
  );

  // How many students of THIS class hold each option — the office needs this
  // to judge whether a subject has takers before dropping it.
  const takersByOption = useMemo(() => {
    const counts = new Map<string, number>();
    const inClass = new Set(classStudents.map((s) => s.student_id));
    for (const p of picks) {
      if (!inClass.has(p.student_id)) continue;
      const key = `${p.elective_slot}:${p.subject_id}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [picks, classStudents]);

  const optionCountByClass = useMemo(() => {
    const counts = {} as Record<ElectiveClass, number>;
    for (const cls of ELECTIVE_CLASSES) {
      let total = 0;
      for (const arr of optionsByClassSlot.get(cls)?.values() ?? []) total += arr.length;
      counts[cls] = total;
    }
    return counts;
  }, [optionsByClassSlot]);

  // The switcher counts students, not options — next to "Class XI" any other
  // number reads as the size of the class.
  const studentCountByClass = useMemo(() => {
    const counts = {} as Record<ElectiveClass, number>;
    for (const cls of ELECTIVE_CLASSES) {
      counts[cls] = students.filter(
        (s) => pickOne(s.classes)?.name === cls
      ).length;
    }
    return counts;
  }, [students]);

  // Header sort/filter accessors — mirror what the matching cell renders.
  //
  // The elective slot columns hold live <Select> pickers, but they are still
  // declared here: the picker is the *editor*, the accessor is the value, and
  // without an accessor the page could not answer "who picked Biology?" at
  // all — which is the question this page exists to support and the one it
  // could not answer before.
  const columns = useMemo<TableColumns<StudentRow>>(
    () => ({
      admission_no: {
        label: "Admission #",
        value: (s) => pickOne(s.students)?.admission_no ?? null,
        filter: "text",
      },
      full_name: {
        label: "Name",
        value: (s) => pickOne(s.students)?.full_name ?? null,
        filter: "text",
      },
      section: {
        label: "Section",
        value: (s) => pickOne(s.classes)?.section ?? null,
      },
      stream: {
        label: "Stream",
        value: (s) => pickOne(s.streams)?.name ?? null,
      },
      ...Object.fromEntries(
        SLOTS.map((slot) => [
          `elective_${slot}`,
          {
            label: `Elective ${slot}`,
            value: (s: StudentRow) =>
              picks.find(
                (p) => p.student_id === s.student_id && p.elective_slot === slot
              )?.subject_name ?? null,
            emptyLabel: "Not picked",
          },
        ])
      ),
    }),
    [picks]
  );

  const table = useTableControls({ rows: visibleStudents, columns });

  // ── Selection ──
  const rowIds = useMemo(
    () => table.rows.map((s) => s.student_id),
    [table.rows]
  );
  const allRowsSelected =
    rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));

  const toggleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allRowsSelected) rowIds.forEach((id) => next.delete(id));
      else rowIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Option CRUD ──

  // Adds to the class currently selected in the header. If the subject is
  // already offered in this slot to the OTHER class, the server widens that
  // single row rather than creating a duplicate.
  const handleAddOption = async (slot: number) => {
    const subjectId = newSubjectIdBySlot[slot];
    if (!subjectId) {
      toast.error("Pick a subject first");
      return;
    }
    const res = await adminFetch("/api/electives/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slot,
        subject_id: subjectId,
        applies_to_classes: [classTab],
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Failed to add option");
      return;
    }
    setNewSubjectIdBySlot((s) => ({ ...s, [slot]: "" }));
    await refresh(true);
  };

  // Removing from the XI list must not empty the XII list. If the option is
  // shared, narrow it to the other class; only when this tab holds its last
  // class does the row go.
  const handleRemoveOption = async (option: SlotOption) => {
    const current = normaliseElectiveClasses(option.applies_to_classes);
    const remaining = current.filter((c) => c !== classTab);
    const name = option.subjects?.name ?? "this subject";
    const takers = takersByOption.get(`${option.slot}:${option.subject_id}`) ?? 0;

    const takerNote =
      takers > 0
        ? `\n\n${takers} class ${classTab} student${takers === 1 ? "" : "s"} currently hold${takers === 1 ? "s" : ""} this pick. Their selection stays until you change it, but it will show as no longer offered.`
        : "";
    const message =
      remaining.length > 0
        ? `Remove ${name} from the class ${classTab} list? It stays available to ${remaining.join(" & ")}.${takerNote}`
        : `Remove ${name} from Elective ${option.slot} entirely?${takerNote}`;
    if (!confirm(message)) return;

    const res = await adminFetch("/api/electives/options", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: option.id, applies_to_classes: remaining }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Failed to remove option");
      return;
    }
    await refresh(true);
  };

  // ── Picks ──

  /** One student, one slot. Returns whether it stuck, for the bulk caller. */
  const savePick = useCallback(
    async (studentId: string, slot: number, subjectId: string) => {
      if (!subjectId) {
        const res = await adminFetch(
          `/api/electives/students?student_id=${studentId}&slot=${slot}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return { ok: false, error: data.error || "Failed to clear pick" };
        }
        return { ok: true as const };
      }
      const res = await adminFetch("/api/electives/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: studentId, slot, subject_id: subjectId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, error: data.error || "Failed to save pick" };
      }
      return { ok: true as const };
    },
    []
  );

  const handleSetPick = async (studentId: string, slot: number, subjectId: string) => {
    const key = `${studentId}:${slot}`;
    setSavingStudent(key);
    const result = await savePick(studentId, slot, subjectId);
    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
    } else {
      setJustSaved((s) => ({ ...s, [key]: true }));
      setTimeout(
        () =>
          setJustSaved((s) => {
            const next = { ...s };
            delete next[key];
            return next;
          }),
        2000
      );
    }
    await refresh(true);
    setSavingStudent(null);
  };

  const handleBulkApply = async () => {
    const slot = Number(bulkSlot);
    const ids = table.rows
      .map((s) => s.student_id)
      .filter((id) => selectedIds.has(id));
    if (ids.length === 0 || !bulkSubjectId) return;

    const subject = optionsFor(classTab, slot).find(
      (o) => o.subject_id === bulkSubjectId
    );
    const alreadySet = ids.filter(
      (id) => pickFor(id, slot)?.subject_id === bulkSubjectId
    ).length;
    const overwriting = ids.filter((id) => {
      const cur = pickFor(id, slot);
      return cur && cur.subject_id !== bulkSubjectId;
    }).length;

    const warning = overwriting
      ? `\n\n${overwriting} of them already ${overwriting === 1 ? "has" : "have"} a different subject in Elective ${slot} — that pick will be replaced.`
      : "";
    if (
      !confirm(
        `Set Elective ${slot} to ${subject?.subjects?.name ?? "this subject"} for ${ids.length} class ${classTab} student${ids.length === 1 ? "" : "s"}?${warning}`
      )
    )
      return;

    setBulkRunning(true);
    const toastId = toast.loading(`Assigning 0 / ${ids.length}…`);
    let done = 0;
    const failures: string[] = [];

    // Sequential rather than parallel: this fans out to one row-level write
    // each, and a burst of 50 concurrent writes buys nothing but a harder
    // failure to interpret when one of them errors.
    for (const id of ids) {
      const result = await savePick(id, slot, bulkSubjectId);
      done += 1;
      if (!result.ok) {
        const name = pickOne(
          classStudents.find((s) => s.student_id === id)?.students ?? null
        )?.full_name;
        failures.push(name ?? id);
      }
      toast.loading(`Assigning ${done} / ${ids.length}…`, { id: toastId });
    }

    const succeeded = ids.length - failures.length;
    if (failures.length === 0) {
      toast.success(
        `Elective ${slot} set for ${succeeded} student${succeeded === 1 ? "" : "s"}${
          alreadySet ? ` (${alreadySet} already had it)` : ""
        }`,
        { id: toastId }
      );
    } else {
      toast.error(
        `${succeeded} updated, ${failures.length} failed: ${failures.slice(0, 3).join(", ")}${failures.length > 3 ? "…" : ""}`,
        { id: toastId, duration: 10000 }
      );
    }

    setBulkRunning(false);
    setSelectedIds(new Set());
    setBulkSubjectId("");
    await refresh(true);
  };

  if (loading) {
    return (
      <div className="space-y-4 p-6" aria-busy="true" aria-live="polite">
        <div className="h-9 w-64 animate-pulse rounded-lg bg-gray-100 dark:bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-muted" />
        <div className="h-96 animate-pulse rounded-xl bg-gray-100 dark:bg-muted" />
        <span className="sr-only">Loading electives…</span>
      </div>
    );
  }

  const bulkSelectedCount = rowIds.filter((id) => selectedIds.has(id)).length;
  const bulkOptions = optionsFor(classTab, Number(bulkSlot));

  return (
    <div className="space-y-6 p-6">
      {/* ─────────────── Header + class switcher ─────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="erp-page-icon">
            <GraduationCap className="h-4.5 w-4.5 text-gold-400" />
          </div>
          <div>
            <h1 className="erp-page-title">Class {classTab} Electives</h1>
            <p className="erp-page-subtitle">
              Set the subjects offered in each elective slot, then assign every
              class {classTab} student one option per slot.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
        <AcademicSessionPicker state={session} />

        <div
          role="group"
          aria-label="Show electives for class"
          className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-muted"
        >
          {ELECTIVE_CLASSES.map((cls) => (
            <button
              key={cls}
              type="button"
              aria-pressed={classTab === cls}
              onClick={() => switchClass(cls)}
              className={cn(
                "cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-900 dark:focus-visible:ring-white",
                classTab === cls
                  ? "bg-white text-navy-900 shadow-sm dark:bg-card dark:text-white"
                  : "text-gray-500 hover:text-navy-900 dark:text-gray-400 dark:hover:text-white"
              )}
            >
              Class {cls}
              <span
                className="ml-1.5 text-xs text-gray-400"
                title={`${studentCountByClass[cls]} students`}
              >
                {studentCountByClass[cls]}
              </span>
            </button>
          ))}
        </div>
        </div>
      </header>

      {/* ─────────────── Progress ─────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile icon={Users} label={`Class ${classTab} students`} value={stats.total} />
        <StatTile icon={Check} label="Both electives set" value={stats.complete} tone="good" />
        <StatTile
          icon={TriangleAlert}
          label="Still incomplete"
          value={stats.outstanding}
          tone="warn"
          active={incompleteOnly}
          onClick={
            stats.outstanding > 0 || incompleteOnly
              ? () => setIncompleteOnly((v) => !v)
              : undefined
          }
        />
      </div>

      {/* ─────────────── Slot options manager ─────────────── */}
      <section className="erp-table-container">
        <button
          type="button"
          onClick={() => setOptionsOpenOverride(!optionsOpen)}
          aria-expanded={optionsOpen}
          className="flex w-full cursor-pointer items-center justify-between gap-3 p-6 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-900 dark:focus-visible:ring-white"
        >
          <div>
            <h2 className="erp-section-title">
              Subjects offered to class {classTab}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {optionCountByClass[classTab]} option
              {optionCountByClass[classTab] === 1 ? "" : "s"} across{" "}
              {SLOTS.length} slots. XI and XII have separate lists — a subject
              shown in both is stored once.
            </p>
          </div>
          <ChevronDown
            className={cn(
              "h-5 w-5 shrink-0 text-gray-400 transition-transform duration-200",
              optionsOpen && "rotate-180"
            )}
          />
        </button>

        {optionsOpen && (
          <div className="grid grid-cols-1 gap-6 px-6 pb-6 md:grid-cols-2">
            {SLOTS.map((slot) => {
              const slotOptions = optionsFor(classTab, slot);
              return (
                <div
                  key={slot}
                  className="rounded-xl border border-gray-200 p-4 dark:border-border"
                >
                  <h3 className="mb-3 text-sm font-semibold">
                    Elective {slot}
                    <span className="ml-1.5 text-xs font-normal text-gray-400">
                      class {classTab}
                    </span>
                  </h3>
                  <ul className="mb-3 space-y-1.5">
                    {slotOptions.length === 0 && (
                      <li className="rounded-md border border-dashed border-gray-200 px-2.5 py-3 text-center text-xs text-gray-400 dark:border-border">
                        No subjects offered to class {classTab} in this slot yet.
                        Add one below.
                      </li>
                    )}
                    {slotOptions.map((o) => {
                      const shared =
                        normaliseElectiveClasses(o.applies_to_classes).length > 1;
                      const takers =
                        takersByOption.get(`${o.slot}:${o.subject_id}`) ?? 0;
                      return (
                        <li
                          key={o.id}
                          className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-2.5 py-1.5 dark:bg-muted"
                        >
                          <span className="min-w-0 text-sm">
                            <span className="truncate">
                              {o.subjects?.name ?? "Unknown"}
                            </span>
                            {o.subjects?.code && (
                              <span className="ml-1 text-xs text-gray-400">
                                ({o.subjects.code})
                              </span>
                            )}
                            {shared && (
                              <Badge
                                variant="secondary"
                                className="ml-1.5 bg-blue-50 text-[10px] text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                              >
                                XI &amp; XII
                              </Badge>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span
                              className={cn(
                                "text-xs tabular-nums",
                                takers > 0 ? "text-gray-500" : "text-gray-300 dark:text-gray-600"
                              )}
                              title={`${takers} class ${classTab} student${takers === 1 ? "" : "s"} picked this`}
                            >
                              {takers}
                            </span>
                            <button
                              onClick={() => handleRemoveOption(o)}
                              aria-label={
                                shared
                                  ? `Remove ${o.subjects?.name ?? "subject"} from the class ${classTab} list`
                                  : `Remove ${o.subjects?.name ?? "subject"} from Elective ${slot}`
                              }
                              className="cursor-pointer rounded p-0.5 text-gray-400 transition-colors hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Label
                        htmlFor={`add-subject-${slot}`}
                        className="text-[11px] text-gray-500"
                      >
                        Add subject to class {classTab}
                      </Label>
                      <Select
                        value={newSubjectIdBySlot[slot] ?? ""}
                        onValueChange={(v) =>
                          setNewSubjectIdBySlot((s) => ({ ...s, [slot]: v ?? "" }))
                        }
                      >
                        <SelectTrigger id={`add-subject-${slot}`} className="h-9">
                          <SelectValue placeholder="Pick a subject" />
                        </SelectTrigger>
                        <SelectContent>
                          {allSubjects
                            .filter((s) => !slotOptions.find((o) => o.subject_id === s.id))
                            .map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                                {s.code ? ` (${s.code})` : ""}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleAddOption(slot)}
                      className="bg-navy-900 text-white hover:bg-navy-800"
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─────────────── Per-student picker ─────────────── */}
      <section className="erp-table-container p-4 sm:p-6">
        <h2 className="erp-section-title mb-4">
          Class {classTab} students
          {incompleteOnly && (
            <Badge
              variant="secondary"
              className="ml-2 bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
            >
              incomplete only
            </Badge>
          )}
        </h2>

        {!tabHasOptions ? (
          <div className="py-12 text-center">
            <GraduationCap className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No subjects are offered to class {classTab} yet.
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Add options above before assigning students.
            </p>
          </div>
        ) : classStudents.length === 0 ? (
          <div className="py-12 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No class {classTab} students enrolled in the current academic year.
            </p>
          </div>
        ) : (
          <>
            {/* Bulk action bar — appears only with a selection. */}
            {bulkSelectedCount > 0 && (
              <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-border dark:bg-muted">
                <span className="text-sm font-medium text-blue-900 dark:text-white">
                  {bulkSelectedCount} student
                  {bulkSelectedCount === 1 ? "" : "s"} selected
                </span>
                <div className="w-28">
                  <Label htmlFor="bulk-slot" className="text-[11px] text-gray-500">
                    Slot
                  </Label>
                  <Select
                    value={bulkSlot}
                    onValueChange={(v) => {
                      if (!v) return;
                      setBulkSlot(v);
                      setBulkSubjectId("");
                    }}
                  >
                    <SelectTrigger id="bulk-slot" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SLOTS.map((slot) => (
                        <SelectItem key={slot} value={String(slot)}>
                          Elective {slot}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-56">
                  <Label htmlFor="bulk-subject" className="text-[11px] text-gray-500">
                    Set to
                  </Label>
                  <Select
                    value={bulkSubjectId}
                    onValueChange={(v) => setBulkSubjectId(v ?? "")}
                  >
                    <SelectTrigger id="bulk-subject" className="h-9">
                      <SelectValue
                        placeholder={
                          bulkOptions.length === 0
                            ? `No Elective ${bulkSlot} options`
                            : "Pick a subject"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {bulkOptions.map((o) => (
                        <SelectItem key={o.id} value={o.subject_id}>
                          {o.subjects?.name ?? "Unknown"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={!bulkSubjectId || bulkRunning}
                  onClick={handleBulkApply}
                  className="bg-navy-900 text-white hover:bg-navy-800"
                >
                  {bulkRunning && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Apply to {bulkSelectedCount}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={bulkRunning}
                  onClick={() => setSelectedIds(new Set())}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Clear
                </Button>
              </div>
            )}

            <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
              <TableFilterSummary
                ctl={table}
                total={visibleStudents.length}
                shown={table.rows.length}
                className="mb-0 mr-auto"
              />
              <TableExportButton
                ctl={table}
                filename="electives"
                title="Elective Choices"
                featureKey="subjects"
              />
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allRowsSelected}
                        onCheckedChange={toggleAll}
                        aria-label={
                          allRowsSelected
                            ? "Clear selection"
                            : "Select all listed students"
                        }
                      />
                    </TableHead>
                    <SortFilterHead ctl={table} col="admission_no" />
                    <SortFilterHead ctl={table} col="full_name" />
                    <SortFilterHead ctl={table} col="section" />
                    <SortFilterHead ctl={table} col="stream" />
                    {SLOTS.map((slot) => (
                      <SortFilterHead
                        key={slot}
                        ctl={table}
                        col={`elective_${slot}`}
                      />
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {table.rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5 + SLOTS.length}
                        className="py-10 text-center text-gray-500 dark:text-gray-400"
                      >
                        {incompleteOnly
                          ? `Every class ${classTab} student has both electives set.`
                          : "No students match the column filters."}
                      </TableCell>
                    </TableRow>
                  )}
                  {table.rows.map((s) => {
                    const cls = pickOne(s.classes);
                    const stu = pickOne(s.students);
                    const str = pickOne(s.streams);
                    const selected = selectedIds.has(s.student_id);
                    return (
                      <TableRow
                        key={s.id}
                        className={cn(selected && "bg-blue-50/60 dark:bg-muted/50")}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selected}
                            onCheckedChange={() => toggleOne(s.student_id)}
                            aria-label={`Select ${stu?.full_name ?? "student"}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {stu?.admission_no ?? "—"}
                        </TableCell>
                        <TableCell className="font-medium">
                          {stu?.full_name ?? "—"}
                        </TableCell>
                        <TableCell>{cls?.section ?? "—"}</TableCell>
                        <TableCell>
                          {str?.name ? (
                            <Badge variant="secondary" className="bg-gray-100 dark:bg-muted">
                              {str.name}
                            </Badge>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </TableCell>
                        {SLOTS.map((slot) => {
                          // Scoped to this student's class — which is the
                          // selected class, since the table is filtered.
                          const slotOptions = optionsFor(cls?.name ?? "", slot);
                          const current = pickFor(s.student_id, slot);
                          const key = `${s.student_id}:${slot}`;
                          const saving = savingStudent === key;
                          const saved = justSaved[key];
                          const stale =
                            current &&
                            !slotOptions.some((o) => o.subject_id === current.subject_id);
                          return (
                            <TableCell key={slot}>
                              <div className="flex items-center gap-1.5">
                                <Select
                                  value={current?.subject_id ?? ""}
                                  onValueChange={(v) =>
                                    handleSetPick(s.student_id, slot, v ?? "")
                                  }
                                  disabled={saving || bulkRunning}
                                >
                                  <SelectTrigger
                                    aria-label={`Elective ${slot} for ${stu?.full_name ?? "student"}`}
                                    className={cn(
                                      "h-8 min-w-[180px] text-xs",
                                      stale && "border-amber-400 dark:border-amber-700",
                                      !current &&
                                        "border-dashed text-gray-400 dark:text-gray-500"
                                    )}
                                  >
                                    <SelectValue
                                      placeholder={
                                        saving
                                          ? "Saving…"
                                          : slotOptions.length === 0
                                            ? `No class ${cls?.name ?? "—"} options`
                                            : "Not picked"
                                      }
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {slotOptions.map((o) => (
                                      <SelectItem key={o.id} value={o.subject_id}>
                                        {o.subjects?.name ?? "Unknown"}
                                      </SelectItem>
                                    ))}
                                    {/* A pick made before the lists were split
                                        can fall outside this class's options.
                                        Keep it listed so the cell shows a name
                                        instead of a raw id, and flag it. */}
                                    {stale && current && (
                                      <SelectItem
                                        value={current.subject_id}
                                        label={`${current.subject_name} (no longer offered)`}
                                      >
                                        {current.subject_name}
                                        <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">
                                          no longer offered
                                        </span>
                                      </SelectItem>
                                    )}
                                  </SelectContent>
                                </Select>
                                {saving ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                                ) : saved ? (
                                  <Check
                                    className="h-3.5 w-3.5 text-green-600 dark:text-green-400"
                                    aria-label="Saved"
                                  />
                                ) : current ? (
                                  <button
                                    onClick={() => handleSetPick(s.student_id, slot, "")}
                                    aria-label={`Clear Elective ${slot} for ${stu?.full_name ?? "student"}`}
                                    className="cursor-pointer rounded p-0.5 text-gray-400 transition-colors hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                ) : (
                                  <span className="inline-block w-[18px]" aria-hidden />
                                )}
                              </div>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
