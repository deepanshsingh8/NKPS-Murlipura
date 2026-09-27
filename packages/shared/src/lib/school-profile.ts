import type { SupabaseClient } from "@supabase/supabase-js";
import { SCHOOL } from "./constants";

/**
 * Reads the school's identity from the database rather than from
 * `constants.ts`.
 *
 * Every assistant surface goes through here, so that a second school is a row
 * rather than a redeploy, and so the visitor-facing assistant stops answering
 * from a hardcoded copy of facts the office edits elsewhere.
 *
 * This is NOT multi-tenancy. `school_profile` holds one row and no other table
 * carries a school_id. What it buys is that new work stops hardcoding the
 * school, so the eventual tenancy project is smaller rather than larger. The
 * other ~27 `constants.ts` consumers are intentionally left alone — converting
 * them is that project, not this one.
 */

export interface SchoolProfile {
  name: string;
  shortName: string | null;
  tagline: string | null;
  description: string | null;
  foundedYear: number | null;
  board: string | null;
  affiliationNumber: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;
  /** Full postal address, assembled from the parts that are set. */
  addressFull: string;
  phones: string[];
  emails: string[];
  officeHours: string | null;
  latitude: number | null;
  longitude: number | null;
  social: Record<string, string>;
  aiEnabled: boolean;
  aiTone: "warm" | "formal" | "neutral";
  aiLanguages: string[];
  aiDisclaimer: string | null;
  whatsappPhoneNumberId: string | null;
  whatsappWabaId: string | null;
}

const SELECT_COLUMNS = [
  "name", "short_name", "tagline", "description", "founded_year",
  "board", "affiliation_number",
  "address_line1", "city", "state", "pin_code",
  "phones", "emails", "office_hours",
  "latitude", "longitude", "social",
  "ai_enabled", "ai_tone", "ai_languages", "ai_disclaimer",
  "whatsapp_phone_number_id", "whatsapp_waba_id",
].join(", ");

function joinAddress(parts: (string | null)[]): string {
  return parts.filter((p) => p && p.trim()).join(", ");
}

/**
 * The compiled-in fallback.
 *
 * Used only when the row is missing or unreadable. Returning this rather than
 * throwing is deliberate: the school's name appearing on a page is not worth
 * a 500, and the row is seeded from these same values, so the fallback and the
 * happy path agree until someone edits the row.
 *
 * `aiEnabled` is false here on purpose — if we cannot read the configuration,
 * we must not assume the assistant was switched on.
 */
function fallbackProfile(): SchoolProfile {
  return {
    name: SCHOOL.name,
    shortName: SCHOOL.shortName,
    tagline: SCHOOL.tagline,
    description: SCHOOL.description,
    foundedYear: SCHOOL.founded,
    board: SCHOOL.affiliation,
    affiliationNumber: SCHOOL.affiliationNumber,
    addressLine1: SCHOOL.address.line1,
    city: SCHOOL.address.city,
    state: SCHOOL.address.state,
    pinCode: SCHOOL.address.pin,
    addressFull: SCHOOL.address.full,
    phones: [...SCHOOL.phone],
    emails: [...SCHOOL.email],
    officeHours: SCHOOL.officeHours,
    latitude: SCHOOL.geo.lat,
    longitude: SCHOOL.geo.lng,
    social: { ...SCHOOL.social },
    aiEnabled: false,
    aiTone: "warm",
    aiLanguages: ["en"],
    aiDisclaimer: null,
    whatsappPhoneNumberId: null,
    whatsappWabaId: null,
  };
}

/**
 * Fetch the school profile.
 *
 * Callers pass their own Supabase client, so this works from a route handler,
 * a server component, or a tool executor without assuming a session. The row
 * is world-readable, so an anon client is enough.
 */
export async function getSchoolProfile(
  supabase: SupabaseClient
): Promise<SchoolProfile> {
  const { data, error } = await supabase
    .from("school_profile")
    .select(SELECT_COLUMNS)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.error("[school-profile] falling back to constants:", error.message);
    }
    return fallbackProfile();
  }

  // Two casts on purpose: the select list is assembled from an array, so
  // PostgREST's string-literal inference can't type the row and lands on
  // GenericStringError. The field-by-field reads below do the real narrowing.
  const row = data as unknown as Record<string, unknown>;
  const str = (k: string) => (row[k] as string | null) ?? null;
  const arr = (k: string) => (Array.isArray(row[k]) ? (row[k] as string[]) : []);

  const line1 = str("address_line1");
  const city = str("city");
  const state = str("state");
  const pin = str("pin_code");

  const tone = str("ai_tone");

  return {
    name: str("name") ?? SCHOOL.name,
    shortName: str("short_name"),
    tagline: str("tagline"),
    description: str("description"),
    foundedYear: (row.founded_year as number | null) ?? null,
    board: str("board"),
    affiliationNumber: str("affiliation_number"),
    addressLine1: line1,
    city,
    state,
    pinCode: pin,
    addressFull: joinAddress([line1, city, state && pin ? `${state} – ${pin}` : state ?? pin]),
    phones: arr("phones"),
    emails: arr("emails"),
    officeHours: str("office_hours"),
    // Postgres numeric arrives as a string over PostgREST; Number(null) is 0,
    // so guard explicitly or an unset pin becomes a real coordinate.
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    social: (row.social as Record<string, string> | null) ?? {},
    aiEnabled: row.ai_enabled === true,
    aiTone: tone === "formal" || tone === "neutral" ? tone : "warm",
    aiLanguages: arr("ai_languages").length > 0 ? arr("ai_languages") : ["en"],
    aiDisclaimer: str("ai_disclaimer"),
    whatsappPhoneNumberId: str("whatsapp_phone_number_id"),
    whatsappWabaId: str("whatsapp_waba_id"),
  };
}
