"use client";

import { useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { UpcomingEvents } from "@nkps/shared/components/UpcomingEvents";
import { Loader2 } from "lucide-react";

export default function StudentCalendarPage() {
  const [classId, setClassId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function resolveClass() {
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

      setClassId(enrollment?.class_id ?? null);
      setLoading(false);
    }

    resolveClass();
  }, []);

  return (
    <div>
      <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white mb-2">
        School Calendar
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        School-wide events plus anything scheduled for your class.
      </p>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-navy-900 dark:text-white" />
        </div>
      ) : (
        <UpcomingEvents
          limit={20}
          classId={classId ?? undefined}
          includeSchoolWide
        />
      )}
    </div>
  );
}
