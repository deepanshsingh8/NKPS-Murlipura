"use client";

import { Button } from "@nkps/shared/components/ui/button";
import { CalendarPlus } from "lucide-react";

const DAYS = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
];

export interface TeacherPeriod {
  id: string;
  day_of_week: number;
  period_number: number;
  start_time: string;
  end_time: string;
  room: string | null;
  is_break: boolean;
  class_id: string;
  subject_id: string | null;
  classes:
    | { id: string; name: string; section: string | null }
    | { id: string; name: string; section: string | null }[]
    | null;
  subjects:
    | { id: string; name: string; code: string | null }
    | { id: string; name: string; code: string | null }[]
    | null;
}

interface Props {
  periods: TeacherPeriod[];
  onMarkAbsent: (date: string, dayOfWeek: number) => void;
}

// PostgREST returns single-relation joins as either an object or a one-element
// array depending on FK declaration; normalise both shapes.
function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

// Next occurrence of the given ISO weekday (1=Mon..6=Sat) starting today.
// Used to populate the "Mark absent" date when an admin clicks a day header.
function nextDateForDayOfWeek(jsDay: number): string {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayJs = today.getDay(); // 0=Sun..6=Sat
  // Convert our 1..6 (Mon=1) to JS 1..6 (Mon=1, same).
  const targetJs = jsDay;
  let diff = targetJs - todayJs;
  if (diff < 0) diff += 7;
  const d = new Date(today);
  d.setDate(today.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(t: string): string {
  // "09:30:00" → "09:30"
  return t.length >= 5 ? t.slice(0, 5) : t;
}

export function TeacherWeekGrid({ periods, onMarkAbsent }: Props) {
  // Compute the union of period_numbers actually used by this teacher, sorted.
  // Empty-state handled by the caller.
  const periodNumbers = Array.from(
    new Set(periods.map((p) => p.period_number))
  ).sort((a, b) => a - b);

  const cellByDayPeriod = new Map<string, TeacherPeriod>();
  for (const p of periods) {
    cellByDayPeriod.set(`${p.day_of_week}|${p.period_number}`, p);
  }

  return (
    <div className="erp-table-container overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 dark:bg-muted">
            <th className="px-3 py-3 text-left font-medium text-gray-500 dark:text-gray-400 border-b dark:border-border">
              Period
            </th>
            {DAYS.map((d) => {
              const dateForDay = nextDateForDayOfWeek(d.value);
              return (
                <th
                  key={d.value}
                  className="px-3 py-3 text-center font-medium text-gray-500 dark:text-gray-400 border-b dark:border-border"
                >
                  <div className="flex flex-col items-center gap-1">
                    <span>{d.label}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px] text-gray-500 dark:text-gray-400 hover:text-navy-900 dark:hover:text-white"
                      onClick={() => onMarkAbsent(dateForDay, d.value)}
                    >
                      <CalendarPlus className="h-3 w-3 mr-1" />
                      Mark absent
                    </Button>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {periodNumbers.map((pNum) => (
            <tr
              key={pNum}
              className="border-b border-gray-100 dark:border-border"
            >
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300 align-top">
                <div className="font-medium">P{pNum}</div>
              </td>
              {DAYS.map((d) => {
                const cell = cellByDayPeriod.get(`${d.value}|${pNum}`);
                if (!cell) {
                  return (
                    <td key={d.value} className="px-1 py-1">
                      <div className="w-full rounded-lg px-2 py-2 text-xs min-h-[56px] bg-gray-50 dark:bg-muted border border-dashed border-gray-200 dark:border-border text-gray-400 dark:text-gray-500 flex items-center justify-center">
                        free
                      </div>
                    </td>
                  );
                }
                const cls = pickOne(cell.classes);
                const subj = pickOne(cell.subjects);
                const className = cls
                  ? `${cls.name}${cls.section ? "-" + cls.section : ""}`
                  : "?";
                return (
                  <td key={d.value} className="px-1 py-1">
                    <div
                      className={`w-full rounded-lg px-2 py-2 text-xs min-h-[56px] ${
                        cell.is_break
                          ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                          : "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                      }`}
                    >
                      {cell.is_break ? (
                        <div className="font-medium text-amber-900 dark:text-amber-200">
                          Break
                        </div>
                      ) : (
                        <>
                          <div className="font-medium text-navy-900 dark:text-white">
                            {className}
                          </div>
                          <div className="text-gray-600 dark:text-gray-300 truncate">
                            {subj?.name ?? "—"}
                          </div>
                          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                            {formatTime(cell.start_time)}–
                            {formatTime(cell.end_time)}
                            {cell.room ? ` · ${cell.room}` : ""}
                          </div>
                        </>
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
  );
}
