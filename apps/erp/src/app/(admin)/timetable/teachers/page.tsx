"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { Loader2, UserCog } from "lucide-react";
import { toast } from "sonner";
import type { Teacher } from "@nkps/shared/types";
import {
  TeacherWeekGrid,
  type TeacherPeriod,
} from "@/components/timetable/TeacherWeekGrid";
import { MarkAbsentDialog } from "@/components/timetable/MarkAbsentDialog";

export default function AdminTeacherTimetablePage() {
  const supabase = createClient();

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [periods, setPeriods] = useState<TeacherPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodsLoading, setPeriodsLoading] = useState(false);

  const [absentDialog, setAbsentDialog] = useState<{
    open: boolean;
    date: string;
  }>({ open: false, date: "" });

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("teachers")
        .select("*")
        .eq("is_active", true)
        .order("full_name");
      if (error) {
        toast.error("Failed to load teachers");
      } else {
        setTeachers((data as Teacher[]) ?? []);
      }
      setLoading(false);
    }
    load();
  }, [supabase]);

  const fetchTimetable = useCallback(async (teacherId: string) => {
    if (!teacherId) {
      setPeriods([]);
      return;
    }
    setPeriodsLoading(true);
    const res = await adminFetch(
      `/api/teacher-timetable?teacher_id=${teacherId}`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to load timetable");
      setPeriods([]);
    } else {
      const body = await res.json();
      setPeriods((body.data?.periods as TeacherPeriod[]) ?? []);
    }
    setPeriodsLoading(false);
  }, []);

  useEffect(() => {
    fetchTimetable(selectedTeacherId);
  }, [selectedTeacherId, fetchTimetable]);

  const selectedTeacher = teachers.find((t) => t.id === selectedTeacherId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-white" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Teacher Timetable
        </h1>
      </div>

      <div className="mb-6 w-full sm:w-80">
        <Select
          value={selectedTeacherId}
          items={teachers.map((t) => ({
            value: t.id,
            label: `${t.full_name}${t.employee_id ? ` (${t.employee_id})` : ""}`,
          }))}
          onValueChange={(val) => val && setSelectedTeacherId(val)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a teacher..." />
          </SelectTrigger>
          <SelectContent>
            {teachers.map((t) => (
              <SelectItem
                key={t.id}
                value={t.id}
                label={`${t.full_name}${t.employee_id ? ` (${t.employee_id})` : ""}`}
              >
                {t.full_name}
                {t.employee_id ? (
                  <span className="text-gray-400 dark:text-gray-500 ml-1">
                    ({t.employee_id})
                  </span>
                ) : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedTeacherId ? (
        <div className="erp-table-container p-6">
          <div className="mx-auto max-w-md text-center py-12">
            <div className="h-14 w-14 rounded-2xl bg-navy-900/5 dark:bg-white/5 flex items-center justify-center mx-auto mb-4">
              <UserCog className="h-7 w-7 text-navy-900/70 dark:text-white/70" />
            </div>
            <h3 className="text-base font-semibold text-navy-900 dark:text-white mb-1">
              Pick a teacher to see their week
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              The grid mirrors the class timetables: every period this teacher
              is assigned to, across all classes. Use the <em>Mark absent</em>{" "}
              button on any day header to start the substitution flow for that
              date.
            </p>
          </div>
        </div>
      ) : periodsLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : periods.length === 0 ? (
        <div className="erp-table-container p-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {selectedTeacher?.full_name ?? "This teacher"} has no periods
          assigned in the current timetable.
        </div>
      ) : (
        <TeacherWeekGrid
          periods={periods}
          onMarkAbsent={(date) => setAbsentDialog({ open: true, date })}
        />
      )}

      {selectedTeacherId && selectedTeacher && (
        <MarkAbsentDialog
          open={absentDialog.open}
          onOpenChange={(open) => setAbsentDialog((s) => ({ ...s, open }))}
          teacherId={selectedTeacherId}
          teacherName={selectedTeacher.full_name}
          initialDate={absentDialog.date}
          onSaved={() => {
            setAbsentDialog((s) => ({ ...s, open: false }));
            toast.success("Marked absent");
          }}
        />
      )}
    </div>
  );
}
