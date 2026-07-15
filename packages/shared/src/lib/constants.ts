export const SCHOOL = {
  name: "NK Public School, Murlipura",
  shortName: "NKPS Murlipura",
  tagline: "A Relentless Quest for Excellence",
  description:
    "NK Public School Murlipura, the founding campus of the NKPS group, has been nurturing young minds in Jaipur since 1985. We offer holistic education from Nursery to Class XII with Science and Commerce streams at the senior-secondary level.",
  mission:
    "To be a centre of excellence in education which, in keeping with the rich heritage of India, will stress the simultaneous development of body, mind and spirit, and endeavour to create compassionate, responsible and innovative global citizens who are committed to the development of India.",
  vision:
    "To prepare dynamic and caring citizens of tomorrow to meet the challenges of a global society while retaining their traditional values.",
  founded: 1985,
  founder: {
    name: "Late Shri R.K. Choudhary",
    years: "1929–2005",
    bio: "A former Indian Army officer who served in the Royal Corps and witnessed many battles with neighbouring countries. Decorated with many medals, he dedicated his post-military life to education. His core philosophy centred on discipline, education and human values — principles that continue to guide our institution.",
  },
  address: {
    line1: "Arya Nagar, Murlipura",
    city: "Jaipur",
    state: "Rajasthan",
    pin: "302039",
    full: "Arya Nagar, Murlipura, Jaipur – 302039",
  },
  phone: ["+91-9785500042", "+91-9785500061"],
  fax: "0141-2231482",
  email: ["nkpsem@gmail.com", "nkpsjaipur@gmail.com"],
  whatsapp: "919785500042",
  officeHours: "Mon–Sat, 9:00 AM – 3:00 PM",
  affiliation: "CBSE",
  affiliationNumber: "",
  geo: { lat: 26.9774, lng: 75.7884 },
  priceRange: "₹₹",
  social: {
    facebook: "",
    instagram: "",
    youtube: "",
  },
  leadership: [
    {
      name: "Dr. N.C. Lunayach",
      designation: "Managing Director",
      message:
        "It is not enough if you just live life as it comes to you like a floating leaf in a pond. Make use of the powers bestowed upon you and soar like an eagle. Every day and every morning begins with a different challenge.",
    },
    {
      name: "Mr. Kuldeep Singh",
      designation: "Director",
      message:
        "NKPS is a voyage of discovery — of one's talent and potential, of opportunities and challenges. The wealth of a nation is not dependent on economic resources alone; education is the foundation that builds confident, ethical, independent citizens.",
    },
    {
      name: "Ms. Chitra Raje Basera",
      designation: "Principal",
      message:
        "A relentless quest for excellence, an insatiable thirst for knowledge and a limitless craving for the latest are the hallmarks of NKPS. Freedom can only be effectively exercised when guided by discipline.",
    },
  ],
  // Homepage "By the Numbers" band. Only campus-verifiable facts are shown so
  // nothing renders as a hollow "0+". TODO(content): once the school confirms
  // the Murlipura campus student and faculty head-counts, swap one of the
  // fact cards below back to a "Students"/"Faculty" counter.
  stats: [
    { label: "Years of Excellence", value: 40, suffix: "+" },
    { label: "Class Levels (Nursery–XII)", value: 15, suffix: "" },
    { label: "Streams (XI–XII)", value: 2, suffix: "" },
    // A year is an identifier, not a quantity — `display` shows it verbatim so
    // it doesn't count-up 0 → 1985.
    { label: "Educating Since", value: 1985, suffix: "", display: "1985" },
  ],
  // About-page achievements band. Values below are drawn from the school's own
  // published results/awards (see _reference/scraped/murlipura-content.md §8).
  // TODO(content): confirm alumni-network size and latest board pass-% with the
  // school, then add those cards.
  achievementStats: [
    { label: "Years of Legacy", value: 40, suffix: "+" },
    { label: "Perfect Scorers · 2021", value: 6, suffix: "" },
    { label: "National Gold Medallists", value: 3, suffix: "" },
    // A year is an identifier, not a quantity — `display` shows it verbatim so
    // it doesn't count-up 0 → 1985.
    { label: "Educating Since", value: 1985, suffix: "", display: "1985" },
  ],
} as const;

export const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Academics", href: "/academics" },
  { label: "Admissions", href: "/admissions" },
  { label: "Student Life", href: "/student-life" },
  { label: "Facilities", href: "/facilities" },
  { label: "Gallery", href: "/gallery" },
  { label: "Articles", href: "/articles" },
  { label: "Alumni", href: "/alumni" },
  { label: "Contact", href: "/contact" },
] as const;

// Class list (Nursery → XII) used to tag and order holiday-homework documents.
// Kept in one place so the CMS pickers and the public grouping stay in sync.
export const HOLIDAY_HOMEWORK_CLASSES = [
  "Nursery",
  "LKG",
  "UKG",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
] as const;

export const HOLIDAY_HOMEWORK_SESSIONS = ["Summer", "Winter"] as const;

export const STAFF = {
  pgt: [] as { name: string; subject: string }[],
  tgt: [] as { name: string; subject: string }[],
  prt: [] as { name: string; subject: string }[],
  management: [] as { name: string; subject: string }[],
  motherTeachers: [] as { name: string; subject: string }[],
  admin: [] as { name: string; subject: string }[],
} as const;

export const HALF_DAY_CUTOFF_PERIOD = 4;
