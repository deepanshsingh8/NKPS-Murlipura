"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { buildElectiveFilter } from "@nkps/shared/lib/elective-timetable";
import { Card, CardContent, CardHeader, CardTitle } from "@nkps/shared/components/ui/card";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Loader2, Clock, Users, Sun } from "lucide-react";
import {
  cn,
  dayOfWeekFromDate,
  formatTime12,
  nowMinutes,
  timeStringToMinutes,
} from "@nkps/shared/lib/utils";
import { NativeSelect } from "@nkps/shared/components/ui/native-select";
import { categoricalChip } from "@nkps/shared/lib/palette";

interface ChildOption {
  student_id: string;
  full_name: string;
  class_name: string | null;
  section: string | null;
}

interface TimetableEntry {
  id: string;
  day_of_week: number;
  period_number: number;
  start_time: string;
  end_time: string;
  room: string | null;
  group_no?: number;
  group_label?: string | null;
  /** Needed to match a group against this child's elective picks. */
  subject_id: string | null;
  subject: { name: string } | null;
  teacher: { full_name: string } | null;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NUMBERS = [1, 2, 3, 4, 5, 6];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];


export default function ParentTimetablePage() {
  const searchParams = useSearchParams();
  const preselectedChild = searchParams.get("child");

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedChild, setSelectedChild] = useState<string>("");
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [subjectColorMap, setSubjectColorMap] = useState<Record<string, string>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [loadingTimetable, setLoadingTimetable] = useState(false);

  useEffect(() => {
    async function fetchChildren() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("parent_id")
        .eq("id", user.id)
        .single();

      const parentId = profile?.parent_id;
      if (!parentId) {
        setLoading(false);
        return;
      }

      const { data: studentParents } = await supabase
        .from("student_parents")
        .select("student_id, students(id, full_name)")
        .eq("parent_id", parentId);

      if (!studentParents || studentParents.length === 0) {
        setLoading(false);
        return;
      }

      // One enrollment read for every child. PostgREST rejects an empty
      // `.in()` list, so skip the query when no link row carries a student.
      const studentIds = studentParents
        .map((sp) => (sp.students as unknown as { id: string } | null)?.id)
        .filter((id): id is string => Boolean(id));

      // Unordered, as this selector has always been: the first row the server
      // returns for a student is the class label shown against their name.
      const classByStudent = new Map<
        string,
        { name: string; section: string } | null
      >();
      if (studentIds.length > 0) {
        const { data: enrollments } = await supabase
          .from("student_enrollments")
          .select("student_id, classes(name, section)")
          .in("student_id", studentIds);

        for (const row of (enrollments ?? []) as unknown as {
          student_id: string;
          classes: { name: string; section: string } | null;
        }[]) {
          if (!classByStudent.has(row.student_id)) {
            classByStudent.set(row.student_id, row.classes ?? null);
          }
        }
      }

      const childOptions: ChildOption[] = [];
      for (const sp of studentParents) {
        const student = sp.students as unknown as {
          id: string;
          full_name: string;
        };
        if (!student) continue;

        const classInfo = classByStudent.get(student.id) ?? null;

        childOptions.push({
          student_id: student.id,
          full_name: student.full_name,
          class_name: classInfo?.name ?? null,
          section: classInfo?.section ?? null,
        });
      }

      setChildren(childOptions);

      const initial =
        preselectedChild &&
        childOptions.some((c) => c.student_id === preselectedChild)
          ? preselectedChild
          : childOptions[0]?.student_id ?? "";
      setSelectedChild(initial);
      setLoading(false);
    }

    fetchChildren();
  }, [preselectedChild]);

  useEffect(() => {
    if (!selectedChild) return;

    async function fetchTimetable() {
      setLoadingTimetable(true);
      const supabase = createClient();

      // The class NAME as well as the id: an elective option is scoped to XI
      // or XII by name. Year-scoped too — a child enrolled in more than one
      // year would otherwise be filtered against the wrong class.
      const { data: currentYear } = await supabase
        .from("academic_years")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();

      let enrollmentQuery = supabase
        .from("student_enrollments")
        .select("class_id, classes(name)")
        .eq("student_id", selectedChild);
      if (currentYear?.id) {
        enrollmentQuery = enrollmentQuery.eq("academic_year_id", currentYear.id);
      }
      const { data: enrollment } = await enrollmentQuery
        .order("enrollment_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!enrollment) {
        setEntries([]);
        setSubjectColorMap({});
        setLoadingTimetable(false);
        return;
      }

      const { data } = await supabase
        .from("timetable_periods")
        .select(
          "id, day_of_week, period_number, start_time, end_time, room, group_no, group_label, subject_id, subject:subjects(name), teacher:teachers(full_name)"
        )
        .eq("class_id", enrollment.class_id)
        .order("period_number", { ascending: true });

      const rows = (data ?? []) as unknown as TimetableEntry[];

      // Show this child's own optional subject, not both sides of the slot.
      // Filtered on the way into state so today's list, the period rows and
      // the subject colours all describe the timetable they actually attend.
      // This effect re-runs on selectedChild, so switching child re-filters.
      const clsRel = enrollment.classes as unknown as
        | { name: string }
        | { name: string }[]
        | null;
      const className =
        (Array.isArray(clsRel) ? clsRel[0] : clsRel)?.name ?? null;
      const [{ data: options }, { data: picks }] = await Promise.all([
        supabase
          .from("elective_slot_options")
          .select("slot, subject_id, applies_to_classes, is_active")
          .eq("is_active", true),
        supabase
          .from("student_elective_picks")
          .select("slot, subject_id")
          .eq("student_id", selectedChild),
      ]);
      const showGroup = buildElectiveFilter({
        options: options ?? [],
        picks: picks ?? [],
        className,
      });
      const timetableData = rows.filter((e) => showGroup(e.subject_id));
      setEntries(timetableData);

      const subjects = [
        ...new Set(timetableData.map((e) => e.subject?.name).filter(Boolean)),
      ];
      const colorMap: Record<string, string> = {};
      subjects.forEach((subj) => {
        if (subj) colorMap[subj] = categoricalChip(subj);
      });
      setSubjectColorMap(colorMap);

      setLoadingTimetable(false);
    }

    fetchTimetable();
  }, [selectedChild]);

  const todayDow = useMemo(() => dayOfWeekFromDate(), []);
  const todayEntries = useMemo(
    () =>
      entries
        .filter((e) => e.day_of_week === todayDow)
        .sort((a, b) => a.period_number - b.period_number),
    [entries, todayDow]
  );
  // Derive period rows from the actual timetable (shows a zero period and
  // scales past 8), falling back to the default 1–8 when empty.
  const periodList = useMemo(() => {
    const nums = Array.from(new Set(entries.map((e) => e.period_number))).sort(
      (a, b) => a - b
    );
    return nums.length > 0 ? nums : PERIODS;
  }, [entries]);

  const now = nowMinutes();

  // A cell can hold parallel groups — Games split into basketball/badminton/
  // cricket, or an XI/XII period running IP alongside P.Ed (migration 119).
  // `entries` has already had this child's non-electives filtered out, so a
  // Games cell still shows all three sports (nobody picks between them) while
  // an optional slot shows only the subject they take.
  const getEntries = (day: number, period: number) =>
    entries
      .filter((e) => e.day_of_week === day && e.period_number === period)
      .sort((a, b) => (a.group_no ?? 0) - (b.group_no ?? 0));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-white" />
      </div>
    );
  }

  const selectedChildInfo = children.find((c) => c.student_id === selectedChild);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Timetable
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {selectedChildInfo
              ? `${selectedChildInfo.full_name}${
                  selectedChildInfo.class_name
                    ? ` | ${selectedChildInfo.class_name} - ${selectedChildInfo.section}`
                    : ""
                }`
              : "Weekly class schedule."}
          </p>
        </div>

        {children.length > 1 && (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gray-400" />
            <NativeSelect
              value={selectedChild}
              onChange={(e) => setSelectedChild(e.target.value)}
            >
              {children.map((child) => (
                <option key={child.student_id} value={child.student_id}>
                  {child.full_name}
                  {child.class_name
                    ? ` (${child.class_name} - ${child.section})`
                    : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      {/* Today at a glance */}
      {entries.length > 0 && !loadingTimetable && (
        <Card className="bg-white dark:bg-card rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white">
              <Sun className="h-5 w-5 text-gold-500" />
              Today
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                {todayDow === 7 ? "Sunday" : DAYS[todayDow - 1]}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {todayDow === 7 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No classes today.
              </p>
            ) : todayEntries.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No periods scheduled for today.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-border">
                {todayEntries.map((p) => {
                  const startM = timeStringToMinutes(p.start_time);
                  const endM = timeStringToMinutes(p.end_time);
                  const isPast = endM <= now;
                  const isNow = startM <= now && endM > now;
                  return (
                    <li
                      key={p.id}
                      className={cn(
                        "flex items-center gap-4 py-2.5 text-sm",
                        isPast && "opacity-60",
                        isNow && "bg-gold-50 dark:bg-gold-500/10 -mx-4 px-4 rounded-lg"
                      )}
                    >
                      <div className="w-20 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                        {formatTime12(p.start_time)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-navy-900 dark:text-white truncate">
                          {p.subject?.name ?? "—"}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {p.teacher?.full_name ?? "—"}
                          {p.room ? ` • ${p.room}` : ""}
                        </p>
                      </div>
                      {isNow && (
                        <Badge className="bg-gold-500/20 text-gold-700 dark:text-gold-300 text-[10px] font-semibold">
                          Now
                        </Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="bg-white dark:bg-card rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white">
            <Clock className="h-5 w-5 text-gold-500" />
            Weekly Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingTimetable ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-navy-900 dark:text-white" />
            </div>
          ) : children.length === 0 ? (
            <p className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
              No children linked to your account yet.
            </p>
          ) : entries.length === 0 ? (
            <p className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
              No timetable configured yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="border border-gray-200 dark:border-border bg-navy-900 text-white px-3 py-2 text-sm font-medium">
                      Period
                    </th>
                    {DAYS.map((day, idx) => {
                      const dow = idx + 1;
                      const isToday = dow === todayDow;
                      return (
                        <th
                          key={day}
                          className={cn(
                            "border border-gray-200 dark:border-border text-white px-3 py-2 text-sm font-medium min-w-[140px]",
                            isToday ? "bg-gold-500 text-navy-900" : "bg-navy-900"
                          )}
                        >
                          {day}
                          {isToday && (
                            <span className="ml-1 text-[10px] font-semibold uppercase">
                              Today
                            </span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {periodList.map((period) => (
                    <tr key={period}>
                      <td className="border border-gray-200 dark:border-border bg-gray-50 dark:bg-muted px-3 py-2 text-center text-sm font-medium text-navy-900 dark:text-white">
                        {period === 0 ? "0" : period}
                      </td>
                      {DAY_NUMBERS.map((day) => {
                        const cellEntries = getEntries(day, period);
                        const isToday = day === todayDow;
                        if (cellEntries.length === 0) {
                          return (
                            <td
                              key={day}
                              className={cn(
                                "border border-gray-200 dark:border-border px-3 py-2 text-center text-sm text-gray-300 dark:text-gray-500",
                                isToday && "bg-gold-500/5"
                              )}
                            >
                              Free
                            </td>
                          );
                        }
                        return (
                          <td
                            key={day}
                            className={cn(
                              "border border-gray-200 dark:border-border p-1 align-top",
                              isToday && "ring-2 ring-gold-500/60 ring-inset"
                            )}
                          >
                            <div className="space-y-1">
                              {cellEntries.map((entry) => {
                                const colorClass =
                                  subjectColorMap[entry.subject?.name ?? ""] ??
                                  "bg-gray-50 dark:bg-muted border-gray-200 dark:border-border text-gray-800 dark:text-gray-200";
                                return (
                                  <div
                                    key={entry.id}
                                    className={`rounded-lg border p-2 text-xs ${colorClass}`}
                                  >
                                    <p className="font-semibold">
                                      {entry.subject?.name ?? "--"}
                                      {entry.group_label
                                        ? ` · ${entry.group_label}`
                                        : ""}
                                    </p>
                                    <p className="opacity-75">
                                      {entry.teacher?.full_name ?? "--"}
                                    </p>
                                    {entry.room && (
                                      <p className="opacity-60">
                                        Room: {entry.room}
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
