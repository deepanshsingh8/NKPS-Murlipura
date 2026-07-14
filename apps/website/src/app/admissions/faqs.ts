import { SCHOOL } from "@nkps/shared/lib/constants";

export const ADMISSIONS_FAQS = [
  {
    q: "When do admissions open at NK Public School for the new academic year?",
    a: "Admissions for the new academic session typically open in January. For exact dates and forms, please call the school office or visit the campus in Arya Nagar, Murlipura, Jaipur.",
  },
  {
    q: "What is the age criteria for Nursery, LKG and UKG?",
    a: "Minimum age as on 31st March of the academic year: Nursery — 3 years, LKG — 4 years, UKG — 5 years. Class I onwards admissions are age-appropriate with a Transfer Certificate from the previous school.",
  },
  {
    q: "What documents are required for admission?",
    a: "Birth Certificate, previous school records and Transfer Certificate (Class I onwards), passport-size photographs of the child and parents, and Aadhaar Card copy. The school office will confirm any additional documents at the time of the application.",
  },
  {
    q: "Is NK Public School CBSE affiliated?",
    a: `Yes. NK Public School, Murlipura is a CBSE co-educational school in Jaipur${SCHOOL.affiliationNumber ? `, affiliation number ${SCHOOL.affiliationNumber}` : " (CBSE affiliation number available from the school office on request)"}. We offer classes from Nursery to Class XII following the CBSE curriculum.`,
  },
  {
    q: "Does the school provide bus transport?",
    a: "Yes. We run a dedicated school bus service covering major routes across Jaipur. Route details and stops can be shared by the office at the time of admission.",
  },
  {
    q: "How do I contact the admissions office?",
    a: `You can call ${SCHOOL.phone.join(" or ")} during office hours (${SCHOOL.officeHours}), email ${SCHOOL.email[0]}, or visit the campus at ${SCHOOL.address.full}.`,
  },
  {
    q: "What streams are offered in Class XI and XII?",
    a: "We offer Science (with Biology and Mathematics streams), Commerce and Humanities at the senior secondary level, with subject combinations aligned to CBSE guidelines.",
  },
];
