"use client";

import { useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { UpcomingEvents } from "@nkps/shared/components/UpcomingEvents";
import { Loader2 } from "lucide-react";

export default function TeacherCalendarPage() {
  const [classIds, setClassIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function resolveClasses() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("teacher_id")
        .eq("id", user.id)
        .single();

      const teacherId = profile?.teacher_id;
      if (!teacherId) {
        setLoading(false);
        return;
      }

      const [{ data: classSubjects }, { data: classTeacher }] =
        await Promise.all([
          supabase
            .from("class_subjects")
            .select("class_id")
            .eq("teacher_id", teacherId),
          supabase
            .from("classes")
            .select("id")
            .eq("class_teacher_id", teacherId),
        ]);

      const ids = [
        ...new Set([
          ...(classSubjects ?? []).map((cs) => cs.class_id),
          ...(classTeacher ?? []).map((c) => c.id),
        ]),
      ].filter(Boolean) as string[];

      setClassIds(ids);
      setLoading(false);
    }

    resolveClasses();
  }, []);

  return (
    <div>
      <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white mb-2">
        School Calendar
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        School-wide events plus anything scheduled for the classes you teach.
      </p>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-navy-900 dark:text-white" />
        </div>
      ) : (
        <UpcomingEvents limit={20} classIds={classIds} includeSchoolWide />
      )}
    </div>
  );
}
