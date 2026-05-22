"use client";

import { useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { UpcomingEvents } from "@nkps/shared/components/UpcomingEvents";
import { Loader2 } from "lucide-react";

export default function ParentCalendarPage() {
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
        .select("student_id")
        .eq("parent_id", parentId);

      const studentIds = (studentParents ?? [])
        .map((sp) => sp.student_id)
        .filter(Boolean);

      if (studentIds.length === 0) {
        setLoading(false);
        return;
      }

      const { data: enrollments } = await supabase
        .from("student_enrollments")
        .select("class_id")
        .in("student_id", studentIds);

      const ids = [
        ...new Set((enrollments ?? []).map((e) => e.class_id).filter(Boolean)),
      ] as string[];

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
        School-wide events plus anything scheduled for your children&apos;s classes.
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
