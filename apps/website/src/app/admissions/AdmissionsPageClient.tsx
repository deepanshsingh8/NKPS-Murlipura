"use client";

import Link from "next/link";
import { Phone, Mail, ArrowRight, GraduationCap, ClipboardList, FileText, Users, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { SectionDivider } from "@nkps/shared/components/SectionDivider";
import { AnimatedSection } from "@nkps/shared/components/AnimatedSection";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@nkps/shared/components/ui/accordion";
import { SCHOOL } from "@nkps/shared/lib/constants";
import { staggerContainer, fadeUp } from "@nkps/shared/lib/animations";
import { ADMISSIONS_FAQS } from "./faqs";

const steps = [
  {
    number: 1,
    title: "Enquiry",
    description: "Visit school or call for information about admissions and programs.",
    icon: Phone,
  },
  {
    number: 2,
    title: "Application",
    description: "Fill and submit the admission form with required documents.",
    icon: ClipboardList,
  },
  {
    number: 3,
    title: "Interaction",
    description: "Student and parent meet with the principal for a brief interaction.",
    icon: Users,
  },
  {
    number: 4,
    title: "Enrollment",
    description: "Complete documentation and fee payment to confirm admission.",
    icon: CheckCircle,
  },
];

const eligibility = [
  { grade: "Nursery", requirement: "Minimum age 3 years as on 31st March of the academic year" },
  { grade: "LKG", requirement: "Minimum age 4 years as on 31st March of the academic year" },
  { grade: "UKG", requirement: "Minimum age 5 years as on 31st March of the academic year" },
  {
    grade: "Class I onwards",
    requirement: "Age-appropriate admission + Transfer Certificate from previous school",
  },
];

export function AdmissionsPageClient() {
  return (
    <PageTransition>
      <PageHeader title="Admissions" subtitle="Join the NK Public School Family" />

      {/* Admission Process */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <AnimatedSection>
            <SectionHeading
              label="How to Apply"
              title="Admission Process"
              subtitle="A simple four-step journey to becoming part of our family"
            />
          </AnimatedSection>

          {/* Desktop: Horizontal Stepper */}
          <motion.div
            className="mt-16 hidden md:flex items-start justify-between relative"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
          >
            {/* Connecting line */}
            <div className="absolute top-7 left-[calc(12.5%+1.75rem)] right-[calc(12.5%+1.75rem)] h-0.5 border-t-2 border-dashed border-gold-500/40" />

            {steps.map((step) => (
              <motion.div
                key={step.number}
                variants={fadeUp}
                className="group relative flex w-1/4 flex-col items-center text-center px-4"
              >
                <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-gold-500 to-gold-400 shadow-lg shadow-gold-500/25 transition-all duration-500 group-hover:shadow-xl group-hover:shadow-gold-500/30 group-hover:scale-110">
                  <span className="font-heading text-xl font-bold text-navy-900">
                    {step.number}
                  </span>
                </div>
                <step.icon className="mt-4 h-5 w-5 text-gold-600 transition-transform duration-300 group-hover:scale-110" />
                <h3 className="mt-2 font-heading text-lg font-semibold text-navy-900">
                  {step.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">
                  {step.description}
                </p>
              </motion.div>
            ))}
          </motion.div>

          {/* Mobile: Vertical Stepper */}
          <motion.div
            className="mt-12 md:hidden space-y-0"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
          >
            {steps.map((step, index) => (
              <motion.div key={step.number} variants={fadeUp} className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold-500 to-gold-400 shadow-lg shadow-gold-500/25">
                    <span className="font-heading text-xl font-bold text-navy-900">
                      {step.number}
                    </span>
                  </div>
                  {index < steps.length - 1 && (
                    <div className="h-full w-0.5 border-l-2 border-dashed border-gold-500/40 my-1" />
                  )}
                </div>
                <div className="pb-10 pt-2">
                  <div className="flex items-center gap-2">
                    <step.icon className="h-4 w-4 text-gold-600" />
                    <h3 className="font-heading text-lg font-semibold text-navy-900">
                      {step.title}
                    </h3>
                  </div>
                  <p className="mt-1 text-gray-600">{step.description}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <SectionDivider color="fill-cream-50" />

      {/* Eligibility */}
      <section className="bg-cream-50 py-20 px-6">
        <div className="mx-auto max-w-5xl">
          <AnimatedSection>
            <SectionHeading
              label="Requirements"
              title="Eligibility"
              subtitle="Age criteria and requirements for admission"
            />
          </AnimatedSection>

          <motion.div
            className="mt-12 grid gap-5 sm:grid-cols-2"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
          >
            {eligibility.map((item) => (
              <motion.div
                key={item.grade}
                variants={fadeUp}
                className="group rounded-2xl border border-gray-200 bg-white p-6 transition-shadow duration-300 hover:shadow-xl hover:shadow-navy-900/5"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gold-500/10">
                    <GraduationCap className="h-6 w-6 text-gold-600" />
                  </div>
                  <div>
                    <h3 className="font-heading text-lg font-bold text-navy-900">
                      {item.grade}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600">
                      {item.requirement}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <SectionDivider flip color="fill-cream-50" />

      {/* Fee Structure */}
      <section className="relative py-20 px-6 overflow-hidden">
        {/* Decorative background */}
        <div className="absolute inset-0 bg-gradient-to-b from-white via-cream-50/30 to-white" />
        <div className="absolute top-10 right-0 h-72 w-72 rounded-full bg-gold-500/5 blur-3xl" />
        <div className="absolute bottom-10 left-0 h-72 w-72 rounded-full bg-gold-500/5 blur-3xl" />

        <div className="relative mx-auto max-w-4xl text-center">
          <AnimatedSection>
            <SectionHeading
              title="Fee Structure"
              subtitle="Get in touch with us for complete fee details"
            />
          </AnimatedSection>

          <AnimatedSection delay={0.2}>
            <div className="mx-auto mt-12 max-w-xl rounded-2xl border border-gold-500/20 bg-white/60 p-10 shadow-xl shadow-gold-500/5 backdrop-blur-md">
              <FileText className="mx-auto h-10 w-10 text-gold-500" />
              <p className="mt-4 text-lg text-gray-600">
                Please contact the school office for detailed fee information and payment schedule.
              </p>
              <div className="mt-8 space-y-3">
                <div className="flex items-center justify-center gap-3 text-gray-700">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500/10">
                    <Phone className="h-4 w-4 text-gold-600" />
                  </div>
                  <span className="font-medium">{SCHOOL.phone.join(", ")}</span>
                </div>
                <div className="flex items-center justify-center gap-3 text-gray-700">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500/10">
                    <Mail className="h-4 w-4 text-gold-600" />
                  </div>
                  <span className="font-medium">{SCHOOL.email[0]}</span>
                </div>
              </div>
              <Link
                href="/contact"
                className="mt-8 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-gold-500 to-gold-400 px-8 py-3 font-semibold text-navy-900 shadow-lg shadow-gold-500/25 transition-all duration-300 hover:shadow-xl hover:shadow-gold-500/30 hover:brightness-105"
              >
                Contact Us <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </AnimatedSection>
        </div>
      </section>

      <SectionDivider color="fill-cream-50" />

      {/* Admissions FAQ */}
      <section className="bg-cream-50 py-20 px-6">
        <div className="mx-auto max-w-3xl">
          <AnimatedSection>
            <SectionHeading
              label="Common Questions"
              title="Admissions FAQ"
              subtitle="Everything parents ask about joining NK Public School"
            />
          </AnimatedSection>

          <AnimatedSection delay={0.2}>
            <div className="mt-12">
              <Accordion defaultValue={[]}>
                {ADMISSIONS_FAQS.map((faq, index) => (
                  <AccordionItem
                    key={index}
                    value={`adm-faq-${index}`}
                    className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white px-2 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <AccordionTrigger className="px-4 py-5 text-left font-heading text-base font-semibold text-navy-900 hover:text-gold-600 [&[data-state=open]]:text-gold-600">
                      {faq.q}
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-5 text-sm leading-relaxed text-gray-600">
                      {faq.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </AnimatedSection>
        </div>
      </section>

      <SectionDivider flip color="fill-cream-50" />

      {/* CTA Banner */}
      <section className="relative bg-navy-900 py-20 px-6 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-navy-800 via-navy-900 to-navy-900" />
        <div className="absolute top-0 right-1/4 h-64 w-64 rounded-full bg-gold-500/5 blur-3xl" />

        <div className="relative mx-auto max-w-3xl text-center">
          <AnimatedSection>
            <h2 className="font-heading text-3xl md:text-4xl font-bold text-white">
              Ready to Join NK Public School?
            </h2>
            <div className="mx-auto mt-4 h-1 w-16 rounded-full bg-gold-500" />
            <p className="mt-6 text-lg text-gray-300">
              Take the first step towards a bright future. Begin the admission process today and become part of our growing family.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-gold-500 to-gold-400 px-8 py-3.5 font-semibold text-navy-900 shadow-lg shadow-gold-500/25 transition-all duration-300 hover:shadow-xl hover:shadow-gold-500/30 hover:brightness-105"
              >
                Start Application <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href={`tel:${SCHOOL.phone[0]}`}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-8 py-3.5 font-semibold text-white transition-colors hover:bg-white/10"
              >
                <Phone className="h-4 w-4" /> Call Us
              </Link>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </PageTransition>
  );
}
