import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { AnimatedSection } from "@nkps/shared/components/AnimatedSection";
import { Users, ClipboardCheck, Lightbulb, BookOpenCheck } from "lucide-react";
import { buildMetadata } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "For Parents — NK Public School Jaipur",
  description:
    "Obligations, expectations and recommendations for parents and guardians of NK Public School students. Guidelines on home–school cooperation, diary use, attendance and discipline.",
  path: "/for-parents",
});

const obligations = [
  "As a first step in this direction we earnestly recommend the parents and guardians to familiarize themselves with this Diary and the rules it contains.",
  "We also recommend that the parents check the Diary of their child regularly and enforce regularity and discipline at home and see that the lessons are prepared and the assigned homework done. Remarks made in the Diary should be seen and countersigned. Failure to do so may put the children to great inconvenience.",
  "Parents and guardians are requested not to visit their ward or the teacher in the classrooms. Appointments and other requests with the Vice-Principals and teachers may be made through the pages of the School Diary. In urgent cases students may be contacted through the school office.",
  "Criticism of students, teachers or the school in the presence of the child should be avoided as it is likely to harm him/her. Should you have a legitimate complaint, see the Principal, by all means.",
  "Children who are ill should not be sent to the School to attend class or to take tests.",
  "Taking the ward out from classes for mere social functions is not recommended.",
  "Should you feel that your child does not make the desired progress, the Principal should be contacted. If there is real need of a private tutor, arrange for one only after getting permission from the Principal. No teacher is allowed to tutor the students of a class he/she teaches.",
  "Parents/guardians are requested to notify the school of any change in their address.",
  "Parents should discourage their children from bringing valuable articles to school. The school does not take responsibility for any article or money lost.",
  "Arrangements made by the school authorities such as cycle stand, N.C.C. and scout rooms are purely for the convenience of the students. The school will not accept responsibility for any loss or damage incurred when using them.",
  "Your co-operation is a must to ensure that no sharp, pointed or other dangerous articles are brought to the school. This applies in a special way to the students of the primary classes.",
  "Parents are expected to attend at least two Parent–Teacher Meeting Sessions in a year and sign the register kept with the class teacher. Failure to attend at least two such sessions will force the school authorities to conclude that the parents/guardians are not sufficiently interested in the education of their son/daughter in the school.",
];

const classXIINotice =
  "Parents of Class XII: Kindly make sure that your ward has given the pre-board examination and cleared all the papers with a minimum of 33% in all subjects.";

const expectationsSchool = [
  "Be available, if necessary, to discuss aspects of your child's behaviour at school. Sign messages, progress reports or other similar documents when requested to do so, to avoid putting your child through any inconvenience.",
  "Check the school diary daily, as it forms a link between the school and the parents.",
  "Ensure that your ward is not absent on the first and last day of the school term without prior permission and that any leave taken from school is duly explained in the diary.",
];

const expectationsTeachers = [
  "Feel free to contact an individual teacher during his/her free periods by taking prior permission from the Principal/Coordinator if you wish to discuss a matter of concern to you or your child.",
  "Be open to listening and considering the teachers' opinions regarding your child even when the comments may be less than complimentary.",
];

const expectationsOtherParents = [
  "Exert firm parental discipline in cases where your child's behaviour is distracting from the quality of learning opportunities for others in the school.",
  "Keep your child at home if he/she is suffering from chickenpox, smallpox, whooping cough or conjunctivitis, and send him/her to school only with a doctor's fitness certificate.",
  "A tag bearing the name of the pupil should invariably be attached to the school blazer and jersey/pullover.",
];

const recommendations = [
  "Parents are requested to remain regularly in touch with the day-to-day studies of the child and also keep in contact with the school.",
  "Private tuitions are strongly discouraged. It is important that a child develops the habit of working and studying on his/her own under the guidance of parents.",
  "Parents are requested to check the school diary daily, take note of, and also sign the remarks made in the diary.",
  "Parents must give significant time and attention to the progress and daily work of the children and help them daily in their studies.",
  "Parents should make it a point to attend the Parent–Teacher Meeting on the given date. The school administration will take a serious view of parents regularly absenting themselves from such meetings.",
  "In all official correspondence with the school the full name of the child, registration number, as well as the class and roll number should be stated.",
  "Respect for person, property and environment should be inculcated in children.",
  "Kindly ensure that your child packs the school diary, books, notebooks and pencil box as per the time table for school every day to avoid being overloaded.",
];

function NumberedList({ items }: { items: readonly string[] }) {
  return (
    <ol className="space-y-4">
      {items.map((text, i) => (
        <li key={i} className="flex gap-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold-500/15 text-sm font-bold text-gold-700 ring-1 ring-gold-500/30">
            {i + 1}
          </span>
          <p className="pt-0.5 text-[15px] leading-relaxed text-gray-700">{text}</p>
        </li>
      ))}
    </ol>
  );
}

function SectionCard({
  icon,
  eyebrow,
  title,
  children,
}: {
  icon: React.ReactNode;
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-[0_16px_30px_-14px_rgba(0,0,0,0.55)] sm:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-gold-400">
          {icon}
        </div>
        <div>
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-600">
              {eyebrow}
            </p>
          )}
          <h2 className="font-heading text-2xl font-bold text-navy-900 md:text-3xl">
            {title}
          </h2>
        </div>
      </div>
      <div className="mt-6 border-t border-gray-100 pt-6">{children}</div>
    </div>
  );
}

export default function ForParentsPage() {
  return (
    <PageTransition>
      <PageHeader
        title="For Parents"
        subtitle="Guidelines, expectations and recommendations for parents and guardians"
      />

      <section className="mx-auto max-w-5xl px-4 py-16 md:px-8">
        {/* Intro */}
        <AnimatedSection>
          <div className="mb-12 rounded-2xl bg-gradient-to-br from-navy-900 via-navy-800 to-navy-900 p-6 text-center shadow-lg sm:p-10">
            <p className="font-heading text-lg italic leading-relaxed text-cream-50 md:text-xl">
              &ldquo;The greater the co-operation between home and school, the more
              fruitful will the educational effort be — and the faster and surer
              the child&rsquo;s progress.&rdquo;
            </p>
            <div className="mx-auto mt-5 h-0.5 w-16 rounded-full bg-gold-500" />
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">
              NK Public School
            </p>
          </div>
        </AnimatedSection>

        {/* Obligations */}
        <AnimatedSection delay={0.05}>
          <SectionCard
            icon={<Users className="h-5 w-5" />}
            eyebrow="Section 1"
            title="Obligations of Parents"
          >
            <NumberedList items={obligations} />

            <div className="mt-6 rounded-xl border-l-4 border-gold-500 bg-cream-50/80 p-5">
              <p className="text-[15px] font-medium leading-relaxed text-navy-900">
                {classXIINotice}
              </p>
            </div>
          </SectionCard>
        </AnimatedSection>

        {/* Expectations */}
        <AnimatedSection delay={0.05}>
          <div className="mt-10">
            <SectionCard
              icon={<ClipboardCheck className="h-5 w-5" />}
              eyebrow="Section 2"
              title="Expectations from Parents / Guardians"
            >
              <div className="space-y-8">
                <div>
                  <h3 className="mb-4 inline-block border-b-2 border-gold-500 pb-1.5 font-heading text-lg font-bold text-navy-900">
                    1. The school expects that you will
                  </h3>
                  <NumberedList items={expectationsSchool} />
                </div>

                <div>
                  <h3 className="mb-4 inline-block border-b-2 border-gold-500 pb-1.5 font-heading text-lg font-bold text-navy-900">
                    2. The teaching staff expects that you will
                  </h3>
                  <NumberedList items={expectationsTeachers} />
                </div>

                <div>
                  <h3 className="mb-4 inline-block border-b-2 border-gold-500 pb-1.5 font-heading text-lg font-bold text-navy-900">
                    3. Other parents expect that you will
                  </h3>
                  <NumberedList items={expectationsOtherParents} />
                </div>
              </div>
            </SectionCard>
          </div>
        </AnimatedSection>

        {/* Recommendations */}
        <AnimatedSection delay={0.05}>
          <div className="mt-10">
            <SectionCard
              icon={<Lightbulb className="h-5 w-5" />}
              eyebrow="Section 3"
              title="Recommendations to the Parents"
            >
              <NumberedList items={recommendations} />
            </SectionCard>
          </div>
        </AnimatedSection>

        {/* Closing */}
        <AnimatedSection delay={0.05}>
          <div className="mt-10 flex items-start gap-4 rounded-2xl border border-chalk/20 bg-white/[0.04] p-6 sm:p-8">
            <BookOpenCheck className="h-6 w-6 shrink-0 text-chalk-gold" />
            <p className="text-[15px] leading-relaxed text-chalk-dim">
              Together — parents, teachers and the school — we shape the future of
              every child. Your active participation in the daily life of the school
              is the single biggest factor in your child&rsquo;s success.
            </p>
          </div>
        </AnimatedSection>
      </section>
    </PageTransition>
  );
}
