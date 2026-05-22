/**
 * Standard CBSE curriculum subject mappings by grade band.
 * Used by the Quick Setup wizard to pre-populate subjects and assignments.
 */

export interface CurriculumSubject {
  name: string;
  code: string;
  is_elective: boolean;
}

export interface GradeBand {
  label: string;
  classes: string[];
  subjects: CurriculumSubject[];
}

export interface StreamCurriculum {
  stream_name: string;
  stream_code: string;
  subjects: CurriculumSubject[];
}

// ── Grade bands for classes I–X (no streams) ──

export const CBSE_GRADE_BANDS: GradeBand[] = [
  {
    label: "Primary (I–V)",
    classes: ["I", "II", "III", "IV", "V"],
    subjects: [
      { name: "English", code: "ENG", is_elective: false },
      { name: "Hindi", code: "HIN", is_elective: false },
      { name: "Mathematics", code: "MATH", is_elective: false },
      { name: "EVS", code: "EVS", is_elective: false },
      { name: "Computer Science", code: "CS", is_elective: false },
      { name: "Art & Craft", code: "ART", is_elective: false },
    ],
  },
  {
    label: "Middle (VI–VIII)",
    classes: ["VI", "VII", "VIII"],
    subjects: [
      { name: "English", code: "ENG", is_elective: false },
      { name: "Hindi", code: "HIN", is_elective: false },
      { name: "Mathematics", code: "MATH", is_elective: false },
      { name: "Science", code: "SCI", is_elective: false },
      { name: "Social Science", code: "SST", is_elective: false },
      { name: "Sanskrit", code: "SKT", is_elective: false },
      { name: "Computer Science", code: "CS", is_elective: false },
    ],
  },
  {
    label: "Secondary (IX–X)",
    classes: ["IX", "X"],
    subjects: [
      { name: "English", code: "ENG", is_elective: false },
      { name: "Hindi", code: "HIN", is_elective: false },
      { name: "Mathematics", code: "MATH", is_elective: false },
      { name: "Science", code: "SCI", is_elective: false },
      { name: "Social Science", code: "SST", is_elective: false },
      { name: "Information Technology", code: "IT", is_elective: true },
    ],
  },
];

// ── Stream-specific curricula for classes XI–XII ──

export const CBSE_STREAM_CURRICULA: StreamCurriculum[] = [
  {
    stream_name: "Science",
    stream_code: "SCI",
    subjects: [
      { name: "Physics", code: "PHY", is_elective: false },
      { name: "Chemistry", code: "CHEM", is_elective: false },
      { name: "Biology", code: "BIO", is_elective: false },
      { name: "Mathematics", code: "MATH", is_elective: false },
      { name: "English", code: "ENG", is_elective: false },
      { name: "Computer Science", code: "CS", is_elective: true },
    ],
  },
  {
    stream_name: "Commerce",
    stream_code: "COM",
    subjects: [
      { name: "Accountancy", code: "ACC", is_elective: false },
      { name: "Economics", code: "ECO", is_elective: false },
      { name: "Business Studies", code: "BST", is_elective: false },
      { name: "Mathematics", code: "MATH", is_elective: false },
      { name: "English", code: "ENG", is_elective: false },
      { name: "Computer Science", code: "CS", is_elective: true },
    ],
  },
  {
    stream_name: "Humanities",
    stream_code: "HUM",
    subjects: [
      { name: "History", code: "HIST", is_elective: false },
      { name: "Political Science", code: "POL", is_elective: false },
      { name: "Geography", code: "GEO", is_elective: false },
      { name: "Economics", code: "ECO", is_elective: false },
      { name: "English", code: "ENG", is_elective: false },
      { name: "Hindi", code: "HIN", is_elective: false },
    ],
  },
];

// ── Deduplicated flat list of all CBSE subjects ──

export const ALL_CBSE_SUBJECTS: CurriculumSubject[] = (() => {
  const seen = new Map<string, CurriculumSubject>();
  for (const band of CBSE_GRADE_BANDS) {
    for (const s of band.subjects) {
      if (!seen.has(s.name)) seen.set(s.name, s);
    }
  }
  for (const stream of CBSE_STREAM_CURRICULA) {
    for (const s of stream.subjects) {
      if (!seen.has(s.name)) seen.set(s.name, s);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
})();

const SENIOR_CLASSES = ["XI", "XII"];

/**
 * Returns the applicable subjects for a given class name and optional stream.
 * For classes I–X, returns grade-band subjects.
 * For XI–XII, returns stream-specific subjects (or empty if stream not found).
 */
export function getSubjectsForClass(
  className: string,
  streamName?: string | null
): CurriculumSubject[] {
  if (SENIOR_CLASSES.includes(className)) {
    if (!streamName) return [];
    const stream = CBSE_STREAM_CURRICULA.find(
      (s) => s.stream_name.toLowerCase() === streamName.toLowerCase()
    );
    return stream?.subjects ?? [];
  }

  for (const band of CBSE_GRADE_BANDS) {
    if (band.classes.includes(className)) {
      return band.subjects;
    }
  }

  return [];
}
