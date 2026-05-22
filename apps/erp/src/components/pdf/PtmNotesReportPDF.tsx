import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

export interface PtmReportSchoolHeader {
  name: string;
  address_line: string;
  affiliation: string | null;
  affiliation_number: string | null;
}

export interface PtmReportMeta {
  class_label: string;
  section: string | null;
  exam_name: string | null;
  total_school_meetings: number | null;
}

export interface PtmReportStudentBlock {
  roll_number: number | null;
  admission_no: string;
  full_name: string;
  notes: Array<{
    meeting_date: string;
    attendance: "present" | "absent";
    teacher_remarks: string | null;
    parent_remarks: string | null;
    action_points: string | null;
  }>;
}

export interface PtmNotesReportPDFProps {
  school: PtmReportSchoolHeader;
  meta: PtmReportMeta;
  students: PtmReportStudentBlock[];
  logoData?: Buffer | Uint8Array;
  generatedOn: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 26,
    fontFamily: "Helvetica",
    fontSize: 9,
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
  logo: { width: 46, height: 46 },
  headerText: { flex: 1, alignItems: "center" },
  schoolName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 15,
    color: "#0b2452",
  },
  schoolMeta: { fontSize: 9, color: "#4b5563", marginTop: 2 },
  title: {
    marginTop: 3,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: "#7c2d12",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 10,
    gap: 14,
  },
  metaItem: { flexDirection: "row" },
  metaLabel: {
    fontFamily: "Helvetica-Bold",
    color: "#4b5563",
    fontSize: 9,
    marginRight: 3,
  },
  metaValue: { fontSize: 9, color: "#111827" },
  studentBlock: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 4,
    marginBottom: 8,
    overflow: "hidden",
  },
  studentHeader: {
    backgroundColor: "#fef3c7",
    padding: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rollBadge: {
    backgroundColor: "#1f2937",
    color: "#fff",
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  studentName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: "#111827",
    flex: 1,
  },
  admissionText: {
    fontSize: 8,
    color: "#6b7280",
  },
  notesEmpty: {
    padding: 8,
    textAlign: "center",
    fontSize: 9,
    color: "#9ca3af",
    fontStyle: "italic",
  },
  noteRow: {
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  noteHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  noteDate: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#111827",
  },
  badgePresent: {
    backgroundColor: "#d1fae5",
    color: "#065f46",
    paddingHorizontal: 5,
    paddingVertical: 1,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  badgeAbsent: {
    backgroundColor: "#fee2e2",
    color: "#991b1b",
    paddingHorizontal: 5,
    paddingVertical: 1,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  noteField: {
    flexDirection: "row",
    marginTop: 2,
  },
  noteFieldLabel: {
    fontFamily: "Helvetica-Bold",
    color: "#4b5563",
    fontSize: 8,
    width: 80,
  },
  noteFieldValue: {
    flex: 1,
    fontSize: 9,
    color: "#111827",
    lineHeight: 1.35,
  },
  footer: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 8,
  },
  footerMeta: { fontSize: 8, color: "#6b7280" },
  signatureBlock: { alignItems: "center", width: 140 },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
    width: "100%",
    height: 22,
  },
  signatureLabel: { fontSize: 8, color: "#4b5563", marginTop: 2 },
});

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function PtmNotesReportPDF({
  school,
  meta,
  students,
  logoData,
  generatedOn,
}: PtmNotesReportPDFProps) {
  const classLabel = meta.section
    ? `${meta.class_label} — ${meta.section}`
    : meta.class_label;

  return (
    <Document title={`PTM Notes — ${classLabel}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
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
            <Text style={styles.title}>Parent-Teacher Meeting Notes</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Class:</Text>
            <Text style={styles.metaValue}>{classLabel}</Text>
          </View>
          {meta.exam_name ? (
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Exam:</Text>
              <Text style={styles.metaValue}>{meta.exam_name}</Text>
            </View>
          ) : null}
          {meta.total_school_meetings !== null ? (
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Total School Meetings:</Text>
              <Text style={styles.metaValue}>{meta.total_school_meetings}</Text>
            </View>
          ) : null}
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Students:</Text>
            <Text style={styles.metaValue}>{students.length}</Text>
          </View>
        </View>

        {students.map((s) => (
          <View
            key={`${s.admission_no}-${s.roll_number ?? ""}`}
            style={styles.studentBlock}
            wrap={false}
          >
            <View style={styles.studentHeader}>
              <Text style={styles.rollBadge}>
                Roll {s.roll_number ?? "—"}
              </Text>
              <Text style={styles.studentName}>{s.full_name}</Text>
              <Text style={styles.admissionText}>
                Admission: {s.admission_no || "—"}
              </Text>
            </View>

            {s.notes.length === 0 ? (
              <Text style={styles.notesEmpty}>No meetings recorded.</Text>
            ) : (
              s.notes.map((n, idx) => (
                <View key={idx} style={styles.noteRow}>
                  <View style={styles.noteHead}>
                    <Text style={styles.noteDate}>
                      {fmtDate(n.meeting_date)}
                    </Text>
                    <Text
                      style={
                        n.attendance === "present"
                          ? styles.badgePresent
                          : styles.badgeAbsent
                      }
                    >
                      {n.attendance}
                    </Text>
                  </View>
                  {n.teacher_remarks ? (
                    <View style={styles.noteField}>
                      <Text style={styles.noteFieldLabel}>
                        Teacher remarks:
                      </Text>
                      <Text style={styles.noteFieldValue}>
                        {n.teacher_remarks}
                      </Text>
                    </View>
                  ) : null}
                  {n.parent_remarks ? (
                    <View style={styles.noteField}>
                      <Text style={styles.noteFieldLabel}>
                        Parent remarks:
                      </Text>
                      <Text style={styles.noteFieldValue}>
                        {n.parent_remarks}
                      </Text>
                    </View>
                  ) : null}
                  {n.action_points ? (
                    <View style={styles.noteField}>
                      <Text style={styles.noteFieldLabel}>Action points:</Text>
                      <Text style={styles.noteFieldValue}>
                        {n.action_points}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </View>
        ))}

        <View style={styles.footer}>
          <Text style={styles.footerMeta}>Generated: {generatedOn}</Text>
          <View style={styles.signatureBlock}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Class Teacher</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
