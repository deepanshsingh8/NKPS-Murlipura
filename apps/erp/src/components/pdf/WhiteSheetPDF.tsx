import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type {
  WhiteSheetMeta,
  WhiteSheetStudentRow,
  WhiteSheetSubject,
} from "@/lib/white-sheet";

export interface WhiteSheetSchoolHeader {
  name: string;
  address_line: string;
  affiliation: string | null;
  affiliation_number: string | null;
}

export interface WhiteSheetPDFProps {
  school: WhiteSheetSchoolHeader;
  meta: WhiteSheetMeta;
  subjects: WhiteSheetSubject[];
  rows: WhiteSheetStudentRow[];
  logoData?: Buffer | Uint8Array;
  generatedOn: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 24,
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
    color: "#0b2452",
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
  cellMainCategory: {
    backgroundColor: "#e0f2fe",
  },
  cellOptionalCategory: {
    backgroundColor: "#fef3c7",
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

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function WhiteSheetPDF({
  school,
  meta,
  subjects,
  rows,
  logoData,
  generatedOn,
}: WhiteSheetPDFProps) {
  const classLabel = meta.section
    ? `${meta.class_name} — ${meta.section}`
    : meta.class_name;

  // Column widths: Roll (5%) + Name (18%) + subjects evenly + totals (9% main,
  // 9% optional, 8% total, 6% %, 5% grade). If show_extra_separately is
  // false we collapse the main/optional split columns into a single Total
  // to save horizontal space.
  const hasOptional = subjects.some((s) => s.role === "optional");
  const splitTotals = hasOptional && meta.show_extra_separately;

  const leftFixedWidth = 5 + 18; // Roll + Name
  const rightFixedWidth = splitTotals ? 9 + 9 + 8 + 6 + 5 : 10 + 7 + 5; // totals block
  const subjectWidth = (100 - leftFixedWidth - rightFixedWidth) / Math.max(subjects.length, 1);

  // Orientation choice — if too many columns, flip landscape at render site.
  const orientation: "portrait" | "landscape" =
    subjects.length + (splitTotals ? 2 : 1) > 8 ? "landscape" : "portrait";

  return (
    <Document title={`White Sheet — ${classLabel} — ${meta.exam_name}`}>
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
            <Text style={styles.title}>White Sheet — {meta.exam_name}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Class:</Text>
            <Text style={styles.metaValue}>{classLabel}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Exam:</Text>
            <Text style={styles.metaValue}>{meta.exam_name}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Max Marks:</Text>
            <Text style={styles.metaValue}>{meta.exam_max_marks}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Students:</Text>
            <Text style={styles.metaValue}>{rows.length}</Text>
          </View>
          {!meta.has_result_master ? (
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Note:</Text>
              <Text style={styles.metaValue}>
                No result master — all subjects treated as main
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.table}>
          <View style={styles.headerRow} fixed>
            <Text
              style={[
                styles.cell,
                styles.cellHeader,
                { width: `5%`, textAlign: "center" },
              ]}
            >
              Roll
            </Text>
            <Text
              style={[styles.cell, styles.cellHeader, { width: `18%` }]}
            >
              Student Name
            </Text>
            {subjects.map((s) => (
              <Text
                key={s.subject_id}
                style={[
                  styles.cell,
                  styles.cellHeader,
                  styles.cellCenter,
                  s.role === "optional"
                    ? styles.cellOptionalCategory
                    : styles.cellMainCategory,
                  { width: `${subjectWidth}%` },
                ]}
              >
                {s.code ?? s.name}
              </Text>
            ))}
            {splitTotals ? (
              <>
                <Text
                  style={[
                    styles.cell,
                    styles.cellHeader,
                    styles.cellRight,
                    { width: `9%` },
                  ]}
                >
                  Main
                </Text>
                <Text
                  style={[
                    styles.cell,
                    styles.cellHeader,
                    styles.cellRight,
                    { width: `9%` },
                  ]}
                >
                  Optional
                </Text>
                <Text
                  style={[
                    styles.cell,
                    styles.cellHeader,
                    styles.cellRight,
                    { width: `8%` },
                  ]}
                >
                  Total
                </Text>
                <Text
                  style={[
                    styles.cell,
                    styles.cellHeader,
                    styles.cellRight,
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
                    styles.cellLast,
                    { width: `5%` },
                  ]}
                >
                  Grade
                </Text>
              </>
            ) : (
              <>
                <Text
                  style={[
                    styles.cell,
                    styles.cellHeader,
                    styles.cellRight,
                    { width: `10%` },
                  ]}
                >
                  Total
                </Text>
                <Text
                  style={[
                    styles.cell,
                    styles.cellHeader,
                    styles.cellRight,
                    { width: `7%` },
                  ]}
                >
                  %
                </Text>
                <Text
                  style={[
                    styles.cell,
                    styles.cellHeader,
                    styles.cellCenter,
                    styles.cellLast,
                    { width: `5%` },
                  ]}
                >
                  Grade
                </Text>
              </>
            )}
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
                    { width: `5%` },
                  ]}
                >
                  {r.roll_number ?? ""}
                </Text>
                <Text style={[styles.cell, { width: `18%` }]}>
                  {r.full_name}
                </Text>
                {subjects.map((s) => {
                  const marks = r.marks_by_subject[s.subject_id];
                  return (
                    <Text
                      key={s.subject_id}
                      style={[
                        styles.cell,
                        styles.cellCenter,
                        { width: `${subjectWidth}%` },
                      ]}
                    >
                      {marks === null || marks === undefined ? "" : fmt(marks, 0)}
                    </Text>
                  );
                })}
                {splitTotals ? (
                  <>
                    <Text
                      style={[
                        styles.cell,
                        styles.cellRight,
                        { width: `9%` },
                      ]}
                    >
                      {fmt(r.main_obtained)}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.cellRight,
                        { width: `9%` },
                      ]}
                    >
                      {fmt(r.optional_obtained)}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.cellRight,
                        { width: `8%` },
                      ]}
                    >
                      {fmt(r.total_obtained)}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.cellRight,
                        { width: `6%` },
                      ]}
                    >
                      {r.percentage === null ? "" : fmt(r.percentage, 1)}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.cellCenter,
                        styles.cellLast,
                        { width: `5%` },
                      ]}
                    >
                      {r.grade ?? ""}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text
                      style={[
                        styles.cell,
                        styles.cellRight,
                        { width: `10%` },
                      ]}
                    >
                      {fmt(r.total_obtained)}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.cellRight,
                        { width: `7%` },
                      ]}
                    >
                      {r.percentage === null ? "" : fmt(r.percentage, 1)}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.cellCenter,
                        styles.cellLast,
                        { width: `5%` },
                      ]}
                    >
                      {r.grade ?? ""}
                    </Text>
                  </>
                )}
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
