import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

export interface BlankMarksListSchoolHeader {
  name: string;
  address_line: string;
  affiliation: string | null;
  affiliation_number: string | null;
}

export interface BlankMarksListStudent {
  roll_number: number | null;
  admission_no: string;
  full_name: string;
}

export interface BlankMarksListMeta {
  class_label: string;
  section: string | null;
  exam_name: string;
  subject_name: string;
  subject_code: string | null;
  max_marks: number;
  exam_date: string | null;
  room: string | null;
}

export interface BlankMarksListPDFProps {
  school: BlankMarksListSchoolHeader;
  meta: BlankMarksListMeta;
  students: BlankMarksListStudent[];
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
  logo: { width: 52, height: 52 },
  headerText: { flex: 1, alignItems: "center" },
  schoolName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 17,
    color: "#0b2452",
    letterSpacing: 0.4,
  },
  schoolMeta: { fontSize: 9, color: "#4b5563", marginTop: 2 },
  title: {
    marginTop: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: "#0b2452",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  metaBlock: {
    marginTop: 6,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 4,
    padding: 8,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  metaCell: {
    width: "33.33%",
    paddingVertical: 2,
    flexDirection: "row",
  },
  metaLabel: {
    fontFamily: "Helvetica-Bold",
    color: "#4b5563",
    fontSize: 9,
    marginRight: 4,
  },
  metaValue: {
    fontSize: 9,
    color: "#111827",
    flex: 1,
  },
  table: {
    borderWidth: 1,
    borderColor: "#9ca3af",
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottomWidth: 1,
    borderBottomColor: "#9ca3af",
  },
  bodyRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#d1d5db",
    minHeight: 22,
  },
  cell: {
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderRightColor: "#d1d5db",
    fontSize: 9,
  },
  cellHeader: {
    fontFamily: "Helvetica-Bold",
    color: "#374151",
  },
  colSerial: { width: "8%", textAlign: "center" },
  colRoll: { width: "10%", textAlign: "center" },
  colAdmission: { width: "16%" },
  colName: { width: "36%" },
  colMarks: { width: "15%", textAlign: "center" },
  colSign: { width: "15%", borderRightWidth: 0 },
  footer: {
    marginTop: 24,
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
  emptyState: {
    padding: 18,
    textAlign: "center",
    fontSize: 10,
    color: "#9ca3af",
  },
});

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function BlankMarksListPDF({
  school,
  meta,
  students,
  logoData,
  generatedOn,
}: BlankMarksListPDFProps) {
  const classLabel = meta.section
    ? `${meta.class_label} — ${meta.section}`
    : meta.class_label;
  const subjectLabel = meta.subject_code
    ? `${meta.subject_name} (${meta.subject_code})`
    : meta.subject_name;

  return (
    <Document
      title={`Blank Marks List — ${classLabel} — ${meta.subject_name} — ${meta.exam_name}`}
    >
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
            <Text style={styles.title}>Blank Marks List</Text>
          </View>
        </View>

        <View style={styles.metaBlock}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Class:</Text>
            <Text style={styles.metaValue}>{classLabel}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Exam:</Text>
            <Text style={styles.metaValue}>{meta.exam_name}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Subject:</Text>
            <Text style={styles.metaValue}>{subjectLabel}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Max Marks:</Text>
            <Text style={styles.metaValue}>{meta.max_marks}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Date:</Text>
            <Text style={styles.metaValue}>{formatDate(meta.exam_date)}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Room:</Text>
            <Text style={styles.metaValue}>{meta.room ?? "—"}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.headerRow} fixed>
            <Text style={[styles.cell, styles.cellHeader, styles.colSerial]}>
              S.No
            </Text>
            <Text style={[styles.cell, styles.cellHeader, styles.colRoll]}>
              Roll
            </Text>
            <Text style={[styles.cell, styles.cellHeader, styles.colAdmission]}>
              Admission No
            </Text>
            <Text style={[styles.cell, styles.cellHeader, styles.colName]}>
              Student Name
            </Text>
            <Text style={[styles.cell, styles.cellHeader, styles.colMarks]}>
              Marks Obtained
            </Text>
            <Text style={[styles.cell, styles.cellHeader, styles.colSign]}>
              Signature
            </Text>
          </View>
          {students.length === 0 ? (
            <Text style={styles.emptyState}>No students enrolled.</Text>
          ) : (
            students.map((s, idx) => (
              <View
                key={`${s.admission_no}-${idx}`}
                style={styles.bodyRow}
                wrap={false}
              >
                <Text style={[styles.cell, styles.colSerial]}>{idx + 1}</Text>
                <Text style={[styles.cell, styles.colRoll]}>
                  {s.roll_number ?? ""}
                </Text>
                <Text style={[styles.cell, styles.colAdmission]}>
                  {s.admission_no}
                </Text>
                <Text style={[styles.cell, styles.colName]}>{s.full_name}</Text>
                <Text style={[styles.cell, styles.colMarks]}></Text>
                <Text style={[styles.cell, styles.colSign]}></Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerMeta}>Generated: {generatedOn}</Text>
          <View style={styles.signatureBlock}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Invigilator / Examiner</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
