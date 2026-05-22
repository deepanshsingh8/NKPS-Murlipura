import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

// ---------------------------------------------------------------------------
// Public types (exported so API routes can build the props payload).
// ---------------------------------------------------------------------------

export interface AdmitCardStudent {
  id: string;
  full_name: string;
  father_name: string | null;
  mother_name: string | null;
  date_of_birth: string | null;
  phone: string | null;
  address: string | null;
  admission_no: string;
  roll_number: number | null;
  class_name: string;
  section: string;
}

export interface AdmitCardScheduleRow {
  subject_name: string;
  subject_code: string | null;
  exam_date: string; // ISO date
  start_time: string | null;
  end_time: string | null;
  room: string | null;
}

export interface AdmitCardTemplateConfig {
  name: string;
  orientation: "portrait" | "landscape";
  show_photo: boolean;
  show_admission_no: boolean;
  show_roll_no: boolean;
  show_class_section: boolean;
  show_father_name: boolean;
  show_mother_name: boolean;
  show_dob: boolean;
  show_phone: boolean;
  show_address: boolean;
  show_schedule: boolean;
  show_instructions: boolean;
  instructions_text: string | null;
  signature_labels: string[];
}

export interface AdmitCardSchoolHeader {
  name: string;
  address_line: string;
  affiliation: string | null;
  affiliation_number: string | null;
}

export interface AdmitCardFooterConfig {
  disclaimer_text: string | null;
  show_signatures: boolean;
  signature_labels: string[];
}

export interface AdmitCardExamInfo {
  name: string;
  upper_header: string | null;
}

export interface AdmitCardPayload {
  student: AdmitCardStudent;
  exam: AdmitCardExamInfo;
  schedule: AdmitCardScheduleRow[];
  studentPhoto?: Buffer | Uint8Array;
  /**
   * Pre-rendered PNG bytes for the QR code embedded on the admit card.
   * When omitted, the corresponding slot is skipped — the rest of the card
   * still renders normally.
   */
  qrCode?: Buffer | Uint8Array;
}

export interface AdmitCardPDFProps {
  school: AdmitCardSchoolHeader;
  template: AdmitCardTemplateConfig;
  footer: AdmitCardFooterConfig;
  logoData?: Buffer | Uint8Array;
  generatedOn: string;
  cards: AdmitCardPayload[];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#111827",
  },
  pageLandscape: {
    padding: 24,
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
  upperBanner: {
    marginTop: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: "#b7791f",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: "#0b2452",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  bodyRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
  },
  detailsGrid: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 4,
    padding: 8,
  },
  detailRow: {
    flexDirection: "row",
    marginVertical: 2,
  },
  detailLabel: {
    width: 90,
    fontFamily: "Helvetica-Bold",
    color: "#4b5563",
    fontSize: 9,
  },
  detailValue: {
    flex: 1,
    fontSize: 9,
    color: "#111827",
  },
  photoFrame: {
    width: 84,
    height: 104,
    borderWidth: 1,
    borderColor: "#9ca3af",
    borderStyle: "solid",
    alignItems: "center",
    justifyContent: "center",
  },
  photoImage: {
    width: 82,
    height: 102,
    // §1: contain (not cover) so A4-shaped portraits aren't clipped top/bottom.
    // The frame is 4:5; cropper enforces 4:5 on upload, so square/letterboxing
    // only appears for legacy uploads that didn't go through the cropper.
    objectFit: "contain",
  },
  photoPlaceholder: {
    fontSize: 8,
    color: "#9ca3af",
    textAlign: "center",
  },
  qrColumn: {
    alignItems: "center",
    marginLeft: 8,
  },
  qrImage: {
    width: 70,
    height: 70,
  },
  qrCaption: {
    fontSize: 7,
    color: "#6b7280",
    marginTop: 2,
    textAlign: "center",
  },
  sectionHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: "#0b2452",
    marginTop: 6,
    marginBottom: 4,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  scheduleTable: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 4,
    overflow: "hidden",
  },
  scheduleHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#d1d5db",
  },
  scheduleHeaderCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#374151",
  },
  scheduleRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  scheduleCell: {
    fontSize: 9,
    color: "#111827",
  },
  scheduleEmpty: {
    padding: 10,
    textAlign: "center",
    fontSize: 9,
    color: "#9ca3af",
  },
  instructions: {
    marginTop: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 4,
    backgroundColor: "#fafaf9",
  },
  instructionLine: {
    fontSize: 9,
    color: "#374151",
    marginBottom: 2,
    lineHeight: 1.3,
  },
  footer: {
    marginTop: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 8,
  },
  footerMeta: {
    fontSize: 8,
    color: "#6b7280",
  },
  signatureBlock: {
    alignItems: "center",
    width: 110,
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
    width: "100%",
    height: 22,
  },
  signatureLabel: {
    fontSize: 8,
    color: "#4b5563",
    marginTop: 2,
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtTimeRange(
  start: string | null,
  end: string | null
): string {
  if (!start && !end) return "—";
  const s = start ? start.slice(0, 5) : "";
  const e = end ? end.slice(0, 5) : "";
  if (s && e) return `${s} – ${e}`;
  return s || e;
}

// ---------------------------------------------------------------------------
// Single-card renderer — reused by both single and bulk flows.
// ---------------------------------------------------------------------------

function SingleAdmitCard({
  card,
  school,
  template,
  footer,
  logoData,
  generatedOn,
}: {
  card: AdmitCardPayload;
  school: AdmitCardSchoolHeader;
  template: AdmitCardTemplateConfig;
  footer: AdmitCardFooterConfig;
  logoData?: Buffer | Uint8Array;
  generatedOn: string;
}) {
  const { student, exam, schedule, studentPhoto, qrCode } = card;

  const affiliationLine =
    school.affiliation && school.affiliation_number
      ? `Affiliated to ${school.affiliation} · Affiliation No. ${school.affiliation_number}`
      : school.affiliation
      ? `Affiliated to ${school.affiliation}`
      : null;

  const classLabel = `${student.class_name}${
    student.section ? ` — ${student.section}` : ""
  }`;

  const detailRows: { label: string; value: string }[] = [
    { label: "Name", value: student.full_name },
  ];
  if (template.show_admission_no) {
    detailRows.push({ label: "Admission No.", value: student.admission_no });
  }
  if (template.show_class_section) {
    detailRows.push({ label: "Class", value: classLabel });
  }
  if (template.show_roll_no) {
    detailRows.push({
      label: "Roll No.",
      value: student.roll_number !== null ? String(student.roll_number) : "—",
    });
  }
  if (template.show_father_name) {
    detailRows.push({
      label: "Father's Name",
      value: student.father_name ?? "—",
    });
  }
  if (template.show_mother_name) {
    detailRows.push({
      label: "Mother's Name",
      value: student.mother_name ?? "—",
    });
  }
  if (template.show_dob) {
    detailRows.push({
      label: "Date of Birth",
      value: student.date_of_birth ? fmtDate(student.date_of_birth) : "—",
    });
  }
  if (template.show_phone) {
    detailRows.push({ label: "Phone", value: student.phone ?? "—" });
  }
  if (template.show_address) {
    detailRows.push({ label: "Address", value: student.address ?? "—" });
  }

  const instructionLines =
    template.show_instructions && template.instructions_text
      ? template.instructions_text.split(/\r?\n/).filter((l) => l.trim())
      : [];

  const pageStyle =
    template.orientation === "landscape" ? styles.pageLandscape : styles.page;

  return (
    <Page
      size="A4"
      orientation={template.orientation === "landscape" ? "landscape" : "portrait"}
      style={pageStyle}
    >
      {/* Header */}
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
          {affiliationLine ? (
            <Text style={styles.schoolMeta}>{affiliationLine}</Text>
          ) : null}
          {exam.upper_header ? (
            <Text style={styles.upperBanner}>{exam.upper_header}</Text>
          ) : null}
          <Text style={styles.title}>Admit Card · {exam.name}</Text>
        </View>
        {logoData ? <View style={styles.logo} /> : null}
      </View>

      {/* Student details + photo */}
      <View style={styles.bodyRow}>
        <View style={styles.detailsGrid}>
          {detailRows.map((row, i) => (
            <View key={i} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{row.label}</Text>
              <Text style={styles.detailValue}>{row.value}</Text>
            </View>
          ))}
        </View>
        {template.show_photo ? (
          <View style={styles.photoFrame}>
            {studentPhoto ? (
              <Image
                src={{ data: Buffer.from(studentPhoto), format: "png" }}
                style={styles.photoImage}
              />
            ) : (
              <Text style={styles.photoPlaceholder}>No{"\n"}photo</Text>
            )}
          </View>
        ) : null}
        {qrCode ? (
          <View style={styles.qrColumn}>
            <Image
              src={{ data: Buffer.from(qrCode), format: "png" }}
              style={styles.qrImage}
            />
            <Text style={styles.qrCaption}>Scan to verify</Text>
          </View>
        ) : null}
      </View>

      {/* Schedule */}
      {template.show_schedule ? (
        <View>
          <Text style={styles.sectionHeading}>Examination Schedule</Text>
          <View style={styles.scheduleTable}>
            <View style={styles.scheduleHeaderRow}>
              <Text style={[styles.scheduleHeaderCell, { flex: 2 }]}>Subject</Text>
              <Text style={[styles.scheduleHeaderCell, { width: 80 }]}>Date</Text>
              <Text style={[styles.scheduleHeaderCell, { width: 90 }]}>Time</Text>
              <Text style={[styles.scheduleHeaderCell, { width: 60 }]}>Room</Text>
            </View>
            {schedule.length === 0 ? (
              <Text style={styles.scheduleEmpty}>
                No schedule published for this exam yet.
              </Text>
            ) : (
              schedule.map((row, i) => (
                <View key={i} style={styles.scheduleRow}>
                  <Text style={[styles.scheduleCell, { flex: 2 }]}>
                    {row.subject_name}
                    {row.subject_code ? ` (${row.subject_code})` : ""}
                  </Text>
                  <Text style={[styles.scheduleCell, { width: 80 }]}>
                    {fmtDate(row.exam_date)}
                  </Text>
                  <Text style={[styles.scheduleCell, { width: 90 }]}>
                    {fmtTimeRange(row.start_time, row.end_time)}
                  </Text>
                  <Text style={[styles.scheduleCell, { width: 60 }]}>
                    {row.room ?? "—"}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>
      ) : null}

      {/* Instructions */}
      {instructionLines.length > 0 ? (
        <View style={styles.instructions}>
          <Text style={[styles.sectionHeading, { marginTop: 0 }]}>
            Instructions
          </Text>
          {instructionLines.map((line, i) => (
            <Text key={i} style={styles.instructionLine}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      {/* Footer */}
      <View style={styles.footer}>
        <View>
          <Text style={styles.footerMeta}>Generated on {generatedOn}</Text>
          {footer.disclaimer_text ? (
            <Text style={[styles.footerMeta, { marginTop: 2 }]}>
              {footer.disclaimer_text}
            </Text>
          ) : null}
        </View>
        {footer.show_signatures
          ? footer.signature_labels.map((label, idx) => (
              <View key={idx} style={styles.signatureBlock}>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureLabel}>{label}</Text>
              </View>
            ))
          : template.signature_labels.map((label, idx) => (
              <View key={idx} style={styles.signatureBlock}>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureLabel}>{label}</Text>
              </View>
            ))}
      </View>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Document — one or many pages.
// ---------------------------------------------------------------------------

export function AdmitCardPDF({
  school,
  template,
  footer,
  logoData,
  generatedOn,
  cards,
}: AdmitCardPDFProps) {
  const title =
    cards.length === 1
      ? `Admit Card — ${cards[0].student.full_name} — ${cards[0].exam.name}`
      : `Admit Cards — ${cards.length} students`;

  return (
    <Document title={title} author={school.name}>
      {cards.map((card, i) => (
        <SingleAdmitCard
          key={`${card.student.id}-${i}`}
          card={card}
          school={school}
          template={template}
          footer={footer}
          logoData={logoData}
          generatedOn={generatedOn}
        />
      ))}
    </Document>
  );
}
