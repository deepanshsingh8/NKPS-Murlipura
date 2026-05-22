import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type {
  ReportCardAttendance,
  ReportCardExamGroup,
  ReportCardStudent,
} from "@/lib/report-card";
import type { FinalResult, FinalSubject } from "@nkps/shared/types";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#111827",
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: "#0b2452",
    paddingBottom: 10,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerText: {
    flex: 1,
    alignItems: "center",
  },
  logo: {
    width: 56,
    height: 56,
  },
  schoolName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 18,
    color: "#0b2452",
    letterSpacing: 0.5,
  },
  schoolMeta: {
    fontSize: 9,
    color: "#4b5563",
    marginTop: 2,
  },
  reportTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: "#0b2452",
    marginTop: 8,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  studentBlock: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 4,
    padding: 10,
  },
  studentField: {
    width: "50%",
    flexDirection: "row",
    paddingVertical: 3,
  },
  fieldLabel: {
    fontFamily: "Helvetica-Bold",
    color: "#4b5563",
    width: 90,
  },
  fieldValue: {
    flex: 1,
    color: "#111827",
  },
  examTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: "#0b2452",
    marginBottom: 8,
  },
  table: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 2,
    marginBottom: 12,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#0b2452",
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  totalRow: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    fontFamily: "Helvetica-Bold",
    borderTopWidth: 1,
    borderTopColor: "#d1d5db",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  colSubject: { width: "40%" },
  colNum: { width: "15%", textAlign: "center" },
  colGrade: { width: "15%", textAlign: "center" },
  summary: {
    marginTop: 8,
    padding: 10,
    backgroundColor: "#f9fafb",
    borderLeftWidth: 3,
    borderLeftColor: "#c9a227",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  attendanceRow: {
    marginTop: 10,
    padding: 10,
    backgroundColor: "#f9fafb",
    borderLeftWidth: 3,
    borderLeftColor: "#0b2452",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  attendanceLabel: {
    fontFamily: "Helvetica-Bold",
    color: "#0b2452",
  },
  attendanceMeta: {
    color: "#4b5563",
    marginTop: 2,
  },
  attendanceValue: {
    fontFamily: "Helvetica-Bold",
    color: "#0b2452",
    fontSize: 12,
  },
  remarkBlock: {
    marginTop: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 4,
  },
  remarkLabel: {
    fontFamily: "Helvetica-Bold",
    color: "#0b2452",
    marginBottom: 4,
  },
  remarkText: {
    color: "#111827",
    lineHeight: 1.4,
  },
  summaryLabel: {
    fontFamily: "Helvetica-Bold",
    color: "#0b2452",
  },
  summaryValue: {
    fontFamily: "Helvetica-Bold",
    color: "#0b2452",
    fontSize: 12,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    fontSize: 9,
    color: "#6b7280",
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  signatureBlock: {
    alignItems: "center",
    width: 140,
  },
  signatureLine: {
    width: 120,
    borderBottomWidth: 1,
    borderBottomColor: "#9ca3af",
    marginBottom: 4,
    height: 20,
  },
  signatureLabel: {
    fontSize: 9,
    color: "#4b5563",
  },
  // --- Phase 3 (final-result view) styles ---
  phase3Banner: {
    backgroundColor: "#0b2452",
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    paddingVertical: 5,
    paddingHorizontal: 8,
    textAlign: "center",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  phase3SectionLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: "#0b2452",
    marginBottom: 4,
  },
  phase3SectionNote: {
    fontSize: 8,
    color: "#6b7280",
    marginBottom: 6,
  },
  phase3Table: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 2,
    marginBottom: 10,
  },
  phase3TableHeader: {
    flexDirection: "row",
    backgroundColor: "#0b2452",
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  phase3TableRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingVertical: 4,
    paddingHorizontal: 4,
    fontSize: 8,
  },
  phase3TotalRow: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    fontFamily: "Helvetica-Bold",
    borderTopWidth: 1,
    borderTopColor: "#d1d5db",
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontSize: 8,
  },
  phase3ColSr: { width: 22, textAlign: "center" },
  phase3ColSubject: { flex: 2, flexShrink: 1, paddingRight: 4 },
  phase3ColExam: { flex: 1, flexShrink: 1, textAlign: "center" },
  phase3ColNum: { width: 44, textAlign: "center" },
  phase3ColGrace: { width: 38, textAlign: "center" },
  phase3ColGrade: { width: 34, textAlign: "center" },
  phase3ColPF: { width: 30, textAlign: "center", fontFamily: "Helvetica-Bold" },
  phase3Pass: { color: "#047857" },
  phase3Fail: { color: "#b91c1c" },
  phase3FinalPanel: {
    marginTop: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: "#c9a227",
    borderRadius: 4,
    backgroundColor: "#fffbea",
  },
  phase3FinalHeader: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: "#0b2452",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  phase3FinalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  phase3FinalLabel: {
    fontFamily: "Helvetica-Bold",
    color: "#4b5563",
    fontSize: 9,
  },
  phase3FinalValue: {
    fontFamily: "Helvetica-Bold",
    color: "#0b2452",
    fontSize: 10,
  },
  phase3PassBadge: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
  },
  phase3PassReason: {
    marginTop: 4,
    fontSize: 8,
    color: "#6b7280",
    fontStyle: "italic",
  },
  phase3NonScholastic: {
    marginTop: 6,
    marginBottom: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 3,
    backgroundColor: "#f9fafb",
  },
  phase3ConfigFooter: {
    marginTop: 10,
    fontSize: 7,
    color: "#6b7280",
    fontStyle: "italic",
    textAlign: "center",
  },
});

interface ReportCardPDFProps {
  school: {
    name: string;
    addressLine: string;
    affiliation: string;
    affiliationNumber: string;
  };
  student: ReportCardStudent;
  exam: ReportCardExamGroup;
  attendance: ReportCardAttendance | null;
  /**
   * Raw PNG/JPEG bytes for the school logo. Buffers work server-side with
   * @react-pdf/renderer; undefined means skip the logo slot.
   */
  logoData?: Buffer | Uint8Array;
  generatedOn: string;
  /**
   * Footer config from `pdf_footer_configs`. Optional — if omitted, sensible
   * defaults matching the previous hardcoded footer are used.
   */
  footer?: {
    disclaimer_text: string | null;
    show_signatures: boolean;
    signature_labels: string[];
  };
  /**
   * Phase 3 — when provided, the exam-results body switches to the
   * final-result layout (multi-exam subject table, grace, overall block,
   * etc.). Legacy layout is used when this is absent (regression guarantee).
   */
  finalResult?: FinalResult;
  /**
   * Phase 3 display toggles. Threaded by the caller so the PDF doesn't have
   * to re-fetch the master row. Only consulted when `finalResult` is set.
   */
  resultMaster?: {
    include_non_scholastic: boolean;
    non_scholastic_placement: "below" | "above" | "separate_page";
    show_extra_separately: boolean;
    show_rank: boolean;
  };
  /**
   * Optional title banner rendered above the main subjects table in Phase 3
   * mode (e.g., "ANNUAL EXAMINATION 2025-26"). Skipped cleanly if absent.
   */
  upperHeader?: string;
  /**
   * Phase 4 — non-scholastic groups for the year. The route fetches the
   * student's most-recent published assessment per sub_subject and groups
   * by parent subject. When undefined or empty AND
   * resultMaster.include_non_scholastic is true, the PDF still renders the
   * section header but with a "Not yet recorded" line so the placement
   * (above/below/separate_page) still produces consistent layout.
   */
  nonScholasticGroups?: Array<{
    parent_id: string;
    parent_name: string;
    sub_subjects: Array<{
      sub_subject_id: string;
      sub_subject_name: string;
      grade_label: string | null;
      remarks: string | null;
    }>;
  }>;
}

export function ReportCardPDF({
  school,
  student,
  exam,
  attendance,
  logoData,
  generatedOn,
  footer,
  finalResult,
  resultMaster,
  upperHeader,
  nonScholasticGroups,
}: ReportCardPDFProps) {
  const classLabel = student.class
    ? `${student.class.name} — ${student.class.section}`
    : "—";
  const disclaimer =
    footer?.disclaimer_text ?? "This is a computer-generated document.";
  const showSignatures = footer?.show_signatures ?? true;
  const signatureLabels =
    footer?.signature_labels && footer.signature_labels.length > 0
      ? footer.signature_labels
      : ["Class Teacher", "Principal"];

  const usePhase3 = Boolean(finalResult);

  if (usePhase3 && finalResult) {
    return (
      <Phase3Document
        school={school}
        student={student}
        exam={exam}
        attendance={attendance}
        logoData={logoData}
        generatedOn={generatedOn}
        disclaimer={disclaimer}
        showSignatures={showSignatures}
        signatureLabels={signatureLabels}
        classLabel={classLabel}
        finalResult={finalResult}
        resultMaster={resultMaster}
        upperHeader={upperHeader}
        nonScholasticGroups={nonScholasticGroups}
      />
    );
  }

  return (
    <Document
      title={`Report Card — ${student.name} — ${exam.exam_type_name}`}
      author={school.name}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          {logoData ? (
            <Image
              src={{ data: Buffer.from(logoData), format: "png" }}
              style={styles.logo}
            />
          ) : null}
          <View style={styles.headerText}>
            <Text style={styles.schoolName}>{school.name}</Text>
            <Text style={styles.schoolMeta}>{school.addressLine}</Text>
            <Text style={styles.schoolMeta}>
              Affiliated to {school.affiliation} · Affiliation No.{" "}
              {school.affiliationNumber}
            </Text>
            <Text style={styles.reportTitle}>
              Report Card · {exam.exam_type_name}
            </Text>
          </View>
          {logoData ? <View style={styles.logo} /> : null}
        </View>

        <View style={styles.studentBlock}>
          <View style={styles.studentField}>
            <Text style={styles.fieldLabel}>Name</Text>
            <Text style={styles.fieldValue}>{student.name}</Text>
          </View>
          <View style={styles.studentField}>
            <Text style={styles.fieldLabel}>Class</Text>
            <Text style={styles.fieldValue}>{classLabel}</Text>
          </View>
          <View style={styles.studentField}>
            <Text style={styles.fieldLabel}>Roll No.</Text>
            <Text style={styles.fieldValue}>
              {student.roll_number ?? "—"}
            </Text>
          </View>
          <View style={styles.studentField}>
            <Text style={styles.fieldLabel}>Examination</Text>
            <Text style={styles.fieldValue}>{exam.exam_type_name}</Text>
          </View>
        </View>

        <Text style={styles.examTitle}>Subject-wise Performance</Text>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colSubject}>Subject</Text>
            <Text style={styles.colNum}>Max</Text>
            <Text style={styles.colNum}>Obtained</Text>
            <Text style={styles.colNum}>%</Text>
            <Text style={styles.colGrade}>Grade</Text>
          </View>
          {exam.subjects.map((sub) => {
            const pct =
              sub.max_marks > 0
                ? Math.round((sub.marks_obtained / sub.max_marks) * 100)
                : 0;
            return (
              <View key={sub.subject_id} style={styles.tableRow}>
                <Text style={styles.colSubject}>
                  {sub.subject_name}
                  {sub.subject_code ? ` (${sub.subject_code})` : ""}
                </Text>
                <Text style={styles.colNum}>{sub.max_marks}</Text>
                <Text style={styles.colNum}>{sub.marks_obtained}</Text>
                <Text style={styles.colNum}>{pct}%</Text>
                <Text style={styles.colGrade}>{sub.grade ?? "—"}</Text>
              </View>
            );
          })}
          <View style={styles.totalRow}>
            <Text style={styles.colSubject}>Total</Text>
            <Text style={styles.colNum}>{exam.total_max}</Text>
            <Text style={styles.colNum}>{exam.total_obtained}</Text>
            <Text style={styles.colNum}>{exam.percentage}%</Text>
            <Text style={styles.colGrade}>{exam.overall_grade}</Text>
          </View>
        </View>

        <View style={styles.summary}>
          <View>
            <Text style={styles.summaryLabel}>Overall Result</Text>
            <Text style={{ color: "#4b5563", marginTop: 2 }}>
              {exam.total_obtained} / {exam.total_max}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.summaryValue}>
              {exam.percentage}% · Grade {exam.overall_grade}
            </Text>
          </View>
        </View>

        {attendance ? (
          <View style={styles.attendanceRow}>
            <View>
              <Text style={styles.attendanceLabel}>Attendance</Text>
              <Text style={styles.attendanceMeta}>
                {attendance.present_days} / {attendance.total_days} days
                {attendance.academic_year_label
                  ? ` · ${attendance.academic_year_label}`
                  : ""}
              </Text>
            </View>
            <Text style={styles.attendanceValue}>{attendance.percentage}%</Text>
          </View>
        ) : null}

        {exam.remark ? (
          <View style={styles.remarkBlock} wrap={false}>
            <Text style={styles.remarkLabel}>Class Teacher&apos;s Remark</Text>
            <Text style={styles.remarkText}>{exam.remark}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <View>
            <Text>Generated on {generatedOn}</Text>
            {disclaimer ? (
              <Text style={{ marginTop: 2 }}>{disclaimer}</Text>
            ) : null}
          </View>
          {showSignatures
            ? signatureLabels.map((label, idx) => (
                <View key={idx} style={styles.signatureBlock}>
                  <View style={styles.signatureLine} />
                  <Text style={styles.signatureLabel}>{label}</Text>
                </View>
              ))
            : null}
        </View>
      </Page>
    </Document>
  );
}

// =============================================================
// Phase 3 — final-result body
// =============================================================

interface Phase3DocumentProps {
  school: ReportCardPDFProps["school"];
  student: ReportCardStudent;
  exam: ReportCardExamGroup;
  attendance: ReportCardAttendance | null;
  logoData?: Buffer | Uint8Array;
  generatedOn: string;
  disclaimer: string;
  showSignatures: boolean;
  signatureLabels: string[];
  classLabel: string;
  finalResult: FinalResult;
  resultMaster?: ReportCardPDFProps["resultMaster"];
  upperHeader?: string;
  nonScholasticGroups?: ReportCardPDFProps["nonScholasticGroups"];
}

function Phase3Document({
  school,
  student,
  exam,
  attendance,
  logoData,
  generatedOn,
  disclaimer,
  showSignatures,
  signatureLabels,
  classLabel,
  finalResult,
  resultMaster,
  upperHeader,
  nonScholasticGroups,
}: Phase3DocumentProps) {
  const includeNonScholastic = resultMaster?.include_non_scholastic ?? false;
  const placement = resultMaster?.non_scholastic_placement ?? "below";
  const showExtraSeparately = resultMaster?.show_extra_separately ?? true;
  const showRank = resultMaster?.show_rank ?? false;

  // Build the union of exam contributions across all main subjects (stable
  // order by sort_order from `exam_contributions` — the final-result lib
  // pre-sorts them). Optional subjects that are merged into the main table
  // (when show_extra_separately=false) also contribute to the union.
  const subjectsForUnion: FinalSubject[] = showExtraSeparately
    ? finalResult.main_subjects
    : [...finalResult.main_subjects, ...finalResult.optional_subjects];

  const examColumns = buildExamColumns(subjectsForUnion);

  const nonScholasticGroupsResolved = nonScholasticGroups ?? [];
  const hasNonScholasticData =
    nonScholasticGroupsResolved.some((g) => g.sub_subjects.length > 0);

  const nonScholasticBlock = includeNonScholastic ? (
    <View style={styles.phase3NonScholastic} wrap={false}>
      <Text style={styles.phase3SectionLabel}>Non-Scholastic Assessments</Text>
      {hasNonScholasticData ? (
        nonScholasticGroupsResolved.map((group) => (
          <View key={group.parent_id} style={{ marginBottom: 6 }}>
            <Text
              style={{
                fontFamily: "Helvetica-Bold",
                fontSize: 9,
                color: "#0b2452",
                marginBottom: 2,
              }}
            >
              {group.parent_name}
            </Text>
            {group.sub_subjects.map((s) => (
              <View
                key={s.sub_subject_id}
                style={{
                  flexDirection: "row",
                  fontSize: 8,
                  paddingVertical: 1,
                }}
              >
                <Text style={{ flex: 2 }}>{s.sub_subject_name}</Text>
                <Text
                  style={{
                    width: 50,
                    textAlign: "center",
                    fontFamily: "Helvetica-Bold",
                  }}
                >
                  {s.grade_label ?? "—"}
                </Text>
                <Text style={{ flex: 2, color: "#6b7280" }}>
                  {s.remarks ?? ""}
                </Text>
              </View>
            ))}
          </View>
        ))
      ) : (
        <Text style={styles.phase3SectionNote}>Not yet recorded.</Text>
      )}
    </View>
  ) : null;

  return (
    <Document
      title={`Report Card — ${student.name} — Final Result`}
      author={school.name}
    >
      <Page size="A4" style={styles.page}>
        {/* Shared header (school branding) */}
        <View style={styles.header}>
          {logoData ? (
            <Image
              src={{ data: Buffer.from(logoData), format: "png" }}
              style={styles.logo}
            />
          ) : null}
          <View style={styles.headerText}>
            <Text style={styles.schoolName}>{school.name}</Text>
            <Text style={styles.schoolMeta}>{school.addressLine}</Text>
            <Text style={styles.schoolMeta}>
              Affiliated to {school.affiliation} · Affiliation No.{" "}
              {school.affiliationNumber}
            </Text>
            <Text style={styles.reportTitle}>
              Report Card · Final Result
            </Text>
          </View>
          {logoData ? <View style={styles.logo} /> : null}
        </View>

        {/* Shared student info strip */}
        <View style={styles.studentBlock}>
          <View style={styles.studentField}>
            <Text style={styles.fieldLabel}>Name</Text>
            <Text style={styles.fieldValue}>{student.name}</Text>
          </View>
          <View style={styles.studentField}>
            <Text style={styles.fieldLabel}>Class</Text>
            <Text style={styles.fieldValue}>{classLabel}</Text>
          </View>
          <View style={styles.studentField}>
            <Text style={styles.fieldLabel}>Roll No.</Text>
            <Text style={styles.fieldValue}>
              {student.roll_number ?? "—"}
            </Text>
          </View>
          <View style={styles.studentField}>
            <Text style={styles.fieldLabel}>Result View</Text>
            <Text style={styles.fieldValue}>Final Result (Aggregate)</Text>
          </View>
        </View>

        {/* Non-scholastic above placement */}
        {includeNonScholastic && placement === "above" ? nonScholasticBlock : null}

        {/* Upper banner (optional, skipped cleanly when absent) */}
        {upperHeader ? (
          <Text style={styles.phase3Banner}>{upperHeader}</Text>
        ) : null}

        {/* Main subjects table */}
        <Text style={styles.examTitle}>Subject-wise Performance</Text>
        <MainSubjectsTable
          subjects={
            showExtraSeparately
              ? finalResult.main_subjects
              : [...finalResult.main_subjects, ...finalResult.optional_subjects]
          }
          mergedOptionalIds={
            showExtraSeparately
              ? []
              : finalResult.optional_subjects.map((s) => s.subject_id)
          }
          examColumns={examColumns}
          aggregatePct={finalResult.overall.main_total_pct}
        />

        {/* Optional subjects mini-table (only when shown separately) */}
        {showExtraSeparately && finalResult.optional_subjects.length > 0 ? (
          <>
            <Text style={styles.phase3SectionLabel}>
              Optional Subjects
            </Text>
            <Text style={styles.phase3SectionNote}>
              Not counted toward overall result.
            </Text>
            <OptionalSubjectsTable
              subjects={finalResult.optional_subjects}
              examColumns={buildExamColumns(finalResult.optional_subjects)}
            />
          </>
        ) : null}

        {/* Final Result block */}
        <View style={styles.phase3FinalPanel} wrap={false}>
          <Text style={styles.phase3FinalHeader}>Final Result</Text>
          <View style={styles.phase3FinalRow}>
            <Text style={styles.phase3FinalLabel}>Overall %</Text>
            <Text style={styles.phase3FinalValue}>
              {finalResult.overall.main_total_pct}%
            </Text>
          </View>
          <View style={styles.phase3FinalRow}>
            <Text style={styles.phase3FinalLabel}>Grade</Text>
            <Text style={styles.phase3FinalValue}>
              {finalResult.overall.grade ?? "—"}
            </Text>
          </View>
          <View style={styles.phase3FinalRow}>
            <Text style={styles.phase3FinalLabel}>Result</Text>
            <Text
              style={[
                styles.phase3PassBadge,
                finalResult.overall.passed ? styles.phase3Pass : styles.phase3Fail,
              ]}
            >
              {finalResult.overall.passed ? "PASS" : "FAIL"}
            </Text>
          </View>
          {finalResult.overall.division ? (
            <View style={styles.phase3FinalRow}>
              <Text style={styles.phase3FinalLabel}>Division</Text>
              <Text style={styles.phase3FinalValue}>
                {finalResult.overall.division === "first"
                  ? "First Division"
                  : finalResult.overall.division === "second"
                  ? "Second Division"
                  : "Third Division"}
              </Text>
            </View>
          ) : null}
          {finalResult.overall.pass_reason ? (
            <Text style={styles.phase3PassReason}>
              {finalResult.overall.pass_reason}
            </Text>
          ) : null}
          {finalResult.overall.grace_applied_total > 0 ? (
            <View style={styles.phase3FinalRow}>
              <Text style={styles.phase3FinalLabel}>Grace applied</Text>
              <Text style={styles.phase3FinalValue}>
                +{finalResult.overall.grace_applied_total} pct pts
              </Text>
            </View>
          ) : null}
          {showRank && finalResult.rank != null ? (
            <View style={styles.phase3FinalRow}>
              <Text style={styles.phase3FinalLabel}>Rank</Text>
              <Text style={styles.phase3FinalValue}>
                {finalResult.rank}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Non-scholastic below placement */}
        {includeNonScholastic && placement === "below" ? nonScholasticBlock : null}

        {/* Attendance (kept from legacy — same component) */}
        {attendance ? (
          <View style={styles.attendanceRow}>
            <View>
              <Text style={styles.attendanceLabel}>Attendance</Text>
              <Text style={styles.attendanceMeta}>
                {attendance.present_days} / {attendance.total_days} days
                {attendance.academic_year_label
                  ? ` · ${attendance.academic_year_label}`
                  : ""}
              </Text>
            </View>
            <Text style={styles.attendanceValue}>{attendance.percentage}%</Text>
          </View>
        ) : null}

        {exam.remark ? (
          <View style={styles.remarkBlock} wrap={false}>
            <Text style={styles.remarkLabel}>Class Teacher&apos;s Remark</Text>
            <Text style={styles.remarkText}>{exam.remark}</Text>
          </View>
        ) : null}

        {/* config_applied footer line (small, admin-facing) */}
        <Text style={styles.phase3ConfigFooter}>
          Best-of applied: {finalResult.config_applied.best_of_applied ? "yes" : "no"}
          {" · "}
          Scale: {finalResult.config_applied.grade_scale_name ?? "—"}
          {" · "}
          Rounding: {finalResult.config_applied.rounding_summary}
        </Text>

        {/* Shared footer */}
        <View style={styles.footer} fixed>
          <View>
            <Text>Generated on {generatedOn}</Text>
            {disclaimer ? (
              <Text style={{ marginTop: 2 }}>{disclaimer}</Text>
            ) : null}
          </View>
          {showSignatures
            ? signatureLabels.map((label, idx) => (
                <View key={idx} style={styles.signatureBlock}>
                  <View style={styles.signatureLine} />
                  <Text style={styles.signatureLabel}>{label}</Text>
                </View>
              ))
            : null}
        </View>
      </Page>

      {/* Separate-page non-scholastic placement */}
      {includeNonScholastic && placement === "separate_page" ? (
        <Page size="A4" style={styles.page}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.schoolName}>{school.name}</Text>
              <Text style={styles.reportTitle}>
                Non-Scholastic Assessments
              </Text>
            </View>
          </View>
          {/* Reuses the same `nonScholasticBlock` we render inline so the data
              path and rendering stay identical regardless of placement. */}
          {nonScholasticBlock}
          <View style={styles.footer} fixed>
            <View>
              <Text>Generated on {generatedOn}</Text>
              {disclaimer ? (
                <Text style={{ marginTop: 2 }}>{disclaimer}</Text>
              ) : null}
            </View>
          </View>
        </Page>
      ) : null}
    </Document>
  );
}

// -------------------- Phase 3 helpers & sub-tables --------------------

interface ExamColumn {
  exam_type_id: string;
  exam_name: string;
}

/**
 * Stable-ordered union of exam contributions across the given subjects.
 * Preserves encounter order from the first subject where each exam appears —
 * `computeFinalResult` already pre-sorts each subject's contributions by
 * the exam's sort_order then name, so first-encounter order produces the
 * correct global table column order.
 */
function buildExamColumns(subjects: FinalSubject[]): ExamColumn[] {
  const seen = new Set<string>();
  const cols: ExamColumn[] = [];
  for (const s of subjects) {
    for (const c of s.exam_contributions) {
      if (seen.has(c.exam_type_id)) continue;
      seen.add(c.exam_type_id);
      cols.push({ exam_type_id: c.exam_type_id, exam_name: c.exam_name });
    }
  }
  return cols;
}

function formatMarks(obtained: number, max: number): string {
  // Trim trailing .0 so "5 / 10" reads better than "5.0 / 10"
  const fmt = (n: number) => {
    const r = Math.round(n * 100) / 100;
    return Number.isInteger(r) ? `${r}` : `${r}`;
  };
  return `${fmt(obtained)} / ${fmt(max)}`;
}

function MainSubjectsTable({
  subjects,
  mergedOptionalIds,
  examColumns,
  aggregatePct,
}: {
  subjects: FinalSubject[];
  mergedOptionalIds: string[];
  examColumns: ExamColumn[];
  aggregatePct: number;
}) {
  const mergedSet = new Set(mergedOptionalIds);
  // Audit H10: when optionals are merged into this table, the displayed
  // aggregate should reflect every row shown (otherwise the user sees
  // 5 rows of pcts but a "Total" line that only averages 4 of them — and
  // any class rank computed from the same number doesn't match the visible
  // subjects). Compute a merged-aggregate locally; fall back to the
  // server-side `aggregatePct` when no optionals are merged.
  const displayedAggregate =
    mergedSet.size > 0
      ? subjects.reduce((acc, s) => acc + s.final_pct, 0) /
        Math.max(subjects.length, 1)
      : aggregatePct;
  return (
    <View style={styles.phase3Table}>
      <View style={styles.phase3TableHeader}>
        <Text style={styles.phase3ColSr}>Sr.</Text>
        <Text style={styles.phase3ColSubject}>Subject</Text>
        {examColumns.map((col) => (
          <Text key={col.exam_type_id} style={styles.phase3ColExam}>
            {col.exam_name}
          </Text>
        ))}
        <Text style={styles.phase3ColNum}>Raw %</Text>
        <Text style={styles.phase3ColGrace}>Grace</Text>
        <Text style={styles.phase3ColNum}>Final %</Text>
        <Text style={styles.phase3ColGrade}>Grade</Text>
        <Text style={styles.phase3ColPF}>P/F</Text>
      </View>
      {subjects.map((sub, idx) => {
        const isMergedOptional = mergedSet.has(sub.subject_id);
        return (
          <View key={sub.subject_id} style={styles.phase3TableRow}>
            <Text style={styles.phase3ColSr}>{idx + 1}</Text>
            <Text style={styles.phase3ColSubject}>
              {sub.subject_name}
              {isMergedOptional ? " (optional)" : ""}
            </Text>
            {examColumns.map((col) => {
              const contrib = sub.exam_contributions.find(
                (c) => c.exam_type_id === col.exam_type_id
              );
              return (
                <Text key={col.exam_type_id} style={styles.phase3ColExam}>
                  {contrib
                    ? formatMarks(contrib.marks_obtained, contrib.max_marks)
                    : "—"}
                </Text>
              );
            })}
            <Text style={styles.phase3ColNum}>{sub.raw_pct}%</Text>
            <Text style={styles.phase3ColGrace}>
              {sub.grace_applied > 0 ? `+${sub.grace_applied}` : "—"}
            </Text>
            <Text style={styles.phase3ColNum}>{sub.final_pct}%</Text>
            <Text style={styles.phase3ColGrade}>{sub.grade ?? "—"}</Text>
            <Text
              style={[
                styles.phase3ColPF,
                sub.passed ? styles.phase3Pass : styles.phase3Fail,
              ]}
            >
              {isMergedOptional ? "—" : sub.passed ? "P" : "F"}
            </Text>
          </View>
        );
      })}
      <View style={styles.phase3TotalRow}>
        <Text style={styles.phase3ColSr}></Text>
        <Text style={styles.phase3ColSubject}>Total / Aggregate</Text>
        {examColumns.map((col) => (
          <Text key={col.exam_type_id} style={styles.phase3ColExam}></Text>
        ))}
        <Text style={styles.phase3ColNum}></Text>
        <Text style={styles.phase3ColGrace}></Text>
        <Text style={styles.phase3ColNum}>
          {Math.round(displayedAggregate * 100) / 100}%
        </Text>
        <Text style={styles.phase3ColGrade}></Text>
        <Text style={styles.phase3ColPF}></Text>
      </View>
    </View>
  );
}

function OptionalSubjectsTable({
  subjects,
  examColumns,
}: {
  subjects: FinalSubject[];
  examColumns: ExamColumn[];
}) {
  return (
    <View style={styles.phase3Table}>
      <View style={styles.phase3TableHeader}>
        <Text style={styles.phase3ColSr}>Sr.</Text>
        <Text style={styles.phase3ColSubject}>Subject</Text>
        {examColumns.map((col) => (
          <Text key={col.exam_type_id} style={styles.phase3ColExam}>
            {col.exam_name}
          </Text>
        ))}
        <Text style={styles.phase3ColNum}>Raw %</Text>
        <Text style={styles.phase3ColGrace}>Grace</Text>
        <Text style={styles.phase3ColNum}>Final %</Text>
        <Text style={styles.phase3ColGrade}>Grade</Text>
      </View>
      {subjects.map((sub, idx) => (
        <View key={sub.subject_id} style={styles.phase3TableRow}>
          <Text style={styles.phase3ColSr}>{idx + 1}</Text>
          <Text style={styles.phase3ColSubject}>{sub.subject_name}</Text>
          {examColumns.map((col) => {
            const contrib = sub.exam_contributions.find(
              (c) => c.exam_type_id === col.exam_type_id
            );
            return (
              <Text key={col.exam_type_id} style={styles.phase3ColExam}>
                {contrib
                  ? formatMarks(contrib.marks_obtained, contrib.max_marks)
                  : "—"}
              </Text>
            );
          })}
          <Text style={styles.phase3ColNum}>{sub.raw_pct}%</Text>
          <Text style={styles.phase3ColGrace}>
            {sub.grace_applied > 0 ? `+${sub.grace_applied}` : "—"}
          </Text>
          <Text style={styles.phase3ColNum}>{sub.final_pct}%</Text>
          <Text style={styles.phase3ColGrade}>{sub.grade ?? "—"}</Text>
        </View>
      ))}
    </View>
  );
}
