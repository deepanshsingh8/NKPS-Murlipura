import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

/**
 * A week's timetable as a printable grid — the thing that gets pinned to a
 * staffroom noticeboard. Serves both the class view and the teacher view,
 * because they are the same grid with a different second line in each cell:
 * a class sheet names the teacher, a teacher sheet names the class.
 *
 * A cell holds every parallel group (migration 119), one line each. That is
 * the point of printing it at all now — a Games period run as basketball,
 * badminton and cricket has three coaches, and a sheet showing one of them is
 * worse than no sheet.
 */

const DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

export interface TimetableGridGroup {
  /** Ordering within the cell; 0 is the primary group. */
  group_no: number;
  /** "Basketball", "IP" — omitted when the subject says it all. */
  group_label: string | null;
  subject_name: string | null;
  /** The teacher on a class sheet, the class on a teacher sheet. */
  counterpart: string | null;
  room: string | null;
  is_break: boolean;
}

export interface TimetableGridCell {
  day_of_week: number;
  period_number: number;
  groups: TimetableGridGroup[];
}

export interface TimetableGridPeriodRow {
  period_number: number;
  start_time: string;
  end_time: string;
}

export interface TimetableGridPDFProps {
  school: { name: string; address_line: string };
  /** "Class Timetable" / "Teacher Timetable". */
  title: string;
  /** "VI-A" or "Mrs Anita Rao". */
  subtitle: string;
  /** The academic year, when one is known. */
  caption?: string | null;
  periods: TimetableGridPeriodRow[];
  cells: TimetableGridCell[];
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
  schoolMeta: { fontSize: 9, color: "#374151", marginTop: 2 },
  title: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginTop: 8,
    color: "#0b2452",
  },
  subtitleLine: { fontSize: 10, color: "#374151", marginTop: 2 },
  table: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 2 },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  trLast: { flexDirection: "row" },
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
    paddingHorizontal: 5,
    color: "#1f2937",
    borderRightWidth: 1,
    borderRightColor: "#d1d5db",
  },
  cell: {
    paddingVertical: 4,
    paddingHorizontal: 5,
    borderRightWidth: 1,
    borderRightColor: "#e5e7eb",
    justifyContent: "flex-start",
  },
  cellLast: {
    paddingVertical: 4,
    paddingHorizontal: 5,
    justifyContent: "flex-start",
  },
  // Six days plus a period column that carries the bell times.
  c_period: { width: "13%" },
  c_day: { width: "14.5%" },
  periodNum: { fontFamily: "Helvetica-Bold", fontSize: 9, color: "#1f2937" },
  periodTime: { fontSize: 7.5, color: "#6b7280", marginTop: 1 },
  subject: { fontSize: 8.5, color: "#111827", fontFamily: "Helvetica-Bold" },
  counterpart: { fontSize: 8, color: "#374151", marginTop: 0.5 },
  room: { fontSize: 7.5, color: "#6b7280", marginTop: 0.5 },
  breakText: {
    fontSize: 8.5,
    color: "#92400e",
    fontFamily: "Helvetica-Bold",
  },
  free: { fontSize: 8, color: "#9ca3af", fontStyle: "italic" },
  groupGap: { marginTop: 4 },
  empty: {
    fontSize: 9,
    color: "#6b7280",
    fontStyle: "italic",
    paddingVertical: 10,
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
  return t && t.length >= 5 ? t.slice(0, 5) : t;
}

function GroupLines({ g, first }: { g: TimetableGridGroup; first: boolean }) {
  if (g.is_break) {
    return (
      <View style={first ? undefined : styles.groupGap}>
        <Text style={styles.breakText}>Break</Text>
      </View>
    );
  }
  // The label leads when there is one: on a Games row "Basketball" is what
  // tells the three lines apart, not the subject, which is the same on all of
  // them.
  const heading = g.group_label
    ? g.subject_name
      ? `${g.group_label} · ${g.subject_name}`
      : g.group_label
    : g.subject_name ?? "—";
  return (
    <View style={first ? undefined : styles.groupGap}>
      <Text style={styles.subject}>{heading}</Text>
      {g.counterpart ? (
        <Text style={styles.counterpart}>{g.counterpart}</Text>
      ) : null}
      {g.room ? <Text style={styles.room}>{g.room}</Text> : null}
    </View>
  );
}

export function TimetableGridPDF({
  school,
  title,
  subtitle,
  caption,
  periods,
  cells,
  generated_on,
}: TimetableGridPDFProps) {
  const byCell = new Map<string, TimetableGridGroup[]>();
  for (const c of cells) {
    byCell.set(
      `${c.day_of_week}|${c.period_number}`,
      [...c.groups].sort((a, b) => a.group_no - b.group_no)
    );
  }

  return (
    <Document>
      <Page size="A4" style={styles.page} orientation="landscape">
        <View style={styles.header} fixed>
          <Text style={styles.schoolName}>{school.name}</Text>
          <Text style={styles.schoolMeta}>{school.address_line}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitleLine}>
            {subtitle}
            {caption ? ` · ${caption}` : ""}
          </Text>
        </View>

        {periods.length === 0 ? (
          <View style={styles.table}>
            <Text style={styles.empty}>
              No periods have been scheduled yet.
            </Text>
          </View>
        ) : (
          <View style={styles.table}>
            <View style={styles.trHead} fixed>
              <Text style={[styles.th, styles.c_period]}>Period</Text>
              {DAYS.map((d, i) => (
                <Text
                  key={d.value}
                  style={[
                    styles.th,
                    styles.c_day,
                    i === DAYS.length - 1
                      ? { borderRightWidth: 0 }
                      : {},
                  ]}
                >
                  {d.label}
                </Text>
              ))}
            </View>

            {periods.map((p, rowIndex) => (
              <View
                key={p.period_number}
                style={
                  rowIndex === periods.length - 1 ? styles.trLast : styles.tr
                }
                wrap={false}
              >
                <View style={[styles.cell, styles.c_period]}>
                  <Text style={styles.periodNum}>
                    {p.period_number === 0 ? "Zero" : `P${p.period_number}`}
                  </Text>
                  <Text style={styles.periodTime}>
                    {formatTime(p.start_time)}–{formatTime(p.end_time)}
                  </Text>
                </View>
                {DAYS.map((d, i) => {
                  const groups =
                    byCell.get(`${d.value}|${p.period_number}`) ?? [];
                  const cellStyle =
                    i === DAYS.length - 1 ? styles.cellLast : styles.cell;
                  return (
                    <View key={d.value} style={[cellStyle, styles.c_day]}>
                      {groups.length === 0 ? (
                        <Text style={styles.free}>—</Text>
                      ) : (
                        groups.map((g, gi) => (
                          <GroupLines
                            key={`${g.group_no}-${gi}`}
                            g={g}
                            first={gi === 0}
                          />
                        ))
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
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
