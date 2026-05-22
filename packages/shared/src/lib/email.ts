import { Resend } from "resend";
import { SCHOOL } from "@nkps/shared/lib/constants";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.FROM_EMAIL || `${SCHOOL.name} <noreply@nkpsmurlipura.com>`;
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || SCHOOL.email[0];

let cachedClient: Resend | null = null;

function getClient(): Resend {
  if (cachedClient) return cachedClient;

  if (!RESEND_API_KEY) {
    throw new Error(
      "Email is not configured. Set RESEND_API_KEY in the environment."
    );
  }

  cachedClient = new Resend(RESEND_API_KEY);
  return cachedClient;
}

export async function sendEmail(to: string, subject: string, html: string) {
  const result = await getClient().emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html,
    replyTo: REPLY_TO_EMAIL,
  });

  if (result.error) {
    console.error("Resend error:", result.error);
    throw new Error(`Email send failed: ${result.error.message}`);
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("Email sent successfully:", result.data?.id);
  }
  return { data: { id: result.data?.id ?? "" }, error: null };
}

// ---------------------------------------------------------------------------
// Shared HTML wrapper with school branding
// ---------------------------------------------------------------------------

function emailWrapper(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f8f7f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f7f4;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background-color:#1a2332;padding:32px 40px;border-radius:12px 12px 0 0;text-align:center;">
              <h1 style="margin:0;font-size:24px;color:#ffffff;font-weight:700;">${SCHOOL.name}</h1>
              <p style="margin:8px 0 0;font-size:13px;color:#d4a843;letter-spacing:1px;">${SCHOOL.tagline}</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:40px;border-left:1px solid #e5e5e5;border-right:1px solid #e5e5e5;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f1f1f1;padding:24px 40px;border-radius:0 0 12px 12px;border:1px solid #e5e5e5;border-top:none;">
              <p style="margin:0;font-size:12px;color:#888;text-align:center;">
                ${SCHOOL.address.full}<br>
                ${SCHOOL.email[0]} &middot; ${SCHOOL.phone[0]}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Email Templates
// ---------------------------------------------------------------------------

interface WelcomeEmailParams {
  fullName: string;
  email: string;
  password: string;
  loginUrl: string;
  role: string;
}

export function buildWelcomeEmail({ fullName, email, password, loginUrl, role }: WelcomeEmailParams): string {
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  return emailWrapper(`
    <h2 style="margin:0 0 12px;font-size:22px;color:#1a2332;font-weight:700;">Welcome to the ${SCHOOL.shortName} Portal</h2>
    <p style="margin:0 0 20px;font-size:15px;color:#444;line-height:1.6;">
      Hello <strong>${fullName}</strong>,
    </p>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.6;">
      An account has been created for you on the <strong>${SCHOOL.name}</strong> portal as a
      <strong>${roleLabel}</strong>. Please use the temporary credentials below to sign in for the first time.
    </p>

    <!-- Credentials card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf8f3;border:1px solid #e8e4d9;border-radius:8px;margin-bottom:24px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 6px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Username (Email)</p>
          <p style="margin:0 0 18px;font-size:15px;color:#1a2332;font-weight:600;word-break:break-all;">${email}</p>
          <p style="margin:0 0 6px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Temporary Password</p>
          <p style="margin:0;font-size:16px;color:#1a2332;font-weight:700;font-family:'Courier New',monospace;letter-spacing:1px;background:#ffffff;border:1px dashed #d4a843;border-radius:6px;padding:10px 14px;display:inline-block;">${password}</p>
        </td>
      </tr>
    </table>

    <!-- Important notice -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fff8e6;border-left:4px solid #d4a843;border-radius:6px;margin-bottom:28px;">
      <tr>
        <td style="padding:14px 18px;">
          <p style="margin:0;font-size:14px;color:#8a6d1a;line-height:1.6;">
            <strong>Important:</strong> For your security, you will be required to set a new password
            the first time you log in. The temporary password above will no longer work after that.
          </p>
        </td>
      </tr>
    </table>

    <!-- Steps -->
    <h3 style="margin:0 0 12px;font-size:16px;color:#1a2332;font-weight:700;">How to get started</h3>
    <ol style="margin:0 0 28px;padding-left:20px;font-size:14px;color:#444;line-height:1.8;">
      <li>Click the <strong>Sign In to Portal</strong> button below.</li>
      <li>Enter your email and the temporary password shown above.</li>
      <li>When prompted, create a new password that only you know.</li>
      <li>You're in — explore the portal dashboard.</li>
    </ol>

    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
      <tr>
        <td style="background-color:#1a2332;border-radius:8px;">
          <a href="${loginUrl}" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
            Sign In to Portal
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 24px;font-size:13px;color:#888;text-align:center;">
      Button not working? Copy and paste this link into your browser:<br>
      <a href="${loginUrl}" style="color:#d4a843;word-break:break-all;">${loginUrl}</a>
    </p>

    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">

    <p style="margin:0;font-size:13px;color:#888;line-height:1.6;">
      If you weren't expecting this email or believe it was sent to you by mistake, please contact us at
      <a href="mailto:${SCHOOL.email[0]}" style="color:#d4a843;">${SCHOOL.email[0]}</a>
      and do not share the credentials above with anyone.
    </p>
  `);
}

// ---------------------------------------------------------------------------
// Password Reset Email (sent from our own /api/auth/forgot-password route)
// ---------------------------------------------------------------------------

interface PasswordResetEmailParams {
  fullName?: string;
  email: string;
  resetLink: string;
  expiresInMinutes?: number;
}

export function buildPasswordResetEmail({
  fullName,
  email,
  resetLink,
  expiresInMinutes = 60,
}: PasswordResetEmailParams): string {
  const greetingName = fullName && fullName.trim().length > 0 ? fullName : "there";
  return emailWrapper(`
    <h2 style="margin:0 0 12px;font-size:22px;color:#1a2332;font-weight:700;">Reset your ${SCHOOL.shortName} portal password</h2>
    <p style="margin:0 0 20px;font-size:15px;color:#444;line-height:1.6;">
      Hello <strong>${greetingName}</strong>,
    </p>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.6;">
      We received a request to reset the password for the ${SCHOOL.name} portal account associated with
      <strong>${email}</strong>. Click the button below to choose a new password.
    </p>

    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
      <tr>
        <td style="background-color:#1a2332;border-radius:8px;">
          <a href="${resetLink}" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
            Reset Password
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 28px;font-size:13px;color:#888;text-align:center;">
      Button not working? Copy and paste this link into your browser:<br>
      <a href="${resetLink}" style="color:#d4a843;word-break:break-all;">${resetLink}</a>
    </p>

    <!-- Steps -->
    <h3 style="margin:0 0 12px;font-size:16px;color:#1a2332;font-weight:700;">What to do next</h3>
    <ol style="margin:0 0 24px;padding-left:20px;font-size:14px;color:#444;line-height:1.8;">
      <li>Click the <strong>Reset Password</strong> button above.</li>
      <li>You'll be taken to a secure page on the ${SCHOOL.shortName} portal.</li>
      <li>Enter a new password and confirm it.</li>
      <li>Sign in with your email and your new password.</li>
    </ol>

    <!-- Expiry notice -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fff8e6;border-left:4px solid #d4a843;border-radius:6px;margin-bottom:28px;">
      <tr>
        <td style="padding:14px 18px;">
          <p style="margin:0;font-size:14px;color:#8a6d1a;line-height:1.6;">
            <strong>Heads up:</strong> This link will expire in about <strong>${expiresInMinutes} minutes</strong>
            and can only be used once. If it expires, just request a new link from the sign-in page.
          </p>
        </td>
      </tr>
    </table>

    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">

    <p style="margin:0;font-size:13px;color:#888;line-height:1.6;">
      <strong>Didn't request this?</strong> You can safely ignore this email — your password won't change
      unless you click the button above. If you're worried about the security of your account, please contact
      us at <a href="mailto:${SCHOOL.email[0]}" style="color:#d4a843;">${SCHOOL.email[0]}</a>.
    </p>
  `);
}

interface RegistrationReceivedParams {
  fullName: string;
  role: string;
}

export function buildRegistrationReceivedEmail({ fullName, role }: RegistrationReceivedParams): string {
  return emailWrapper(`
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a2332;">Registration Received</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.6;">
      Hello <strong>${fullName}</strong>,<br>
      Thank you for registering as a <strong>${role}</strong> on the ${SCHOOL.name} portal.
    </p>
    <div style="background-color:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#0369a1;line-height:1.6;">
        Your registration is now <strong>pending review</strong> by the school administration.
        You will receive another email once your account has been approved.
      </p>
    </div>
    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      If you have any questions, please contact us at
      <a href="mailto:${SCHOOL.email[0]}" style="color:#d4a843;">${SCHOOL.email[0]}</a>
      or call <strong>${SCHOOL.phone[0]}</strong>.
    </p>
  `);
}

interface RegistrationRejectedParams {
  fullName: string;
  reason?: string;
}

export function buildRegistrationRejectedEmail({ fullName, reason }: RegistrationRejectedParams): string {
  const reasonBlock = reason
    ? `<div style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:13px;color:#888;">Reason</p>
        <p style="margin:0;font-size:14px;color:#991b1b;line-height:1.5;">${reason}</p>
      </div>`
    : "";

  return emailWrapper(`
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a2332;">Registration Update</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.6;">
      Hello <strong>${fullName}</strong>,<br>
      We regret to inform you that your registration request for the ${SCHOOL.name} portal was not approved at this time.
    </p>
    ${reasonBlock}
    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      If you believe this was a mistake or have questions, please contact us at
      <a href="mailto:${SCHOOL.email[0]}" style="color:#d4a843;">${SCHOOL.email[0]}</a>
      or call <strong>${SCHOOL.phone[0]}</strong>.
    </p>
  `);
}

// ---------------------------------------------------------------------------
// Contact Form Notification (sent to admin)
// ---------------------------------------------------------------------------

interface ContactNotificationParams {
  fullName: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

export function buildContactNotificationEmail({
  fullName,
  email,
  phone,
  subject,
  message,
}: ContactNotificationParams): string {
  return emailWrapper(`
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a2332;">New Contact Form Submission</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#888;width:80px;vertical-align:top;">Name</td>
        <td style="padding:8px 0;font-size:15px;color:#1a2332;font-weight:600;">${fullName}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#888;vertical-align:top;">Email</td>
        <td style="padding:8px 0;font-size:15px;color:#1a2332;">
          <a href="mailto:${email}" style="color:#d4a843;">${email}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#888;vertical-align:top;">Phone</td>
        <td style="padding:8px 0;font-size:15px;color:#1a2332;">${phone}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#888;vertical-align:top;">Subject</td>
        <td style="padding:8px 0;font-size:15px;color:#1a2332;font-weight:600;">${subject}</td>
      </tr>
    </table>
    <div style="background-color:#faf8f3;border:1px solid #e8e4d9;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:13px;color:#888;">Message</p>
      <p style="margin:0;font-size:14px;color:#1a2332;line-height:1.6;white-space:pre-wrap;">${message}</p>
    </div>
    <p style="margin:0;font-size:13px;color:#888;">
      This submission has been saved to the admin dashboard. You can view and manage all messages from the Contact section.
    </p>
  `);
}
