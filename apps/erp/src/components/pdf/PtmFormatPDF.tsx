import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

export interface PtmFormatSchoolHeader {
  name: string;
  address_line: string;
  affiliation: string | null;
  affiliation_number: string | null;
}

export interface PtmFormatTemplate {
  name: string;
  intro_text: string | null;
  closing_text: string | null;
  show_student_details: boolean;
  show_photo: boolean;
  show_father_name: boolean;
  show_mother_name: boolean;
  show_performance_snapshot: boolean;
  show_teacher_remarks_section: boolean;
  teacher_remarks_lines: number;
  show_parent_signature: boolean;
  signature_labels: string[];
}

export interface PtmFormatStudent {
  full_name: string;
  admission_no: string;
  roll_number: number | null;
  class_label: string;
  section: string | null;
  father_name: string | null;
  mother_name: string | null;
  photo_bytes?: Buffer | Uint8Array;
}

export interface PtmFormatSubjectRow {
  subject_name: string;
  marks_obtained: number | null;
  max_marks: number | null;
  grade: string | null;
}

export interface PtmFormatPerformance {
  exam_name: string | null;
  subjects: PtmFormatSubjectRow[];
  total_obtained: number;
  total_max: number;
  percentage: number | null;
  grade: string | null;
}

export interface PtmFormatPDFProps {
  school: PtmFormatSchoolHeader;
  template: PtmFormatTemplate;
  students: Array<{
    student: PtmFormatStudent;
    performance: PtmFormatPerformance | null;
  }>;
  logoData?: Buffer | Uint8Array;
  generatedOn: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#111827",
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: "#0b2452",
    paddingBottom: 8,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logo: { width: 48, height: 48 },
  headerText: { flex: 1, alignItems: "center" },
  schoolName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 16,
    color: "#0b2452",
    letterSpacing: 0.3,
  },
  schoolMeta: { fontSize: 9, color: "#4b5563", marginTop: 2 },
  title: {
    marginTop: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: "#7c2d12",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  intro: {
    fontSize: 9.5,
    color: "#374151",
    marginBottom: 10,
    lineHeight: 1.45,
  },
  section: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 4,
    marginBottom: 10,
    overflow: "hidden",
  },
  sectionHeader: {
    backgroundColor: "#fef3c7",
    paddingVertical: 4,
    paddingHorizontal: 8,
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: "#78350f",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  studentRow: {
    padding: 8,
    flexDirection: "row",
    gap: 10,
  },
  detailsCol: { flex: 1, gap: 2 },
  detailLine: { flexDirection: "row" },
  detailLabel: {
    width: 95,
    fontFamily: "Helvetica-Bold",
    color: "#4b5563",
    fontSize: 9,
  },
  detailValue: { flex: 1, fontSize: 10, color: "#111827" },
  photoFrame: {
    width: 84,
    height: 104,
    borderWidth: 1,
    borderColor: "#9ca3af",
    alignItems: "center",
    justifyContent: "center",
  },
  photoImage: {
    width: 82,
    height: 102,
    objectFit: "cover",
  },
  photoPlaceholder: {
    fontSize: 8,
    color: "#9ca3af",
    textAlign: "center",
  },
  perfTable: {},
  perfHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottomWidth: 1,
    borderBottomColor: "#d1d5db",
  },
  perfRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    minHeight: 18,
  },
  perfTotalRow: {
    flexDirection: "row",
    backgroundColor: "#fafaf9",
  },
  perfCell: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderRightColor: "#d1d5db",
    fontSize: 9,
  },
  perfCellHeader: {
    fontFamily: "Helvetica-Bold",
    color: "#374151",
  },
  perfCellLast: { borderRightWidth: 0 },
  perfCellRight: { textAlign: "right" },
  perfCellCenter: { textAlign: "center" },
  perfCellSubject: { width: "48%" },
  perfCellObt: { width: "17%" },
  perfCellMax: { width: "17%" },
  perfCellGrade: { width: "18%" },
  perfEmpty: {
    padding: 10,
    textAlign: "center",
    fontSize: 9,
    color: "#9ca3af",
  },
  remarkBox: {
    padding: 10,
    gap: 10,
  },
  remarkLine: {
    borderBottomWidth: 1,
    borderBottomColor: "#9ca3af",
    height: 16,
    borderStyle: "dashed",
  },
  closing: {
    fontSize: 9.5,
    color: "#374151",
    marginTop: 10,
    marginBottom: 14,
    lineHeight: 1.45,
  },
  signatureRow: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 24,
  },
  signatureBlock: {
    alignItems: "center",
    flex: 1,
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
    width: "80%",
    height: 24,
  },
  signatureLabel: {
    fontSize: 9,
    color: "#4b5563",
    marginTop: 3,
  },
  footerMeta: {
    marginTop: 8,
    fontSize: 7,
    color: "#9ca3af",
    textAlign: "right",
  },
});

function fmtPct(p: number | null): string {
  return p === null ? "—" : `${p.toFixed(1)}%`;
}

export function PtmFormatPDF({
  school,
  template,
  students,
  logoData,
  generatedOn,
}: PtmFormatPDFProps) {
  return (
    <Document title={`PTM Format — ${template.name}`}>
      {students.map(({ student, performance }, idx) => {
        const classLabel = student.section
          ? `${student.class_label} — ${student.section}`
          : student.class_label;
        return (
          <Page key={idx} size="A4" style={styles.page}>
            <View style={styles.header}>
              {logoData ? (
                <Image
                  src={{ data: Buffer.from(logoData), format: "png" }}
                  style={styles.logo}
                />
              ) : null}
              <View style={styles.headerText}>
                <Text style={styles.schoolName}>{school.name}</Text>
                <Text style={styles.schoolMeta}>{school.address_line}</Text>
                {school.affiliation ? (
                  <Text style={styles.schoolMeta}>
                    {school.affiliation}
                    {school.affiliation_number
                      ? ` · ${school.affiliation_number}`
                      : ""}
                  </Text>
                ) : null}
                <Text style={styles.title}>
                  Parent-Teacher Meeting Handout
                </Text>
              </View>
            </View>

            {template.intro_text ? (
              <Text style={styles.intro}>{template.intro_text}</Text>
            ) : null}

            {template.show_student_details ? (
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>Student details</Text>
                <View style={styles.studentRow}>
                  <View style={styles.detailsCol}>
                    <View style={styles.detailLine}>
                      <Text style={styles.detailLabel}>Name:</Text>
                      <Text style={styles.detailValue}>
                        {student.full_name}
                      </Text>
                    </View>
                    <View style={styles.detailLine}>
                      <Text style={styles.detailLabel}>Class:</Text>
                      <Text style={styles.detailValue}>{classLabel}</Text>
                    </View>
                    <View style={styles.detailLine}>
                      <Text style={styles.detailLabel}>Roll No:</Text>
                      <Text style={styles.detailValue}>
                        {student.roll_number ?? "—"}
                      </Text>
                    </View>
                    <View style={styles.detailLine}>
                      <Text style={styles.detailLabel}>Admission No:</Text>
                      <Text style={styles.detailValue}>
                        {student.admission_no || "—"}
                      </Text>
                    </View>
                    {template.show_father_name ? (
                      <View style={styles.detailLine}>
                        <Text style={styles.detailLabel}>Father:</Text>
                        <Text style={styles.detailValue}>
                          {student.father_name || "—"}
                        </Text>
                      </View>
                    ) : null}
                    {template.show_mother_name ? (
                      <View style={styles.detailLine}>
                        <Text style={styles.detailLabel}>Mother:</Text>
                        <Text style={styles.detailValue}>
                          {student.mother_name || "—"}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {template.show_photo ? (
                    <View style={styles.photoFrame}>
                      {student.photo_bytes ? (
                        <Image
                          src={{
                            data: Buffer.from(student.photo_bytes),
                            format: "jpg",
                          }}
                          style={styles.photoImage}
                        />
                      ) : (
                        <Text style={styles.photoPlaceholder}>
                          Photo
                        </Text>
                      )}
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            {template.show_performance_snapshot ? (
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>
                  Performance snapshot
                  {performance?.exam_name ? ` — ${performance.exam_name}` : ""}
                </Text>
                <View style={styles.perfTable}>
                  <View style={styles.perfHeaderRow}>
                    <Text
                      style={[
                        styles.perfCell,
                        styles.perfCellHeader,
                        styles.perfCellSubject,
                      ]}
                    >
                      Subject
                    </Text>
                    <Text
                      style={[
                        styles.perfCell,
                        styles.perfCellHeader,
                        styles.perfCellRight,
                        styles.perfCellObt,
                      ]}
                    >
                      Obtained
                    </Text>
                    <Text
                      style={[
                        styles.perfCell,
                        styles.perfCellHeader,
                        styles.perfCellRight,
                        styles.perfCellMax,
                      ]}
                    >
                      Max
                    </Text>
                    <Text
                      style={[
                        styles.perfCell,
                        styles.perfCellHeader,
                        styles.perfCellCenter,
                        styles.perfCellLast,
                        styles.perfCellGrade,
                      ]}
                    >
                      Grade
                    </Text>
                  </View>

                  {!performance || performance.subjects.length === 0 ? (
                    <Text style={styles.perfEmpty}>
                      No results recorded yet.
                    </Text>
                  ) : (
                    <>
                      {performance.subjects.map((s, i) => (
                        <View key={i} style={styles.perfRow}>
                          <Text
                            style={[styles.perfCell, styles.perfCellSubject]}
                          >
                            {s.subject_name}
                          </Text>
                          <Text
                            style={[
                              styles.perfCell,
                              styles.perfCellRight,
                              styles.perfCellObt,
                            ]}
                          >
                            {s.marks_obtained ?? "—"}
                          </Text>
                          <Text
                            style={[
                              styles.perfCell,
                              styles.perfCellRight,
                              styles.perfCellMax,
                            ]}
                          >
                            {s.max_marks ?? "—"}
                          </Text>
                          <Text
                            style={[
                              styles.perfCell,
                              styles.perfCellCenter,
                              styles.perfCellLast,
                              styles.perfCellGrade,
                            ]}
                          >
                            {s.grade ?? ""}
                          </Text>
                        </View>
                      ))}
                      <View style={styles.perfTotalRow}>
                        <Text
                          style={[
                            styles.perfCell,
                            styles.perfCellHeader,
                            styles.perfCellSubject,
                          ]}
                        >
                          Total ({fmtPct(performance.percentage)})
                        </Text>
                        <Text
                          style={[
                            styles.perfCell,
                            styles.perfCellRight,
                            styles.perfCellObt,
                          ]}
                        >
                          {performance.total_obtained}
                        </Text>
                        <Text
                          style={[
                            styles.perfCell,
                            styles.perfCellRight,
                            styles.perfCellMax,
                          ]}
                        >
                          {performance.total_max}
                        </Text>
                        <Text
                          style={[
                            styles.perfCell,
                            styles.perfCellCenter,
                            styles.perfCellLast,
                            styles.perfCellGrade,
                          ]}
                        >
                          {performance.grade ?? ""}
                        </Text>
                      </View>
                    </>
                  )}
                </View>
              </View>
            ) : null}

            {template.show_teacher_remarks_section &&
            template.teacher_remarks_lines > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>Teacher remarks</Text>
                <View style={styles.remarkBox}>
                  {Array.from({
                    length: template.teacher_remarks_lines,
                  }).map((_, i) => (
                    <View key={i} style={styles.remarkLine} />
                  ))}
                </View>
              </View>
            ) : null}

            {template.closing_text ? (
              <Text style={styles.closing}>{template.closing_text}</Text>
            ) : null}

            {template.show_parent_signature ? (
              <View style={styles.signatureRow}>
                {(template.signature_labels.length > 0
                  ? template.signature_labels
                  : ["Class Teacher", "Parent Signature"]
                ).map((label, i) => (
                  <View key={i} style={styles.signatureBlock}>
                    <View style={styles.signatureLine} />
                    <Text style={styles.signatureLabel}>{label}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Text style={styles.footerMeta}>Generated: {generatedOn}</Text>
          </Page>
        );
      })}
    </Document>
  );
}
