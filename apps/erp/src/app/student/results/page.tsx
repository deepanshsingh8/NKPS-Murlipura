"use client";

import { useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nkps/shared/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Button } from "@nkps/shared/components/ui/button";
import { toast } from "sonner";
import { Download, BarChart3 } from "lucide-react";

interface SubjectResult {
  subject_id: string;
  subject_name: string;
  subject_code: string | null;
  marks_obtained: number;
  max_marks: number;
  grade: string | null;
}

interface ExamGroup {
  exam_type_id: string;
  exam_type_name: string;
  sort_order: number;
  subjects: SubjectResult[];
  total_obtained: number;
  total_max: number;
  percentage: number;
  overall_grade: string;
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800",
  A: "bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800",
  "B+": "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  B: "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  C: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
  D: "bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800",
  F: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800",
};

export default function StudentResultsPage() {
  const [exams, setExams] = useState<ExamGroup[]>([]);
  const [studentId, setStudentId] = useState<string>("");
  const [selectedExam, setSelectedExam] = useState<string>("");
  const [studentName, setStudentName] = useState("");
  const [className, setClassName] = useState("");
  const [rollNumber, setRollNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    async function fetchResults() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      // Resolve linked student record ID
      const { data: profile } = await supabase
        .from("profiles")
        .select("student_id")
        .eq("id", user.id)
        .single();

      const sid = profile?.student_id;
      if (!sid) {
        setLoading(false);
        return;
      }
      setStudentId(sid);

      // Fetch report card via API using the students table ID
      const res = await fetch(
        `/api/results/report-card?student_id=${sid}`
      );

      if (!res.ok) {
        setLoading(false);
        return;
      }

      const data = await res.json();

      setStudentName(data.student?.name ?? "");
      setClassName(
        data.student?.class
          ? `${data.student.class.name} - ${data.student.class.section}`
          : ""
      );
      setRollNumber(data.student?.roll_number ?? null);
      setExams(data.exams ?? []);
      if (data.exams?.[0]?.exam_type_id) {
        setSelectedExam(data.exams[0].exam_type_id);
      }
      setLoading(false);
    }

    fetchResults();
  }, []);

  async function handleDownload() {
    if (!studentId || !selectedExam) {
      toast.error("Select an exam to download its report card");
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/results/report-card/pdf?student_id=${studentId}&exam_type_id=${selectedExam}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to download report card");
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      a.download = match?.[1] ?? "report-card.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Report card download error:", err);
      toast.error("Failed to download report card");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-900 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            My Results
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {studentName && `${studentName}`}
            {className && ` | ${className}`}
            {rollNumber !== null && ` | Roll No: ${rollNumber}`}
          </p>
        </div>
        <Button
          variant="outline"
          className="border-navy-900 dark:border-white text-navy-900 dark:text-white hover:bg-navy-900/5 dark:hover:bg-white/5"
          onClick={handleDownload}
          disabled={downloading || !selectedExam || exams.length === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          {downloading ? "Preparing…" : "Download Report Card"}
        </Button>
      </div>

      {exams.length === 0 ? (
        <Card className="bg-white dark:bg-card rounded-2xl">
          <CardContent className="flex items-center justify-center py-16">
            <div className="text-center text-gray-400 dark:text-gray-500">
              <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No results available yet</p>
              <p className="text-xs text-gray-300 dark:text-gray-500 mt-1">
                Results will appear here once published
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={selectedExam} onValueChange={setSelectedExam}>
          <TabsList variant="line" className="mb-4 flex-wrap">
            {exams.map((exam) => (
              <TabsTrigger key={exam.exam_type_id} value={exam.exam_type_id}>
                {exam.exam_type_name}
              </TabsTrigger>
            ))}
          </TabsList>

          {exams.map((exam) => (
            <TabsContent key={exam.exam_type_id} value={exam.exam_type_id}>
              <Card className="bg-white dark:bg-card rounded-2xl">
                <CardHeader>
                  <CardTitle className="text-navy-900 dark:text-white flex items-center justify-between">
                    <span>{exam.exam_type_name}</span>
                    <div className="flex items-center gap-3">
                      <Badge
                        className={`text-sm px-3 py-1 ${GRADE_COLORS[exam.overall_grade] ?? ""}`}
                      >
                        {exam.overall_grade}
                      </Badge>
                      <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                        {exam.percentage}%
                      </span>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Subject</TableHead>
                          <TableHead className="text-center">
                            Marks Obtained
                          </TableHead>
                          <TableHead className="text-center">
                            Max Marks
                          </TableHead>
                          <TableHead className="text-center">
                            Percentage
                          </TableHead>
                          <TableHead className="text-center">Grade</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {exam.subjects.map((sub) => {
                          const pct =
                            sub.max_marks > 0
                              ? Math.round(
                                  (sub.marks_obtained / sub.max_marks) * 100
                                )
                              : 0;
                          return (
                            <TableRow key={sub.subject_id}>
                              <TableCell className="font-medium">
                                {sub.subject_name}
                                {sub.subject_code && (
                                  <span className="text-gray-400 dark:text-gray-500 text-xs ml-1">
                                    ({sub.subject_code})
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                {sub.marks_obtained}
                              </TableCell>
                              <TableCell className="text-center">
                                {sub.max_marks}
                              </TableCell>
                              <TableCell className="text-center">
                                {pct}%
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge
                                  className={`text-xs ${GRADE_COLORS[sub.grade ?? ""] ?? ""}`}
                                >
                                  {sub.grade ?? "--"}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}

                        {/* Summary Row */}
                        <TableRow className="bg-gray-50 dark:bg-muted font-semibold">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-center">
                            {exam.total_obtained}
                          </TableCell>
                          <TableCell className="text-center">
                            {exam.total_max}
                          </TableCell>
                          <TableCell className="text-center">
                            {exam.percentage}%
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              className={`text-xs ${GRADE_COLORS[exam.overall_grade] ?? ""}`}
                            >
                              {exam.overall_grade}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
