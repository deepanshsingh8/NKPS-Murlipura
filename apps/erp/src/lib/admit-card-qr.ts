import QRCode from "qrcode";

// Returns a PNG-encoded QR for the given admit-card payload, or null on
// failure (we fail soft so a QR rendering hiccup never blocks the PDF).
//
// The encoded payload is a JSON object with the minimal verification fields
// — `student_id`, `admission_no`, `exam_type_id`, `exam_name`. Scanning it
// from a printed admit card lets exam-hall staff cross-check the bearer
// without needing online lookup, while still being a stable shape we can
// extend later.
export async function generateAdmitCardQrBuffer(payload: {
  student_id: string;
  admission_no: string;
  exam_type_id: string;
  exam_name: string;
}): Promise<Buffer | null> {
  try {
    const json = JSON.stringify({
      v: 1,
      student_id: payload.student_id,
      admission_no: payload.admission_no,
      exam_type_id: payload.exam_type_id,
      exam_name: payload.exam_name,
    });
    return await QRCode.toBuffer(json, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
    });
  } catch (err) {
    console.error("[admit-card] QR generation:", err);
    return null;
  }
}
