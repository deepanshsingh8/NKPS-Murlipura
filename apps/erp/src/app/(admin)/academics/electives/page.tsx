"use client";

/**
 * §5 Class XI/XII Elective Slot Manager.
 * Two sections:
 *  1. Slot options — admin-editable list of subjects shown in each elective slot.
 *  2. Per-student picks — for each XI/XII student, two dropdowns (Elective 5, Elective 6).
 *
 * Backed by /api/electives, /api/electives/options, /api/electives/students.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@nkps/shared/components/ui/button";
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
import { Badge } from "@nkps/shared/components/ui/badge";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { toast } from "sonner";

interface SlotOption {
  id: string;
  slot: number;
  subject_id: string;
  label: string | null;
  sort_order: number;
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

export default function ElectivesPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<SlotOption[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [allSubjects, setAllSubjects] = useState<SubjectLite[]>([]);

  const [newSubjectIdBySlot, setNewSubjectIdBySlot] = useState<Record<number, string>>({});
  const [savingStudent, setSavingStudent] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [eRes, sRes] = await Promise.all([
      adminFetch("/api/electives"),
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
  }, [supabase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const optionsBySlot = useMemo(() => {
    const map = new Map<number, SlotOption[]>();
    for (const o of options) {
      const arr = map.get(o.slot) ?? [];
      arr.push(o);
      map.set(o.slot, arr);
    }
    return map;
  }, [options]);

  const pickFor = useCallback(
    (studentId: string, slot: number) =>
      picks.find((p) => p.student_id === studentId && p.elective_slot === slot),
    [picks]
  );

  const handleAddOption = async (slot: number) => {
    const subjectId = newSubjectIdBySlot[slot];
    if (!subjectId) {
      toast.error("Pick a subject first");
      return;
    }
    const res = await adminFetch("/api/electives/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, subject_id: subjectId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Failed to add option");
      return;
    }
    setNewSubjectIdBySlot((s) => ({ ...s, [slot]: "" }));
    await refresh();
  };

  const handleRemoveOption = async (id: string) => {
    if (!confirm("Remove this option? Students who already picked it will keep their selection until you change it.")) return;
    const res = await adminFetch(`/api/electives/options?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Failed to remove");
      return;
    }
    await refresh();
  };

  const handleSetPick = async (studentId: string, slot: number, subjectId: string) => {
    setSavingStudent(`${studentId}:${slot}`);
    if (!subjectId) {
      const res = await adminFetch(
        `/api/electives/students?student_id=${studentId}&slot=${slot}`,
        { method: "DELETE" }
      );
      if (!res.ok) toast.error("Failed to clear pick");
    } else {
      const res = await adminFetch("/api/electives/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: studentId, slot, subject_id: subjectId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to save pick");
      } else {
        toast.success("Saved");
      }
    }
    await refresh();
    setSavingStudent(null);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">
          Class XI–XII Electives
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure the subjects available in each elective slot, then assign each
          senior-class student to one option per slot.
        </p>
      </header>

      {/* ─────────────── Slot options manager ─────────────── */}
      <section className="erp-table-container p-6">
        <h2 className="font-heading text-lg font-semibold mb-4">
          Slot options
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {SLOTS.map((slot) => {
            const slotOptions = optionsBySlot.get(slot) ?? [];
            return (
              <div key={slot} className="rounded-xl border border-gray-200 p-4 dark:border-border">
                <h3 className="text-sm font-semibold mb-3">Elective {slot}</h3>
                <ul className="space-y-1.5 mb-3">
                  {slotOptions.length === 0 && (
                    <li className="text-xs text-gray-400 italic">No options yet.</li>
                  )}
                  {slotOptions.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-center justify-between gap-2 rounded-md bg-gray-50 dark:bg-muted px-2.5 py-1.5"
                    >
                      <span className="text-sm">
                        {o.subjects?.name ?? "Unknown"}
                        {o.subjects?.code && (
                          <span className="text-xs text-gray-400 ml-1">({o.subjects.code})</span>
                        )}
                      </span>
                      <button
                        onClick={() => handleRemoveOption(o.id)}
                        title="Remove option"
                        className="text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label className="text-[11px] text-gray-500">Add subject</Label>
                    <Select
                      value={newSubjectIdBySlot[slot] ?? ""}
                      onValueChange={(v) => setNewSubjectIdBySlot((s) => ({ ...s, [slot]: v ?? "" }))}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Pick a subject" />
                      </SelectTrigger>
                      <SelectContent>
                        {allSubjects
                          .filter((s) => !slotOptions.find((o) => o.subject_id === s.id))
                          .map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}{s.code ? ` (${s.code})` : ""}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleAddOption(slot)}
                    className="bg-navy-900 hover:bg-navy-800 text-white"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─────────────── Per-student picker ─────────────── */}
      <section className="erp-table-container p-6">
        <h2 className="font-heading text-lg font-semibold mb-4">
          Class XI–XII students
        </h2>
        {students.length === 0 ? (
          <p className="text-sm text-gray-400 italic">
            No XI/XII students enrolled in the current academic year.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Admission #</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Stream</TableHead>
                {SLOTS.map((slot) => (
                  <TableHead key={slot}>Elective {slot}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => {
                const cls = pickOne(s.classes);
                const stu = pickOne(s.students);
                const str = pickOne(s.streams);
                return (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">
                    {stu?.admission_no ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium">
                    {stu?.full_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    {cls?.name}-{cls?.section}
                  </TableCell>
                  <TableCell>
                    {str?.name ? (
                      <Badge variant="secondary" className="bg-gray-100">
                        {str.name}
                      </Badge>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </TableCell>
                  {SLOTS.map((slot) => {
                    const slotOptions = optionsBySlot.get(slot) ?? [];
                    const current = pickFor(s.student_id, slot);
                    const saving = savingStudent === `${s.student_id}:${slot}`;
                    return (
                      <TableCell key={slot}>
                        <div className="flex items-center gap-1.5">
                          <Select
                            value={current?.subject_id ?? ""}
                            onValueChange={(v) => handleSetPick(s.student_id, slot, v ?? "")}
                            disabled={saving}
                          >
                            <SelectTrigger className="h-8 text-xs min-w-[180px]">
                              <SelectValue placeholder={saving ? "Saving…" : "Not picked"} />
                            </SelectTrigger>
                            <SelectContent>
                              {slotOptions.map((o) => (
                                <SelectItem key={o.id} value={o.subject_id}>
                                  {o.subjects?.name ?? "Unknown"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {current && !saving && (
                            <button
                              onClick={() => handleSetPick(s.student_id, slot, "")}
                              title="Clear pick"
                              className="text-gray-400 hover:text-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

