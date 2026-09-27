import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

export interface ReportPDFSchool {
  name: string;
  address_line: string;
  affiliation: string | null;
  affiliation_number: string | null;
}

export interface ReportPDFColumn {
  label: string;
  /** Width hint in characters, from the field registry. */
  width: number;
  numeric: boolean;
  /** Blank-1/2/3: rendered as an empty ruled cell to write into. */
  blank: boolean;
}

export interface ReportPDFProps {
  school: ReportPDFSchool;
  title: string;
  /** "Session 2026-2027 · Classes IX-A, X-B · Active" — the filters, in words. */
  subtitle: string;
  columns: ReportPDFColumn[];
  rows: (string | number | null)[][];
  logoData?: Buffer | Uint8Array;
  generatedOn: string;
  footerNote: string | null;
}

/**
 * Landscape sheet for the Custom Report Builder.
 *
 * Column widths come from the registry's per-field hints used as flex weights,
 * not from measuring content: a report is printed to be written on and filed,
 * so the same field must occupy the same width on every run. Auto-fitting to
 * content would make two printings of the same report un-comparable.
 *
 * The header row is `fixed`, so it repeats at the top of every page — a
 * 6-page list whose column headings appear only on page 1 is unusable at a
 * desk, which is exactly where these get used.
 */
const styles = StyleSheet.create({
  page: {
    paddingTop: 20,
    paddingBottom: 32,
    paddingHorizontal: 18,
    fontFamily: "Helvetica",
    fontSize: 7.5,
    color: "#111827",
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: "#0b2452",
    paddingBottom: 5,
    marginBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logo: { width: 36, height: 36 },
  headerText: { flex: 1, alignItems: "center" },
  schoolName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    color: "#0b2452",
    letterSpacing: 0.3,
  },
  schoolMeta: { fontSize: 7.5, color: "#4b5563", marginTop: 1 },
  title: {
    marginTop: 2,
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
    color: "#0b2452",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  subtitle: { fontSize: 7.5, color: "#4b5563", marginTop: 1 },

  table: { borderWidth: 0.5, borderColor: "#9ca3af" },
  headRow: {
    flexDirection: "row",
    backgroundColor: "#e5e7eb",
    borderBottomWidth: 0.5,
    borderBottomColor: "#9ca3af",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.25,
    borderBottomColor: "#d1d5db",
    minHeight: 14,
  },
  rowAlt: { backgroundColor: "#f9fafb" },
  cell: {
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderRightWidth: 0.25,
    borderRightColor: "#d1d5db",
  },
  headCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderRightWidth: 0.25,
    borderRightColor: "#9ca3af",
    color: "#0b2452",
  },
  numeric: { textAlign: "right" },

  footer: {
    position: "absolute",
    bottom: 14,
    left: 18,
    right: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 6.5,
    color: "#6b7280",
    borderTopWidth: 0.5,
    borderTopColor: "#d1d5db",
    paddingTop: 3,
  },
});

export function ReportPDF({
  school,
  title,
  subtitle,
  columns,
  rows,
  logoData,
  generatedOn,
  footerNote,
}: ReportPDFProps) {
  const totalWeight = columns.reduce((sum, c) => sum + Math.max(c.width, 4), 0);
  const flexFor = (c: ReportPDFColumn) => Math.max(c.width, 4) / totalWeight;

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header} fixed>
          {logoData ? (
            <Image
              style={styles.logo}
              src={{ data: Buffer.from(logoData), format: "png" }}
            />
          ) : null}
          <View style={styles.headerText}>
            <Text style={styles.schoolName}>{school.name}</Text>
            <Text style={styles.schoolMeta}>{school.address_line}</Text>
            {school.affiliation ? (
              <Text style={styles.schoolMeta}>
                {school.affiliation}
                {school.affiliation_number ? ` — ${school.affiliation_number}` : ""}
              </Text>
            ) : null}
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.headRow} fixed>
            {columns.map((c, i) => (
              <Text
                key={i}
                style={[
                  styles.headCell,
                  { flexGrow: flexFor(c), flexBasis: 0 },
                  ...(c.numeric ? [styles.numeric] : []),
                ]}
              >
                {c.label}
              </Text>
            ))}
          </View>

          {rows.map((row, r) => (
            <View
              key={r}
              // wrap={false} keeps a single student's row from being split
              // across a page boundary, which would print half a name.
              wrap={false}
              style={[styles.row, ...(r % 2 === 1 ? [styles.rowAlt] : [])]}
            >
              {columns.map((c, i) => (
                <Text
                  key={i}
                  style={[
                    styles.cell,
                    { flexGrow: flexFor(c), flexBasis: 0 },
                    ...(c.numeric ? [styles.numeric] : []),
                  ]}
                >
                  {/* Blank columns stay empty on purpose — they exist to be
                      written in by hand (attendance ticks, signatures). */}
                  {c.blank ? " " : (row[i] ?? "")}
                </Text>
              ))}
            </View>
          ))}

          {rows.length === 0 ? (
            <View style={styles.row}>
              <Text style={[styles.cell, { flexGrow: 1, flexBasis: 0 }]}>
                No students matched these filters.
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.footer} fixed>
          <Text>{footerNote ?? "This is a computer-generated document."}</Text>
          <Text>
            {rows.length} student{rows.length === 1 ? "" : "s"} · Generated{" "}
            {generatedOn}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
