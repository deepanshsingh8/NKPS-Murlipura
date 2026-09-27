"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi, adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Badge } from "@nkps/shared/components/ui/badge";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, Search } from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";
import { teacherLabel } from "@nkps/shared/lib/teacher-options";
import type { Subject, Teacher } from "@nkps/shared/types";

/**
 * Every subject of one class, edited in a single pass.
 *
 * Replaces adding subjects one dialog at a time — setting a class up with
 * eleven subjects took eleven saves. Tick what the class studies, set the
 * teacher beside each, save once.
 *
 * The teacher picker is where the teacher_subjects mapping (migration 117)
 * pays off: for Mathematics, the school's maths teachers are listed first
 * under their own heading. It is an ordering, not a filter — "Show all
 * teachers" is always one click away, because a subject nobody is mapped to
 * yet must not become a dead end.
 */

export interface ClassSubjectAssignment {
  id: string;
  subject_id: string;
  teacher_id: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  classLabel: string;
  subjects: Subject[];
  teachers: Teacher[];
  /** teacher_id → subject ids they are qualified to teach. */
  teacherSubjectMap: Map<string, Set<string>>;
  /** What the class currently has. */
  assignments: ClassSubjectAssignment[];
  onSaved: () => void;
}

const CATEGORY_ORDER = ["languages", "academic", "co_curricular", null] as const;
const CATEGORY_LABEL: Record<string, string> = {
  languages: "Languages",
  academic: "Academic",
  co_curricular: "Co-curricular",
  uncategorized: "Uncategorized",
};

interface Picked {
  teacher_id: string | null;
  /** The class_subjects row id, when this subject is already assigned. */
  existing_id: string | null;
}

export function ClassSubjectsDialog({
  open,
  onOpenChange,
  classId,
  classLabel,
  subjects,
  teachers,
  teacherSubjectMap,
  assignments,
  onSaved,
}: Props) {
  const [picked, setPicked] = useState<Map<string, Picked>>(new Map());
  const [search, setSearch] = useState("");
  const [showAllFor, setShowAllFor] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);

  // Seed the ticks from what the class actually has. Re-runs when the parent
  // refetches after a save, so a partial save leaves the dialog showing the
  // truth rather than the state that was attempted.
  useEffect(() => {
    if (!open) return;
    const next = new Map<string, Picked>();
    for (const a of assignments) {
      next.set(a.subject_id, { teacher_id: a.teacher_id, existing_id: a.id });
    }
    setPicked(next);
  }, [open, assignments]);

  // Per-opening state, cleared only when the dialog opens on a class — NOT on
  // every `assignments` change. Folding this into the effect above wiped the
  // blocked-removal warning the moment the post-save refetch landed, which is
  // exactly when the admin needs to read it.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setShowAllFor(new Set());
    setBlocked([]);
  }, [open, classId]);

  const activeTeachers = useMemo(
    () => teachers.filter((t) => t.is_active),
    [teachers]
  );

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (s: Subject) =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      (s.code ?? "").toLowerCase().includes(q);

    return CATEGORY_ORDER.map((cat) => ({
      key: cat ?? "uncategorized",
      label: CATEGORY_LABEL[cat ?? "uncategorized"],
      items: subjects.filter((s) => (s.category ?? null) === cat).filter(match),
    })).filter((g) => g.items.length > 0);
  }, [subjects, search]);

  const toggle = (subjectId: string) => {
    setPicked((prev) => {
      const next = new Map(prev);
      const existing = next.get(subjectId);
      if (existing) {
        next.delete(subjectId);
      } else {
        // Pre-select the single qualified teacher when there is exactly one —
        // with three maths teachers it stays blank and the admin chooses.
        const qualified = activeTeachers.filter((t) =>
          teacherSubjectMap.get(t.id)?.has(subjectId)
        );
        next.set(subjectId, {
          teacher_id: qualified.length === 1 ? qualified[0].id : null,
          existing_id: null,
        });
      }
      return next;
    });
  };

  const setTeacher = (subjectId: string, teacherId: string | null) => {
    setPicked((prev) => {
      const next = new Map(prev);
      const cur = next.get(subjectId);
      if (cur) next.set(subjectId, { ...cur, teacher_id: teacherId });
      return next;
    });
  };

  const toggleGroup = (items: Subject[], on: boolean) => {
    setPicked((prev) => {
      const next = new Map(prev);
      for (const s of items) {
        if (on && !next.has(s.id)) {
          const qualified = activeTeachers.filter((t) =>
            teacherSubjectMap.get(t.id)?.has(s.id)
          );
          next.set(s.id, {
            teacher_id: qualified.length === 1 ? qualified[0].id : null,
            existing_id: null,
          });
        } else if (!on) {
          next.delete(s.id);
        }
      }
      return next;
    });
  };

  // Teachers for one subject, qualified ones first under their own heading.
  const teacherChoicesFor = (subjectId: string, currentId: string | null) => {
    const qualified: Teacher[] = [];
    const others: Teacher[] = [];
    for (const t of activeTeachers) {
      if (teacherSubjectMap.get(t.id)?.has(subjectId)) qualified.push(t);
      else others.push(t);
    }
    // A retired teacher already named on this row stays selectable, or the
    // Select renders blank and the save silently clears them. (migration 116)
    const retained =
      currentId && !activeTeachers.some((t) => t.id === currentId)
        ? teachers.find((t) => t.id === currentId)
        : undefined;
    return { qualified, others, retained };
  };

  const save = async () => {
    setSaving(true);
    setBlocked([]);

    const before = new Map(assignments.map((a) => [a.subject_id, a]));
    const add: { subject_id: string; teacher_id: string | null }[] = [];
    const remove: string[] = [];
    const teacherChanges: { id: string; teacher_id: string | null }[] = [];

    for (const [subjectId, p] of picked) {
      const prior = before.get(subjectId);
      if (!prior) {
        add.push({ subject_id: subjectId, teacher_id: p.teacher_id });
      } else if (prior.teacher_id !== p.teacher_id) {
        teacherChanges.push({ id: prior.id, teacher_id: p.teacher_id });
      }
    }
    for (const a of assignments) {
      if (!picked.has(a.subject_id)) remove.push(a.id);
    }

    if (add.length === 0 && remove.length === 0 && teacherChanges.length === 0) {
      toast.message("Nothing changed");
      setSaving(false);
      return;
    }

    let ok = true;

    if (add.length > 0 || remove.length > 0) {
      const res = await adminFetch("/api/subjects/class-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_id: classId, add, remove }),
      });
      const body = await res.json().catch(() => ({}));

      if (Array.isArray(body.removal_blocked) && body.removal_blocked.length) {
        setBlocked(
          body.removal_blocked.map(
            (b: { reason: string }) => b.reason as string
          )
        );
        ok = false;
      }
      if (!res.ok && !body.removal_blocked?.length) {
        toast.error(body.error ?? "Failed to save the class's subjects");
        setSaving(false);
        return;
      }
      for (const e of body.errors ?? []) {
        ok = false;
        toast.error(`${e.label}: ${e.error}`);
      }
    }

    // Teacher changes on rows that already exist go through the generic proxy
    // — one update per row, and there are rarely more than a couple.
    for (const change of teacherChanges) {
      const result = await adminApi({
        action: "update",
        table: "class_subjects",
        data: { teacher_id: change.teacher_id },
        match: { column: "id", value: change.id },
      });
      if (!result.success) {
        ok = false;
        toast.error(result.error ?? "Failed to update a teacher");
      }
    }

    setSaving(false);
    onSaved();

    if (ok) {
      toast.success(`Subjects updated for ${classLabel}`);
      onOpenChange(false);
    }
  };

  const selectedCount = picked.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div>
            <DialogTitle>Subjects for {classLabel}</DialogTitle>
            <p className="text-xs text-gray-500 mt-0.5">
              Tick everything this class studies and set the teacher beside
              each. Saves in one go.
            </p>
          </div>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              className="pl-8 h-9"
              placeholder="Search subjects"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Badge
            variant="secondary"
            className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300"
          >
            {selectedCount} selected
          </Badge>
        </div>

        {blocked.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-sm dark:border-amber-900/40 dark:bg-amber-950/20">
            <p className="flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              Some subjects were kept
            </p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-800/90 dark:text-amber-300/90">
              {blocked.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-amber-800/80 dark:text-amber-300/80">
              Everything else in this save was applied. Deactivate the subject
              instead if the class has stopped studying it.
            </p>
          </div>
        )}

        <div className="max-h-[26rem] overflow-y-auto space-y-4 py-1">
          {grouped.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-500">
              No subjects match “{search}”.
            </p>
          )}
          {grouped.map((group) => {
            const allOn = group.items.every((s) => picked.has(s.id));
            return (
              <div key={group.key}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {group.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.items, !allOn)}
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {allOn ? "Clear all" : "Select all"}
                  </button>
                </div>
                <div className="space-y-1">
                  {group.items.map((subject) => {
                    const entry = picked.get(subject.id);
                    const isSelected = !!entry;
                    const { qualified, others, retained } = teacherChoicesFor(
                      subject.id,
                      entry?.teacher_id ?? null
                    );
                    const showAll =
                      showAllFor.has(subject.id) || qualified.length === 0;

                    return (
                      <div
                        key={subject.id}
                        className={cn(
                          "rounded-lg px-3 py-2 transition-colors",
                          isSelected
                            ? "bg-blue-50 dark:bg-blue-950/20"
                            : "hover:bg-gray-50 dark:hover:bg-muted"
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex flex-1 min-w-[10rem] cursor-pointer items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggle(subject.id)}
                              className="rounded border-gray-300 dark:border-gray-600 text-navy-900 dark:text-white focus:ring-navy-900"
                            />
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {subject.name}
                              {subject.code && (
                                <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-400">
                                  ({subject.code})
                                </span>
                              )}
                            </span>
                          </label>

                          {isSelected && (
                            <div className="w-full sm:w-64">
                              <Select
                                value={entry?.teacher_id ?? "none"}
                                items={[
                                  { value: "none", label: "No teacher yet" },
                                  ...qualified.map((t) => ({
                                    value: t.id,
                                    label: teacherLabel(t),
                                  })),
                                  ...(showAll
                                    ? others.map((t) => ({
                                        value: t.id,
                                        label: teacherLabel(t),
                                      }))
                                    : []),
                                  ...(retained
                                    ? [
                                        {
                                          value: retained.id,
                                          label: `${teacherLabel(retained)} — inactive`,
                                        },
                                      ]
                                    : []),
                                ]}
                                onValueChange={(val) =>
                                  setTeacher(
                                    subject.id,
                                    !val || val === "none" ? null : val
                                  )
                                }
                              >
                                <SelectTrigger className="h-8 w-full text-xs">
                                  <SelectValue placeholder="No teacher yet" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem
                                    value="none"
                                    label="No teacher yet"
                                  >
                                    No teacher yet
                                  </SelectItem>
                                  {qualified.length > 0 && (
                                    <SelectGroup>
                                      <SelectLabel>
                                        Teaches {subject.name}
                                      </SelectLabel>
                                      {qualified.map((t) => (
                                        <SelectItem
                                          key={t.id}
                                          value={t.id}
                                          label={teacherLabel(t)}
                                        >
                                          {teacherLabel(t)}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  )}
                                  {showAll && others.length > 0 && (
                                    <SelectGroup>
                                      <SelectLabel>
                                        {qualified.length > 0
                                          ? "All other teachers"
                                          : "All teachers"}
                                      </SelectLabel>
                                      {others.map((t) => (
                                        <SelectItem
                                          key={t.id}
                                          value={t.id}
                                          label={teacherLabel(t)}
                                        >
                                          {teacherLabel(t)}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  )}
                                  {retained && (
                                    <SelectItem
                                      value={retained.id}
                                      label={`${teacherLabel(retained)} — inactive`}
                                    >
                                      {teacherLabel(retained)} — inactive
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                              {qualified.length > 0 && !showAll && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowAllFor((prev) =>
                                      new Set(prev).add(subject.id)
                                    )
                                  }
                                  className="mt-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  Show all teachers
                                </button>
                              )}
                              {qualified.length === 0 && (
                                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                                  Nobody is mapped to {subject.name} yet — all
                                  teachers listed.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-navy-900 hover:bg-navy-800 text-white"
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Check className="h-4 w-4 mr-1" />
            Save subjects
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
