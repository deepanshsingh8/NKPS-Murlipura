import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { rateLimit, clientIp } from "@nkps/shared/lib/rate-limit";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const BASE_SYSTEM_PROMPT = `You are the NK Public School Murlipura virtual assistant. Answer questions from parents, students, and visitors about the school. Be helpful, friendly, and concise. If you don't know something specific, suggest contacting the school office directly.

## General Information
- Full Name: NK Public School, Murlipura (English Medium)
- Tagline: "A Relentless Quest for Excellence"
- Founded: 1985 (the founding campus of the NKPS group)
- Affiliation: CBSE (Central Board of Secondary Education) — affiliation number to be confirmed
- Classes: Nursery to Class XII
- Streams at Senior Secondary (XI–XII): Science and Commerce
- Co-educational, English medium

## Founder
- Late Shri R.K. Choudhary (1929–2005)
- A former Indian Army officer decorated for service in the Royal Corps. After military service he dedicated his life to education; his core values of discipline, knowledge and human dignity continue to guide the institution.

## Leadership
- Dr. N.C. Lunayach — Managing Director
- Mr. Kuldeep Singh — Director
- Ms. Chitra Raje Basera — Principal

## Contact Information
- Address: Arya Nagar, Murlipura, Jaipur – 302039, Rajasthan
- Phone: +91-9785500042, +91-9785500061
- Office line: 0141-2231152, 0141-2232089
- Fax: 0141-2231482
- Email: nkpsem@gmail.com, nkpsjaipur@gmail.com
- WhatsApp: +91-9785500042
- Office Hours: Mon–Sat, 9:00 AM – 3:00 PM

## Website Pages
- Home: /
- About: /about
- Academics: /academics
- Admissions: /admissions
- Student Life: /student-life
- Facilities: /facilities
- Gallery: /gallery
- Contact: /contact

## Admissions (overview)
- Application on the school's prescribed form (included with prospectus).
- Birth certificate required (Nursery onwards).
- Transfer Certificate + previous-school marksheet from Class II onwards.
- Registration fee is non-refundable and does not guarantee admission.
- Nursery–Class I: parent/guardian interaction. Class II+: written entrance (Hindi, English, Mathematics) and interview.
- Minimum ages (as on 1 April): Nursery 3+, LKG 4+, UKG 5+, Class I 6+.
- 25% RTE reservation in Nursery and Class I.

## Examination policy
- Five assessments per year: First Term, Second Term, Half-Yearly, Third Term, Annual.
- Minimum 75% attendance required for final exams.
- All dues must be cleared before final exams.

## Scholarship (merit-based, on Class X board %)
- 87.00–89.99%: ₹2,100 one-time
- 90.00–95.00%: 25% tuition reduction (split XI + XII)
- 95.01–97.00%: 50% tuition reduction (split XI + XII)
- 97.01–100.00%: 100% tuition waiver (split XI + XII)
- Second installment is paid only if the student scores ≥ 80% in Class XI.

## Facilities
- Library: 3,000+ books, periodicals and educational CDs.
- Laboratories: Physics, Chemistry, Biology.
- Art, music & dance training.
- Canteen and tuck shop.
- School transport (minimum 10 students per route; one-way not provided).

## Important Rules for Responses
- Only answer questions about NK Public School Murlipura.
- Keep answers concise but informative (2-4 sentences).
- For fees, exact schedules, or dates, suggest contacting the school office directly.
- Be warm, professional, and welcoming.
- Use simple formatting — short paragraphs, no complex markdown.
- If you don't have specific information (e.g., teacher names, current events, fee amounts), say "For the latest details on that, I'd recommend contacting the school office" rather than guessing.
- For mandatory disclosure questions, point users to the /mandatory-public-disclosure page.`;

export async function POST(request: NextRequest) {
  try {
    // Anonymous endpoint that pays per-token to Anthropic — must rate limit
    // or a single attacker can rack up real cost. 20 messages / IP / minute
    // is generous for a human chatting and an order of magnitude below
    // anything that would be expensive.
    const ipLimit = rateLimit({
      name: "chat:ip",
      key: clientIp(request),
      max: 20,
      windowSeconds: 60,
    });
    if (!ipLimit.ok) {
      return NextResponse.json(
        {
          reply:
            "You're sending messages too quickly. Please wait a moment and try again.",
        },
        { status: 429 }
      );
    }

    const { message, history } = await request.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { reply: "Please send a valid message." },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        {
          reply:
            "The chat service is currently unavailable. Please contact the school directly at +91-9785500042 or email nkpsem@gmail.com.",
        },
        { status: 200 }
      );
    }

    const messages: { role: "user" | "assistant"; content: string }[] = [];

    if (Array.isArray(history)) {
      const recentHistory = history.slice(-10);
      for (const msg of recentHistory) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    messages.push({ role: "user", content: message });

    // Build dynamic system prompt with disclosure data
    let systemPrompt = BASE_SYSTEM_PROMPT;
    try {
      const { getDisclosureItems, getDisclosureDocuments, getDisclosureBoardResults } =
        await import("@/lib/disclosure");
      const [discItems, discDocs, discResults] = await Promise.all([
        getDisclosureItems(),
        getDisclosureDocuments(),
        getDisclosureBoardResults(),
      ]);

      let disclosureSection = "\n\n## Mandatory Public Disclosure (CBSE)\n";
      disclosureSection += "Full details at: /mandatory-public-disclosure\n";

      const sectionLabels: Record<string, string> = {
        general: "General Information",
        staff: "Staff (Teaching)",
        infrastructure: "School Infrastructure",
        result_academics: "Result & Academics",
      };

      const grouped: Record<string, typeof discItems> = {};
      discItems.forEach((item) => {
        if (!grouped[item.section]) grouped[item.section] = [];
        grouped[item.section].push(item);
      });

      for (const [section, label] of Object.entries(sectionLabels)) {
        const sectionItems = grouped[section];
        if (sectionItems?.length) {
          disclosureSection += `\n### ${label}\n`;
          sectionItems.forEach((item) => {
            if (item.value) disclosureSection += `- ${item.label}: ${item.value}\n`;
          });
        }
      }

      if (discDocs.some((d) => d.file_url)) {
        disclosureSection += "\n### Documents Available for Download\n";
        discDocs.forEach((doc) => {
          disclosureSection += `- ${doc.label}: ${doc.file_url ? "Available on website" : "Not yet uploaded"}\n`;
        });
      }

      if (discResults.length > 0) {
        disclosureSection += "\n### Board Examination Results\n";
        discResults.forEach((r) => {
          disclosureSection += `- Class ${r.exam_class} (${r.academic_year}): ${r.registered} registered, ${r.passed} passed, ${r.pass_percentage}% pass rate${r.remarks ? ` — ${r.remarks}` : ""}\n`;
        });
      }

      systemPrompt += disclosureSection;
    } catch (e) {
      console.error("Failed to load disclosure data for chat:", e);
    }

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: systemPrompt,
      messages,
    });

    const reply =
      response.content[0].type === "text"
        ? response.content[0].text
        : "I'm sorry, I couldn't generate a response. Please try again.";

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      {
        reply:
          "I'm having trouble responding right now. Please try again later or contact the school directly at +91-9785500042.",
      },
      { status: 200 }
    );
  }
}
