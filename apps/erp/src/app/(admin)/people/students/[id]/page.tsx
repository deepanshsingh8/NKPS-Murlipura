"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { ArrowLeft, Loader2, GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { AcademicHistoryTimeline } from "../_components/AcademicHistoryTimeline";
import type { StudentHistory } from "@/lib/student-history";

/**
 * Full student record: profile header plus the per-session academic history.
 *
 * A dedicated route rather than another tab inside the students-list dialog.
 * The list page is already the heaviest component in the app, and this view
 * needs deep links, the back button and print — none of which a dialog gives.
 * Authorisation comes free: featureKeyForPath matches by href prefix, so
 * /people/students/<id> inherits the `students` key.
 */
export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const studentId = params?.id;

  const [history, setHistory] = useState<StudentHistory | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const res = await adminFetch(`/api/students/${studentId}/history`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to load student history");
        setHistory(null);
        return;
      }
      setHistory(data as StudentHistory);
    } catch {
      toast.error("Failed to load student history");
      setHistory(null);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
      </div>
    );
  }

  if (!history?.student) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 dark:text-gray-400 mb-4">
          Student not found.
        </p>
        <Button variant="outline" onClick={() => router.push("/people/students")}>
          Back to students
        </Button>
      </div>
    );
  }

  const s = history.student;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/people/students")}
            aria-label="Back to students"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-heading text-2xl">{s.full_name}</h1>
              {s.is_alumni && (
                <Badge variant="secondary">
                  <GraduationCap className="h-3 w-3 mr-1" />
                  Alumni{s.alumni_passing_year ? ` · ${s.alumni_passing_year}` : ""}
                </Badge>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Admission No: {s.admission_no}
              {s.father_name ? ` · Father: ${s.father_name}` : ""}
            </p>
          </div>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {history.years.length} session
          {history.years.length === 1 ? "" : "s"} on record
        </p>
      </div>

      <AcademicHistoryTimeline years={history.years} gaps={history.gaps} />
    </div>
  );
}
