import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type {
  GreenSheetExam,
  GreenSheetMeta,
  GreenSheetStudentRow,
} from "@/lib/green-sheet";

export interface GreenSheetSchoolHeader {
  name: string;
  address_line: string;
  affiliation: string | null;
  affiliation_number: string | null;
}

export interface GreenSheetPDFProps {
  school: GreenSheetSchoolHeader;
  meta: GreenSheetMeta;
  exams: GreenSheetExam[];
  rows: GreenSheetStudentRow[];
  logoData?: Buffer | Uint8Array;
  generatedOn: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 22,
    fontFamily: "Helvetica",
    fontSize: 8,
    color: "#111827",
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: "#0b2452",
    paddingBottom: 6,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logo: { width: 42, height: 42 },
  headerText: { flex: 1, alignItems: "center" },
  schoolName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: "#0b2452",
    letterSpacing: 0.3,
  },
  schoolMeta: { fontSize: 8, color: "#4b5563", marginTop: 1 },
  title: {
    marginTop: 2,
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: "#166534",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 6,
    gap: 12,
  },
  metaItem: { flexDirection: "row" },
  metaLabel: {
    fontFamily: "Helvetica-Bold",
    color: "#4b5563",
    fontSize: 8,
    marginRight: 3,
  },
  metaValue: { fontSize: 8, color: "#111827" },
  table: {
    borderWidth: 1,
    borderColor: "#9ca3af",
  },
  categoryRow: {
    flexDirection: "row",
    backgroundColor: "#ecfdf5",
    borderBottomWidth: 1,
    borderBottomColor: "#9ca3af",
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
    minHeight: 18,
  },
  cell: {
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderRightWidth: 1,
    borderRightColor: "#d1d5db",
    fontSize: 7,
  },
  cellHeader: {
    fontFamily: "Helvetica-Bold",
    color: "#374151",
  },
  cellFinal: {
    backgroundColor: "#f0fdf4",
  },
  cellCenter: { textAlign: "center" },
  cellRight: { textAlign: "right" },
  cellLast: { borderRightWidth: 0 },
  footer: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 6,
  },
  footerMeta: { fontSize: 7, color: "#6b7280" },
  signatureBlock: { alignItems: "center", width: 120 },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
    width: "100%",
    height: 20,
  },
  signatureLabel: { fontSize: 7, color: "#4b5563", marginTop: 2 },
  emptyState: {
    padding: 14,
    textAlign: "center",
    fontSize: 9,
    color: "#9ca3af",
  },
});

function fmt1(n: number): string {
  return n.toFixed(1);
}

export function GreenSheetPDF({
  school,
  meta,
  exams,
  rows,
  logoData,
  generatedOn,
}: GreenSheetPDFProps) {
  const classLabel = meta.section
    ? `${meta.class_name} — ${meta.section}`
    : meta.class_name;

  // Per-exam block: obtained (5%) + % (5%). Left fixed (Roll 4% + Name 16%)
  // = 20%. Final block: % (6%) + Grade (5%) + Rank (5%) = 16%. Exam budget
  // = 100 - 20 - 16 = 64% ÷ exams. Landscape for >4 exams to keep cells
  // readable.
  const examBlockWidth = Math.max(8, 64 / Math.max(exams.length, 1));
  const perExamColWidth = examBlockWidth / 2;
  const orientation: "portrait" | "landscape" =
    exams.length >= 4 ? "landscape" : "portrait";

  return (
    <Document title={`Green Sheet — ${classLabel} — ${meta.academic_year_label}`}>
      <Page size="A4" orientation={orientation} style={styles.page}>
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
            <Text style={styles.title}>
              Green Sheet — {meta.academic_year_label}
            </Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Class:</Text>
            <Text style={styles.metaValue}>{classLabel}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Session:</Text>
            <Text style={styles.metaValue}>{meta.academic_year_label}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Exams:</Text>
            <Text style={styles.metaValue}>{exams.length}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Students:</Text>
            <Text style={styles.metaValue}>{rows.length}</Text>
          </View>
          {!meta.has_result_master ? (
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Note:</Text>
              <Text style={styles.metaValue}>
                No result master — final columns blank
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.table}>
          {/* Category row: exam name spans its two cols; final spans its three */}
          <View style={styles.categoryRow} fixed>
            <Text
              style={[
                styles.cell,
                styles.cellHeader,
                styles.cellCenter,
                { width: `4%` },
              ]}
            >
              {" "}
            </Text>
            <Text style={[styles.cell, styles.cellHeader, { width: `16%` }]}>
              {" "}
            </Text>
            {exams.map((e) => (
              <Text
                key={e.exam_type_id}
                style={[
                  styles.cell,
                  styles.cellHeader,
                  styles.cellCenter,
                  { width: `${examBlockWidth}%` },
                ]}
              >
                {e.exam_name}
                {e.weightage ? ` (${e.weightage}%)` : ""}
              </Text>
            ))}
            <Text
              style={[
                styles.cell,
                styles.cellHeader,
                styles.cellCenter,
                styles.cellFinal,
                styles.cellLast,
                { width: `16%` },
              ]}
            >
              Final Result
            </Text>
          </View>

          {/* Sub-header row */}
          <View style={styles.headerRow} fixed>
            <Text
              style={[
                styles.cell,
                styles.cellHeader,
                styles.cellCenter,
                { width: `4%` },
              ]}
            >
              Roll
            </Text>
            <Text style={[styles.cell, styles.cellHeader, { width: `16%` }]}>
              Student
            </Text>
            {exams.map((e) => (
              <View
                key={e.exam_type_id}
                style={{ flexDirection: "row", width: `${examBlockWidth}%` }}
              >
                <Text
                  style={[
                    styles.cell,
                    styles.cellHeader,
                    styles.cellRight,
                    { width: `${perExamColWidth / examBlockWidth * 100}%` },
                  ]}
                >
                  Obt.
                </Text>
                <Text
                  style={[
                    styles.cell,
                    styles.cellHeader,
                    styles.cellRight,
                    { width: `${perExamColWidth / examBlockWidth * 100}%` },
                  ]}
                >
                  %
                </Text>
              </View>
            ))}
            <Text
              style={[
                styles.cell,
                styles.cellHeader,
                styles.cellRight,
                styles.cellFinal,
                { width: `6%` },
              ]}
            >
              %
            </Text>
            <Text
              style={[
                styles.cell,
                styles.cellHeader,
                styles.cellCenter,
                styles.cellFinal,
                { width: `5%` },
              ]}
            >
              Grade
            </Text>
            <Text
              style={[
                styles.cell,
                styles.cellHeader,
                styles.cellCenter,
                styles.cellFinal,
                styles.cellLast,
                { width: `5%` },
              ]}
            >
              Rank
            </Text>
          </View>

          {rows.length === 0 ? (
            <Text style={styles.emptyState}>No students enrolled.</Text>
          ) : (
            rows.map((r) => (
              <View key={r.student_id} style={styles.bodyRow} wrap={false}>
                <Text
                  style={[
                    styles.cell,
                    styles.cellCenter,
                    { width: `4%` },
                  ]}
                >
                  {r.roll_number ?? ""}
                </Text>
                <Text style={[styles.cell, { width: `16%` }]}>
                  {r.full_name}
                </Text>
                {exams.map((e) => {
                  const cell = r.per_exam[e.exam_type_id];
                  return (
                    <View
                      key={e.exam_type_id}
                      style={{ flexDirection: "row", width: `${examBlockWidth}%` }}
                    >
                      <Text
                        style={[
                          styles.cell,
                          styles.cellRight,
                          { width: `${perExamColWidth / examBlockWidth * 100}%` },
                        ]}
                      >
                        {cell && cell.total_max > 0
                          ? `${cell.total_obtained}/${cell.total_max}`
                          : ""}
                      </Text>
                      <Text
                        style={[
                          styles.cell,
                          styles.cellRight,
                          { width: `${perExamColWidth / examBlockWidth * 100}%` },
                        ]}
                      >
                        {cell && cell.percentage !== null
                          ? fmt1(cell.percentage)
                          : ""}
                      </Text>
                    </View>
                  );
                })}
                <Text
                  style={[
                    styles.cell,
                    styles.cellRight,
                    styles.cellFinal,
                    { width: `6%` },
                  ]}
                >
                  {r.final ? fmt1(r.final.overall.main_total_pct) : ""}
                </Text>
                <Text
                  style={[
                    styles.cell,
                    styles.cellCenter,
                    styles.cellFinal,
                    { width: `5%` },
                  ]}
                >
                  {r.final?.overall.grade ?? ""}
                </Text>
                <Text
                  style={[
                    styles.cell,
                    styles.cellCenter,
                    styles.cellFinal,
                    styles.cellLast,
                    { width: `5%` },
                  ]}
                >
                  {meta.show_rank && r.final?.rank ? r.final.rank : ""}
                </Text>
              </View>
            ))
          )}
        </View>

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
