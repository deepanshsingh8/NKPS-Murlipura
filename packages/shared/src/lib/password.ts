import { randomBytes } from "crypto";

const CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&";

export function generateSecurePassword(length = 12): string {
  const bytes = randomBytes(length);
  let password = "NKPS@";
  for (let i = 0; i < length; i++) {
    password += CHARSET[bytes[i] % CHARSET.length];
  }
  return password;
}

export function generateReceiptNumber(): string {
  const year = new Date().getFullYear();
  const bytes = randomBytes(3);
  const digits = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) % 900000 + 100000;
  return `NKPS-${year}-${digits}`;
}
