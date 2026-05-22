# Domain & Email Infrastructure — Handover Notes

Tracking document for the `nkpublicschool.com` domain handover, DNS migration, and Resend email setup. Last updated 2026-04-22.

---

## 1. Current State (as of 2026-04-22)

### The stack

| Layer | Provider | Notes |
|---|---|---|
| **Registrar (official)** | PDR Ltd. / PublicDomainRegistry.com | IANA ID 303. Domain registered 2010-06-10. |
| **Registrar reseller** | **Wolkgeist Infotech Pvt Ltd** | Holds the PDR account. Confirmed contact: `wolkgeist05@yahoo.com`. |
| **DNS (nameservers)** | **Tradelit** | `ns1.tradelit.in` / `ns2.tradelit.in`. Separate company from Wolkgeist. |
| **Web host (old site)** | GoDaddy Singapore | IP `148.66.142.105`. Old CMS — will be replaced by the new Next.js site on Vercel. |
| **Email (old, if any)** | Unknown (cPanel?) | MX record points to `mail.nkpublicschool.com`. Need to confirm whether any mailboxes are live before making DNS changes. |
| **Email (new, transactional)** | **Resend** | Wired up in `src/lib/email.ts`. Needs domain verification — see §4. |

### Key facts

- **Domain expires: 2026-06-10** — roughly 7 weeks from today. Renewal must happen before this date or the domain lapses.
- **Transfer lock:** `clientTransferProhibited` is currently set. Wolkgeist would need to unlock and share the EPP/auth code before we could move the domain to a new registrar.
- **Registrant on WHOIS:** "nk public school" at the correct Jaipur address. Legal ownership sits with the school — good.
- **But:** admin / registrant / tech phone is the placeholder `+91.9999999999`. Registrant email is hidden by GDPR redaction, but is almost certainly `wolkgeist05@yahoo.com`. Needs to be updated to an official school email + real phone.

### The two vendors (now confirmed separate)

- **Wolkgeist Infotech** — controls the PDR registrar account. Contact them for: registrar login, renewal, contact detail updates, transfer unlock.
- **Tradelit** — controls DNS. Contact them for: adding/editing DNS records (MX, TXT, A, CNAME) while nameservers remain at Tradelit.

---

## 2. In Flight

- [x] Email sent to Wolkgeist (`wolkgeist05@yahoo.com`) requesting registrar account handover, contact detail updates, renewal clarity, and confirmation on the transfer lock. **Waiting for their response.**

---

## 3. Outstanding Action Items

### Immediate (this week)

- [ ] **Wolkgeist:** follow up if no reply within 5–7 days of the initial email. If still silent after 2 weeks, escalate directly to PDR support (`support@publicdomainregistry.com`) with proof of school ownership (letterhead, authorised rep ID, address proof).
- [ ] **Tradelit:** once Wolkgeist dialogue is underway, separately email Tradelit to:
  - (a) Add the Resend DNS records (§4).
  - (b) Request a full **DNS zone export** (plain-text list of every current record) as a backup. Needed before any future nameserver migration.
- [ ] **Confirm existing email usage.** Check with the school whether any `@nkpublicschool.com` mailboxes are currently in use via `mail.nkpublicschool.com`. If yes, do NOT remove/replace the existing MX record — Resend only needs an MX on the `send.` subdomain, not the root.

### Short-term (next 2–3 weeks)

- [ ] Get PDR/Wolkgeist account credentials transferred to the school. Target login email: `nkps.rajawas@gmail.com`.
- [ ] Update WHOIS registrant / admin / tech contact details:
  - Phone: `+91-9785500046`
  - Email: `nkps.rajawas@gmail.com`
- [ ] **Renew the domain** before 2026-06-10. Either via Wolkgeist invoice, or directly once we have account access.

### Medium-term (1–2 months)

- [ ] Migrate nameservers from Tradelit to **Cloudflare** (free tier) so the school controls its own DNS. See §5 for the plan.
- [ ] Retire Tradelit as DNS provider once Cloudflare is confirmed fully working.
- [ ] Point `nkpublicschool.com` at the new Vercel deployment when the new site is ready to launch (separate A/CNAME change — easier post-Cloudflare migration).

---

## 4. Resend Email Setup — DNS Records Needed

The new portal (`src/lib/email.ts`) sends welcome emails and password reset emails via Resend. For real delivery to external users, we need to verify `nkpublicschool.com` in Resend by adding DNS records.

### What needs to be added (values come from the Resend Domains page)

| # | Type | Host | Value | Priority | TTL |
|---|---|---|---|---|---|
| 1 | MX | `send.nkpublicschool.com` | `feedback-smtp.<region>.amazonses.com` | 10 | 3600 |
| 2 | TXT | `send.nkpublicschool.com` | `"v=spf1 include:amazonses.com ~all"` | — | 3600 |
| 3 | TXT | `resend._domainkey.nkpublicschool.com` | [long DKIM public key from Resend] | — | 3600 |
| 4 (optional but recommended) | TXT | `_dmarc.nkpublicschool.com` | `"v=DMARC1; p=none;"` | — | 3600 |

These records apply to the `send.` subdomain only — **the existing root-domain MX record (`mail.nkpublicschool.com`) is not touched.**

### Env vars to set (local `.env.local` and Vercel → Settings → Environment Variables)

```
RESEND_API_KEY=re_xxxxxxx
FROM_EMAIL=NK Public School <noreply@nkpublicschool.com>
REPLY_TO_EMAIL=nkps.rajawas@gmail.com
```

After setting, redeploy on Vercel (env changes don't apply to existing deployments).

### Verification checklist

- [ ] DNS records added at Tradelit.
- [ ] Resend Domains page shows **Verified** (all three records green).
- [ ] `FROM_EMAIL` and `REPLY_TO_EMAIL` set in Vercel Production + Preview.
- [ ] Redeploy triggered.
- [ ] Test: create a user at `/admin/users` with an external test email — confirm welcome email arrives.
- [ ] Test: request password reset at `/portal/forgot-password` — confirm reset email arrives.
- [ ] Check headers (`Show original` in Gmail): `dkim=pass`, `spf=pass`, `From: noreply@nkpublicschool.com`, `Reply-To: nkps.rajawas@gmail.com`.

---

## 5. Nameserver Migration Plan (Tradelit → Cloudflare)

Only do this **after** we have Wolkgeist/PDR registrar access.

### Why

Tradelit is a single point of failure. Every DNS change requires emailing them. If they go unresponsive, the school's domain is at risk. Cloudflare's free tier is industry-standard DNS with a clean self-serve UI.

### Steps

1. **Back up first.** Get a DNS zone export from Tradelit. Save it. Do NOT start the migration without this — even one missed record breaks a service.
2. Sign up at https://cloudflare.com (free plan).
3. Add `nkpublicschool.com` as a site. Cloudflare auto-imports Tradelit's records.
4. **Review the imported list against the backup.** Every A, MX, TXT, CNAME must match. Add anything missing manually.
5. Cloudflare issues two new nameservers (e.g. `kate.ns.cloudflare.com`, `bob.ns.cloudflare.com`).
6. Log into PDR (via Wolkgeist account). Change nameservers from Tradelit's to Cloudflare's.
7. Wait 2–24 hours for global propagation. During this window, some users still hit Tradelit — so **do not ask Tradelit to delete anything yet**.
8. Once propagation confirmed (`dig NS nkpublicschool.com` returns Cloudflare's nameservers from multiple locations), migration is complete.
9. For Cloudflare-specific quirk: make sure all DNS records are set to **DNS only** (grey cloud), not Proxied (orange cloud), unless you explicitly want the record proxied.

### Only AFTER migration is confirmed

- [ ] Thank Tradelit, tell them we're self-hosting DNS going forward.
- [ ] Keep their contact on file in case we ever need historical info.

---

## 6. Critical Reminders

- 🔴 **Domain expires 2026-06-10.** Non-negotiable deadline.
- 🔴 **Don't change DNS without a backup.** A zone export from Tradelit must exist before any nameserver or record changes.
- 🔴 **Don't remove the existing root MX record** (`mail.nkpublicschool.com`) until we've confirmed no one at the school depends on the old email system.
- 🔴 **Registrant email change requires verification.** When we update WHOIS details, ICANN rules trigger a 60-day transfer lock renewal. Factor this in when planning any registrar transfer.

---

## 7. Contacts & References

| Contact | Purpose | How to reach |
|---|---|---|
| Wolkgeist Infotech | Registrar account | `wolkgeist05@yahoo.com` |
| Tradelit | DNS zone / records | TBD (ask for official support email) |
| PDR Support | Registrar escalation | `support@publicdomainregistry.com` / https://manage.publicdomainregistry.com |
| Resend Domains | Domain verification UI | https://resend.com/domains |
| Resend Account Owner | Where emails currently deliver while unverified | The email the Resend account was signed up with |
| School office | Verification / authorisation | `nkps.rajawas@gmail.com` · +91-9785500046 |

### Useful commands

```bash
# Current nameservers
dig NS nkpublicschool.com +short

# WHOIS (registrar + registrant)
whois nkpublicschool.com

# Current A / MX records
dig A nkpublicschool.com +short
dig MX nkpublicschool.com +short

# After migration — confirm Cloudflare is serving DNS
dig NS nkpublicschool.com @1.1.1.1 +short

# After Resend setup — verify DKIM / SPF are live
dig TXT resend._domainkey.nkpublicschool.com +short
dig TXT send.nkpublicschool.com +short
dig MX send.nkpublicschool.com +short
```
