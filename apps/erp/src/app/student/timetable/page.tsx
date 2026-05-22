"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@nkps/shared/components/ui/card";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Loader2, Clock, Sun } from "lucide-react";
import {
  dayOfWeekFromDate,
  formatTime12,
  nowMinutes,
  timeStringToMinutes,
  cn,
} from "@nkps/shared/lib/utils";

interface TimetableEntry {
  id: string;
  day_of_week: number;
  period_number: number;
  start_time: string;
  end_time: string;
  room: string | null;
  subject: { name: string } | null;
  teacher: { full_name: string } | null;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NUMBERS = [1, 2, 3, 4, 5, 6];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

const SUBJECT_COLORS = [
  "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300",
  "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300",
  "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800 text-purple-800 dark:text-purple-300",
  "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300",
  "bg-pink-50 dark:bg-pink-950/30 border-pink-200 dark:border-pink-800 text-pink-800 dark:text-pink-300",
  "bg-teal-50 dark:bg-teal-950/30 border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-300",
  "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-300",
  "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800 text-orange-800 dark:text-orange-300",
  "bg-cyan-50 dark:bg-cyan-950/30 border-cyan-200 dark:border-cyan-800 text-cyan-800 dark:text-cyan-300",
  "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300",
];

export default function StudentTimetablePage() {
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [subjectColorMap, setSubjectColorMap] = useState<
    Record<string, string>
  >({});

  const todayDow = useMemo(() => dayOfWeekFromDate(), []);

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("student_id")
        .eq("id", user.id)
        .single();

      const studentId = profile?.student_id;
      if (!studentId) {
        setLoading(false);
        return;
      }

      const { data: enrollment } = await supabase
        .from("student_enrollments")
        .select("class_id")
        .eq("student_id", studentId)
        .limit(1)
        .single();

      if (!enrollment) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("timetable_periods")
        .select(
          "id, day_of_week, period_number, start_time, end_time, room, subject:subjects(name), teacher:teachers(full_name)"
        )
        .eq("class_id", enrollment.class_id)
        .order("period_number", { ascending: true });

      const timetableData = (data ?? []) as unknown as TimetableEntry[];
      setEntries(timetableData);

      const subjects = [
        ...new Set(timetableData.map((e) => e.subject?.name).filter(Boolean)),
      ];
      const colorMap: Record<string, string> = {};
      subjects.forEach((subj, i) => {
        if (subj) colorMap[subj] = SUBJECT_COLORS[i % SUBJECT_COLORS.length];
      });
      setSubjectColorMap(colorMap);

      setLoading(false);
    }

    fetchData();
  }, []);

  const todayEntries = useMemo(
    () =>
      entries
        .filter((e) => e.day_of_week === todayDow)
        .sort((a, b) => a.period_number - b.period_number),
    [entries, todayDow]
  );

  const now = nowMinutes();

  const getEntry = (day: number, period: number) =>
    entries.find(
      (e) => e.day_of_week === day && e.period_number === period
    );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-white" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          My Timetable
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Your weekly class schedule.
        </p>
      </div>

      {/* Today at a glance */}
      {entries.length > 0 && (
        <Card className="bg-white dark:bg-card rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white">
              <Sun className="h-5 w-5 text-gold-500" />
              Today
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                {todayDow === 7
                  ? "Sunday"
                  : DAYS[todayDow - 1]}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {todayDow === 7 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No classes today — enjoy your Sunday!
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

      {/* Weekly grid */}
      <Card className="bg-white dark:bg-card rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white">
            <Clock className="h-5 w-5 text-gold-500" />
            Weekly Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
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
                  {PERIODS.map((period) => (
                    <tr key={period}>
                      <td className="border border-gray-200 dark:border-border bg-gray-50 dark:bg-muted px-3 py-2 text-center text-sm font-medium text-navy-900 dark:text-white">
                        {period}
                      </td>
                      {DAY_NUMBERS.map((day) => {
                        const entry = getEntry(day, period);
                        const isToday = day === todayDow;
                        if (!entry) {
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
                        const colorClass =
                          subjectColorMap[entry.subject?.name ?? ""] ??
                          "bg-gray-50 dark:bg-muted border-gray-200 dark:border-border text-gray-800 dark:text-gray-200";
                        return (
                          <td
                            key={day}
                            className={cn(
                              "border border-gray-200 dark:border-border p-1",
                              isToday && "ring-2 ring-gold-500/60 ring-inset"
                            )}
                          >
                            <div
                              className={`rounded-lg border p-2 text-xs ${colorClass}`}
                            >
                              <p className="font-semibold">
                                {entry.subject?.name ?? "--"}
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
