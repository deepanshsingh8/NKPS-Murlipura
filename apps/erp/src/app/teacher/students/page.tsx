"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { Card, CardContent, CardHeader, CardTitle } from "@nkps/shared/components/ui/card";
import { Input } from "@nkps/shared/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { Loader2, Users, Search } from "lucide-react";
import { formatClassName } from "@nkps/shared/lib/utils";

interface ClassOption {
  id: string;
  name: string;
  section: string;
  streams?: { name: string } | null;
}

interface StudentRow {
  roll_number: number | null;
  student: {
    full_name: string;
    email: string;
    phone: string | null;
  };
}

export default function TeacherStudentsPage() {
  const supabase = createClient();

  const [classes, setClasses] = useState<ClassOption[]>([]);
  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [selectedClassId, setSelectedClassId] = useUrlState("class_id");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useUrlState("q");

  useEffect(() => {
    async function fetchClasses() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Resolve teacher_id from profiles
      const { data: profileData } = await supabase
        .from("profiles")
        .select("teacher_id")
        .eq("id", user.id)
        .single();

      const teacherId = profileData?.teacher_id;
      if (!teacherId) return;

      // Get classes from class_subjects where teacher
      const { data: classSubjects } = await supabase
        .from("class_subjects")
        .select("class_id")
        .eq("teacher_id", teacherId);

      // Also get classes where class teacher
      const { data: classTeacher } = await supabase
        .from("classes")
        .select("id")
        .eq("class_teacher_id", teacherId);

      const allClassIds = [
        ...new Set([
          ...(classSubjects ?? []).map((cs) => cs.class_id),
          ...(classTeacher ?? []).map((c) => c.id),
        ]),
      ];

      if (allClassIds.length > 0) {
        const { data: classData } = await supabase
          .from("classes")
          .select("id, name, section, streams:stream_id(name)")
          .in("id", allClassIds)
          .order("name", { ascending: true });

        const classOptions = (classData ?? []) as unknown as ClassOption[];
        setClasses(classOptions);

        // Only auto-select the first class when the URL hasn't pinned one.
        if (classOptions.length > 0 && !selectedClassId) {
          setSelectedClassId(classOptions[0].id);
        }
      }

      setLoading(false);
    }

    fetchClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchStudents = useCallback(async () => {
    if (!selectedClassId) return;
    setStudentsLoading(true);

    const { data } = await supabase
      .from("student_enrollments")
      .select(
        "roll_number, student:students(full_name, email, phone)"
      )
      .eq("class_id", selectedClassId)
      .order("roll_number", { ascending: true });

    setStudents((data ?? []) as unknown as StudentRow[]);
    setStudentsLoading(false);
  }, [supabase, selectedClassId]);

  useEffect(() => {
    if (selectedClassId) {
      fetchStudents();
    }
  }, [selectedClassId, fetchStudents]);

  const filteredStudents = students.filter((s) =>
    searchQuery
      ? s.student?.full_name
          ?.toLowerCase()
          .includes(searchQuery.toLowerCase())
      : true
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
          Class Rosters
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          View students in your assigned classes.
        </p>
      </div>

      <Card className="bg-white dark:bg-card rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white">
            <Users className="h-5 w-5 text-gold-500" />
            Students
          </CardTitle>
        </CardHeader>
        <CardContent>
          {classes.length === 0 ? (
            <p className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
              No classes assigned to you yet.
            </p>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm dark:bg-card dark:text-white"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {formatClassName(c)}
                    </option>
                  ))}
                </select>

                <div className="relative flex-1 w-full sm:w-auto">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
                  <Input
                    placeholder="Search by name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              {studentsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-navy-900 dark:text-white" />
                </div>
              ) : filteredStudents.length === 0 ? (
                <p className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
                  No students found.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Roll No.</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStudents.map((s, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">
                          {s.roll_number ?? "--"}
                        </TableCell>
                        <TableCell>{s.student?.full_name ?? "--"}</TableCell>
                        <TableCell className="text-gray-500 dark:text-gray-400">
                          {s.student?.email ?? "--"}
                        </TableCell>
                        <TableCell className="text-gray-500 dark:text-gray-400">
                          {s.student?.phone ?? "--"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
