// Generic "a filtered list, on the school letterhead" PDF.
//
// Every other PDF in this codebase renders one known report with a hand-built
// column layout. This one receives an arbitrary table, so the layout has to be
// derived: page size, orientation, font size and column widths all fall out of
// how many columns there are and how wide their contents run.

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

export interface ListTablePdfSchool {
  name: string;
  address_line: string;
  affiliation: string | null;
  affiliation_number: string | null;
}

export interface ListTablePdfFilter {
  label: string;
  value: string;
}

export interface ListTablePDFProps {
  school: ListTablePdfSchool;
  title: string;
  subtitle?: string;
  filterSummary: ListTablePdfFilter[];
  headers: string[];
  aligns: ("left" | "right")[];
  rows: string[][];
  orientation?: "auto" | "portrait" | "landscape";
  logoData?: Buffer | Uint8Array;
  /** Who pressed Download, and when. Printed on every page — see below. */
  generatedBy: string;
  generatedOn: string;
  /** Registered font family, when one covers the script in the data. */
  bodyFont?: string;
  boldFont?: string;
}

/**
 * A4 landscape is 842pt wide; at 22pt margins that leaves ~798pt. A column
 * stops being legible below ~45pt, so ~17 columns is the practical A4 limit
 * and anything wider steps up to A3.
 */
interface Layout {
  size: "A4" | "A3";
  orientation: "portrait" | "landscape";
  fontSize: number;
  headerFontSize: number;
}

/**
 * Trim a cell to what actually fits.
 *
 * This version of @react-pdf/renderer offers no line clamp, and without one a
 * single long address wraps to eight lines and turns the row into a band —
 * the table stops reading as a grid. Truncating on a computed budget keeps
 * every row the same height, and is deterministic rather than dependent on
 * renderer behaviour.
 */
function clampCell(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return text.slice(0, Math.max(1, budget - 1)).trimEnd() + "…";
}

function pickLayout(
  columnCount: number,
  requested: "auto" | "portrait" | "landscape"
): Layout {
  const layout: Layout =
    columnCount <= 6
      ? { size: "A4", orientation: "portrait", fontSize: 9, headerFontSize: 9 }
      : columnCount <= 10
        ? { size: "A4", orientation: "landscape", fontSize: 9, headerFontSize: 9 }
        : columnCount <= 17
          ? { size: "A4", orientation: "landscape", fontSize: 7, headerFontSize: 7 }
          : { size: "A3", orientation: "landscape", fontSize: 7, headerFontSize: 7 };

  if (requested !== "auto") layout.orientation = requested;
  return layout;
}

const MIN_COL_PT = 40;
const MAX_COL_PT = 160;
/** Sampled rather than exhaustive: widths only have to look right. */
const WIDTH_SAMPLE_LIMIT = 400;
/** How many lines a cell may occupy before it is truncated. */
const MAX_CELL_LINES = 2;
/** Usable text width, in points, at 22pt margins. */
const USABLE_WIDTH_PT: Record<"A4" | "A3", { portrait: number; landscape: number }> = {
  A4: { portrait: 551, landscape: 798 },
  A3: { portrait: 798, landscape: 1147 },
};

/**
 * Column widths as percentages.
 *
 * Sized on the 90th-percentile cell rather than the longest, so one student
 * with a very long address does not squeeze every other column to nothing —
 * that outlier wraps instead.
 */
function columnPercentages(headers: string[], rows: string[][]): number[] {
  const step = Math.max(1, Math.floor(rows.length / WIDTH_SAMPLE_LIMIT));

  const raw = headers.map((header, index) => {
    const lengths: number[] = [];
    for (let r = 0; r < rows.length; r += step) {
      lengths.push(rows[r][index]?.length ?? 0);
    }
    lengths.sort((a, b) => a - b);
    const p90 = lengths.length
      ? lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.9))]
      : 0;
    // ~5pt per character is about right for 7-9pt Helvetica.
    const pts = Math.max(header.length, p90) * 5 + 10;
    return Math.min(MAX_COL_PT, Math.max(MIN_COL_PT, pts));
  });

  const total = raw.reduce((sum, w) => sum + w, 0) || 1;
  return raw.map((w) => (w / total) * 100);
}

export function ListTablePDF({
  school,
  title,
  subtitle,
  filterSummary,
  headers,
  aligns,
  rows,
  orientation = "auto",
  logoData,
  generatedBy,
  generatedOn,
  bodyFont = "Helvetica",
  boldFont = "Helvetica-Bold",
}: ListTablePDFProps) {
  const layout = pickLayout(headers.length, orientation);
  const widths = columnPercentages(headers, rows);

  // Helvetica averages a bit over half the font size per character.
  const usable = USABLE_WIDTH_PT[layout.size][layout.orientation];
  const charBudgets = widths.map((pct) =>
    Math.max(
      6,
      Math.floor(
        ((pct / 100) * usable * MAX_CELL_LINES) / (layout.fontSize * 0.52)
      )
    )
  );

  const styles = StyleSheet.create({
    page: {
      paddingHorizontal: 22,
      paddingTop: 22,
      // Room for the fixed footer, which would otherwise overlap the last rows.
      paddingBottom: 34,
      fontFamily: bodyFont,
      fontSize: layout.fontSize,
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
      fontFamily: boldFont,
      fontSize: 14,
      color: "#0b2452",
      letterSpacing: 0.3,
    },
    schoolMeta: { fontSize: 8, color: "#4b5563", marginTop: 1 },
    title: {
      marginTop: 2,
      fontFamily: boldFont,
      fontSize: 11,
      color: "#0b2452",
    },
    subtitle: { fontSize: 8, color: "#4b5563", marginTop: 1 },
    filters: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 4,
      marginBottom: 6,
    },
    filterChip: {
      backgroundColor: "#eff6ff",
      color: "#1d4ed8",
      paddingVertical: 2,
      paddingHorizontal: 5,
      borderRadius: 3,
      fontSize: 7,
    },
    countLine: { fontSize: 8, color: "#4b5563", marginBottom: 6 },
    tableHeaderRow: {
      flexDirection: "row",
      backgroundColor: "#0b2452",
      borderBottomWidth: 1,
      borderBottomColor: "#0b2452",
    },
    row: {
      flexDirection: "row",
      borderBottomWidth: 0.5,
      borderBottomColor: "#e5e7eb",
    },
    rowAlt: { backgroundColor: "#f9fafb" },
    th: {
      fontFamily: boldFont,
      fontSize: layout.headerFontSize,
      color: "#ffffff",
      paddingVertical: 4,
      paddingHorizontal: 3,
    },
    td: { paddingVertical: 3, paddingHorizontal: 3 },
    footer: {
      position: "absolute",
      bottom: 14,
      left: 22,
      right: 22,
      flexDirection: "row",
      justifyContent: "space-between",
      borderTopWidth: 0.5,
      borderTopColor: "#e5e7eb",
      paddingTop: 4,
      fontSize: 6.5,
      color: "#6b7280",
    },
    emptyNote: { marginTop: 12, fontSize: 9, color: "#6b7280" },
  });

  const filterLine =
    filterSummary.length > 0
      ? filterSummary.map((f) => `${f.label}: ${f.value}`).join(" · ")
      : "no filters";

  return (
    <Document title={title}>
      <Page size={layout.size} orientation={layout.orientation} style={styles.page}>
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
                {school.affiliation_number ? ` · ${school.affiliation_number}` : ""}
              </Text>
            ) : null}
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
        </View>

        {filterSummary.length > 0 && (
          <View style={styles.filters}>
            {filterSummary.map((f) => (
              <Text key={`${f.label}:${f.value}`} style={styles.filterChip}>
                {f.label}: {f.value}
              </Text>
            ))}
          </View>
        )}

        <Text style={styles.countLine}>
          {rows.length} {rows.length === 1 ? "record" : "records"}
        </Text>

        {/* `fixed` repeats the header on every page — a 12-page list whose
            columns are unlabelled after page one is unusable. */}
        <View style={styles.tableHeaderRow} fixed>
          {headers.map((header, index) => (
            <Text
              key={header + index}
              style={[
                styles.th,
                {
                  width: `${widths[index]}%`,
                  textAlign: aligns[index] === "right" ? "right" : "left",
                },
              ]}
            >
              {header}
            </Text>
          ))}
        </View>

        {rows.map((row, rowIndex) => (
          <View
            key={rowIndex}
            style={rowIndex % 2 === 1 ? [styles.row, styles.rowAlt] : styles.row}
            wrap={false}
          >
            {headers.map((_, columnIndex) => (
              <Text
                key={columnIndex}
                style={[
                  styles.td,
                  {
                    width: `${widths[columnIndex]}%`,
                    textAlign: aligns[columnIndex] === "right" ? "right" : "left",
                  },
                ]}
              >
                {clampCell(row[columnIndex] ?? "", charBudgets[columnIndex])}
              </Text>
            ))}
          </View>
        ))}

        {rows.length === 0 && (
          <Text style={styles.emptyNote}>
            No records matched the filters above.
          </Text>
        )}

        {/* Provenance, on every page. This route renders rows supplied by the
            caller onto school letterhead, so the document must always say who
            produced it, when, and from what filter — otherwise it reads as an
            official record of unverifiable origin. */}
        <View style={styles.footer} fixed>
          <Text>
            Generated by {generatedBy} on {generatedOn} · {rows.length} rows ·{" "}
            {filterLine}
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
