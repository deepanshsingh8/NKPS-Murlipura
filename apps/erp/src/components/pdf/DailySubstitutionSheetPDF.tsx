import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

export interface DailySubstitutionSchoolHeader {
  name: string;
  address_line: string;
}

export interface DailySubstitutionRow {
  start_time: string;
  end_time: string;
  period_number: number;
  class_label: string;
  subject_name: string;
  room: string | null;
  absent_teacher_name: string;
  substitute_teacher_name: string | null;
  half_day: "full" | "first_half" | "second_half";
  note: string | null;
}

export interface DailySubstitutionSheetPDFProps {
  school: DailySubstitutionSchoolHeader;
  date: string; // ISO YYYY-MM-DD
  weekday_label: string; // e.g. "Tuesday"
  rows: DailySubstitutionRow[];
  unassigned: DailySubstitutionRow[];
  generated_on: string;
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
    marginBottom: 12,
  },
  schoolName: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#0b2452",
  },
  schoolMeta: {
    fontSize: 9,
    color: "#374151",
    marginTop: 2,
  },
  title: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginTop: 8,
    color: "#0b2452",
  },
  dateLine: {
    fontSize: 10,
    color: "#374151",
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 14,
    marginBottom: 6,
    color: "#0b2452",
  },
  table: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 2,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  trHead: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottomWidth: 1,
    borderBottomColor: "#d1d5db",
  },
  th: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    paddingVertical: 5,
    paddingHorizontal: 6,
    color: "#1f2937",
  },
  td: {
    fontSize: 9,
    paddingVertical: 5,
    paddingHorizontal: 6,
    color: "#1f2937",
  },
  c_time: { width: "14%" },
  c_period: { width: "8%" },
  c_class: { width: "12%" },
  c_subject: { width: "18%" },
  c_room: { width: "10%" },
  c_absent: { width: "18%" },
  c_sub: { width: "20%" },
  empty: {
    fontSize: 9,
    color: "#6b7280",
    fontStyle: "italic",
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  footer: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 16,
    fontSize: 8,
    color: "#6b7280",
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 6,
  },
});

function formatTime(t: string): string {
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function halfDayLabel(h: string): string {
  if (h === "first_half") return " (1st half)";
  if (h === "second_half") return " (2nd half)";
  return "";
}

function Row({ row }: { row: DailySubstitutionRow }) {
  return (
    <View style={styles.tr} wrap={false}>
      <Text style={[styles.td, styles.c_time]}>
        {formatTime(row.start_time)}–{formatTime(row.end_time)}
      </Text>
      <Text style={[styles.td, styles.c_period]}>P{row.period_number}</Text>
      <Text style={[styles.td, styles.c_class]}>{row.class_label}</Text>
      <Text style={[styles.td, styles.c_subject]}>{row.subject_name}</Text>
      <Text style={[styles.td, styles.c_room]}>{row.room ?? "—"}</Text>
      <Text style={[styles.td, styles.c_absent]}>
        {row.absent_teacher_name}
        {halfDayLabel(row.half_day)}
      </Text>
      <Text style={[styles.td, styles.c_sub]}>
        {row.substitute_teacher_name ?? "—"}
      </Text>
    </View>
  );
}

function HeaderRow() {
  return (
    <View style={styles.trHead} fixed>
      <Text style={[styles.th, styles.c_time]}>Time</Text>
      <Text style={[styles.th, styles.c_period]}>Period</Text>
      <Text style={[styles.th, styles.c_class]}>Class</Text>
      <Text style={[styles.th, styles.c_subject]}>Subject</Text>
      <Text style={[styles.th, styles.c_room]}>Room</Text>
      <Text style={[styles.th, styles.c_absent]}>Absent</Text>
      <Text style={[styles.th, styles.c_sub]}>Substitute</Text>
    </View>
  );
}

export function DailySubstitutionSheetPDF({
  school,
  date,
  weekday_label,
  rows,
  unassigned,
  generated_on,
}: DailySubstitutionSheetPDFProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page} orientation="landscape">
        <View style={styles.header} fixed>
          <Text style={styles.schoolName}>{school.name}</Text>
          <Text style={styles.schoolMeta}>{school.address_line}</Text>
          <Text style={styles.title}>Daily Substitution Sheet</Text>
          <Text style={styles.dateLine}>
            {weekday_label}, {date}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Assigned substitutes</Text>
        <View style={styles.table}>
          <HeaderRow />
          {rows.length === 0 ? (
            <Text style={styles.empty}>No substitutes assigned for today.</Text>
          ) : (
            rows.map((r, i) => <Row key={`a-${i}`} row={r} />)
          )}
        </View>

        {unassigned.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              Unassigned periods (need attention)
            </Text>
            <View style={styles.table}>
              <HeaderRow />
              {unassigned.map((r, i) => (
                <Row key={`u-${i}`} row={r} />
              ))}
            </View>
          </>
        )}

        <View style={styles.footer} fixed>
          <Text>Generated {generated_on}</Text>
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
