import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 24,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: "#111827",
  },
  copy: {
    borderWidth: 1,
    borderColor: "#0b2452",
    borderStyle: "solid",
    padding: 14,
    marginBottom: 14,
    height: "46%",
  },
  copyLabel: {
    position: "absolute",
    top: 6,
    right: 12,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#0b2452",
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#0b2452",
    paddingBottom: 6,
    marginBottom: 8,
  },
  logo: { width: 42, height: 42 },
  headerText: { flex: 1, alignItems: "center" },
  schoolName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: "#0b2452",
    letterSpacing: 0.3,
  },
  schoolMeta: {
    fontSize: 8,
    color: "#374151",
    marginTop: 1,
  },
  title: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: "#0b2452",
    textAlign: "center",
    marginTop: 2,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
    fontSize: 9,
  },
  metaItem: { fontFamily: "Helvetica-Bold", color: "#0b2452" },
  gridRow: {
    flexDirection: "row",
    paddingVertical: 2,
  },
  gridLabel: {
    width: "28%",
    color: "#4b5563",
  },
  gridValue: {
    width: "72%",
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  amountBox: {
    marginTop: 6,
    padding: 6,
    backgroundColor: "#f9fafb",
    borderLeftWidth: 3,
    borderLeftColor: "#c9a227",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  amountLabel: { fontFamily: "Helvetica-Bold", color: "#0b2452" },
  amountValue: {
    fontFamily: "Helvetica-Bold",
    color: "#0b2452",
    fontSize: 12,
  },
  words: {
    fontSize: 8.5,
    fontStyle: "italic",
    color: "#374151",
    marginTop: 3,
  },
  signatures: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  signatureBlock: { width: 110, alignItems: "center" },
  signatureLine: {
    width: 100,
    borderBottomWidth: 0.7,
    borderBottomColor: "#111827",
    marginBottom: 3,
    height: 14,
  },
  signatureLabel: { fontSize: 8, color: "#1f2937", fontFamily: "Helvetica-Bold" },
  footer: {
    textAlign: "center",
    fontSize: 7.5,
    color: "#6b7280",
    marginTop: 4,
  },
  separator: {
    borderTopWidth: 0.5,
    borderTopStyle: "dashed",
    borderTopColor: "#9ca3af",
    marginVertical: 4,
  },
});

function numberToWords(n: number): string {
  if (!isFinite(n) || n < 0) return "";
  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);
  const a = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const below100 = (num: number): string => {
    if (num < 20) return a[num];
    const tens = Math.floor(num / 10);
    const ones = num % 10;
    return b[tens] + (ones ? " " + a[ones] : "");
  };
  const below1000 = (num: number): string => {
    const hundreds = Math.floor(num / 100);
    const rest = num % 100;
    return (
      (hundreds ? a[hundreds] + " Hundred" + (rest ? " " : "") : "") +
      (rest ? below100(rest) : "")
    );
  };
  const toIndianWords = (num: number): string => {
    if (num === 0) return "Zero";
    let words = "";
    const crore = Math.floor(num / 10000000);
    num = num % 10000000;
    const lakh = Math.floor(num / 100000);
    num = num % 100000;
    const thousand = Math.floor(num / 1000);
    num = num % 1000;
    if (crore) words += below100(crore) + " Crore ";
    if (lakh) words += below100(lakh) + " Lakh ";
    if (thousand) words += below100(thousand) + " Thousand ";
    if (num) words += below1000(num);
    return words.trim();
  };
  let out = "Rupees " + toIndianWords(rupees);
  if (paise > 0) {
    out += " and " + toIndianWords(paise) + " Paise";
  }
  return out + " only";
}

export interface FeeReceiptData {
  receipt_number: string;
  payment_date: string;
  fee_type: string;
  amount: number;
  payment_method: string;
  month: string | null;
  academic_year: string;
  student: {
    full_name: string;
    admission_no: string;
    father_name: string | null;
    class_label: string;
    roll_number: number | null;
  };
  remarks?: string | null;
  // Migration 044 — only populated for non-cash methods.
  cheque_number?: string | null;
  cheque_date?: string | null;
  bank_name?: string | null;
  payer_name?: string | null;
  transaction_ref?: string | null;
  payment_provider?: string | null;
}

interface Props {
  school: {
    name: string;
    addressLine: string;
    affiliation: string;
    affiliationNumber: string;
    phone?: string;
    email?: string;
  };
  data: FeeReceiptData;
  logoData?: Buffer | Uint8Array;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function Copy({
  label,
  school,
  data,
  logoData,
}: {
  label: string;
  school: Props["school"];
  data: FeeReceiptData;
  logoData?: Buffer | Uint8Array;
}) {
  const amountText = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(data.amount);

  return (
    <View style={styles.copy} wrap={false}>
      <Text style={styles.copyLabel}>{label}</Text>
      <View style={styles.header}>
        {logoData ? (
          <Image
            src={{ data: Buffer.from(logoData), format: "png" }}
            style={styles.logo}
          />
        ) : null}
        <View style={styles.headerText}>
          <Text style={styles.schoolName}>{school.name}</Text>
          <Text style={styles.schoolMeta}>{school.addressLine}</Text>
          <Text style={styles.schoolMeta}>
            Affiliated to {school.affiliation} · Affiliation No.{" "}
            {school.affiliationNumber}
          </Text>
        </View>
      </View>

      <Text style={styles.title}>Fee Receipt</Text>

      <View style={styles.metaRow}>
        <Text>
          <Text style={styles.metaItem}>Receipt No.: </Text>
          {data.receipt_number}
        </Text>
        <Text>
          <Text style={styles.metaItem}>Date: </Text>
          {formatDate(data.payment_date)}
        </Text>
      </View>

      <View style={styles.gridRow}>
        <Text style={styles.gridLabel}>Student Name</Text>
        <Text style={styles.gridValue}>{data.student.full_name}</Text>
      </View>
      <View style={styles.gridRow}>
        <Text style={styles.gridLabel}>Admission No.</Text>
        <Text style={styles.gridValue}>{data.student.admission_no}</Text>
      </View>
      <View style={styles.gridRow}>
        <Text style={styles.gridLabel}>Father&apos;s Name</Text>
        <Text style={styles.gridValue}>{data.student.father_name ?? "—"}</Text>
      </View>
      <View style={styles.gridRow}>
        <Text style={styles.gridLabel}>Class</Text>
        <Text style={styles.gridValue}>
          {data.student.class_label}
          {data.student.roll_number ? `   ·   Roll ${data.student.roll_number}` : ""}
        </Text>
      </View>
      <View style={styles.gridRow}>
        <Text style={styles.gridLabel}>Academic Year</Text>
        <Text style={styles.gridValue}>{data.academic_year}</Text>
      </View>
      <View style={styles.gridRow}>
        <Text style={styles.gridLabel}>Fee Type</Text>
        <Text style={styles.gridValue}>
          {data.fee_type}
          {data.month ? `   ·   For ${data.month}` : ""}
        </Text>
      </View>
      <View style={styles.gridRow}>
        <Text style={styles.gridLabel}>Payment Method</Text>
        <Text style={styles.gridValue}>
          {data.payment_method
            .replace("_", " ")
            .replace(/\b\w/g, (c) => c.toUpperCase())}
          {data.payment_provider ? `   ·   ${data.payment_provider}` : ""}
        </Text>
      </View>

      {/* Method-specific reconciliation lines (migration 044). Each block
          shows only fields that are populated, so cash receipts stay clean. */}
      {data.cheque_number ? (
        <View style={styles.gridRow}>
          <Text style={styles.gridLabel}>Cheque</Text>
          <Text style={styles.gridValue}>
            #{data.cheque_number}
            {data.cheque_date ? `   ·   ${formatDate(data.cheque_date)}` : ""}
            {data.bank_name ? `   ·   ${data.bank_name}` : ""}
          </Text>
        </View>
      ) : null}
      {!data.cheque_number && data.bank_name ? (
        <View style={styles.gridRow}>
          <Text style={styles.gridLabel}>Bank</Text>
          <Text style={styles.gridValue}>{data.bank_name}</Text>
        </View>
      ) : null}
      {data.payer_name ? (
        <View style={styles.gridRow}>
          <Text style={styles.gridLabel}>Payer</Text>
          <Text style={styles.gridValue}>{data.payer_name}</Text>
        </View>
      ) : null}
      {data.transaction_ref ? (
        <View style={styles.gridRow}>
          <Text style={styles.gridLabel}>Transaction Ref.</Text>
          <Text style={styles.gridValue}>{data.transaction_ref}</Text>
        </View>
      ) : null}

      <View style={styles.amountBox}>
        <Text style={styles.amountLabel}>Amount Received</Text>
        <Text style={styles.amountValue}>{amountText}</Text>
      </View>
      <Text style={styles.words}>{numberToWords(data.amount)}</Text>

      {data.remarks ? (
        <View style={styles.gridRow}>
          <Text style={styles.gridLabel}>Remarks</Text>
          <Text style={styles.gridValue}>{data.remarks}</Text>
        </View>
      ) : null}

      <View style={styles.signatures}>
        <View style={styles.signatureBlock}>
          <View style={styles.signatureLine} />
          <Text style={styles.signatureLabel}>Payer Signature</Text>
        </View>
        <View style={styles.signatureBlock}>
          <View style={styles.signatureLine} />
          <Text style={styles.signatureLabel}>Cashier / Accountant</Text>
        </View>
        <View style={styles.signatureBlock}>
          <View style={styles.signatureLine} />
          <Text style={styles.signatureLabel}>Principal / Seal</Text>
        </View>
      </View>
      <Text style={styles.footer}>
        Fees once paid are non-refundable. This is a computer-generated receipt.
      </Text>
    </View>
  );
}

export function FeeReceiptPDF({ school, data, logoData }: Props) {
  return (
    <Document
      title={`Fee Receipt — ${data.receipt_number}`}
      author={school.name}
    >
      <Page size="A4" style={styles.page}>
        <Copy label="School Copy" school={school} data={data} logoData={logoData} />
        <View style={styles.separator} />
        <Copy label="Parent Copy" school={school} data={data} logoData={logoData} />
      </Page>
    </Document>
  );
}
