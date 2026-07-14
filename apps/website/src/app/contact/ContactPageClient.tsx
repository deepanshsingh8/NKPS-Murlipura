"use client";

import { MapPin, Phone, Mail, Clock, Send, MessageCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/layout/PageHeader";
import { AnimatedSection } from "@nkps/shared/components/AnimatedSection";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { SectionDivider } from "@nkps/shared/components/SectionDivider";
import {
  FacebookIcon,
  InstagramIcon,
  YoutubeIcon,
} from "@nkps/shared/components/SocialIcons";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@nkps/shared/components/ui/accordion";
import { contactFormSchema, type ContactFormData } from "@nkps/shared/lib/validations";
import { SCHOOL } from "@nkps/shared/lib/constants";
import { staggerContainer, fadeUp } from "@nkps/shared/lib/animations";
import { CONTACT_FAQS } from "./faqs";

const contactCards = [
  {
    icon: MapPin,
    title: "Visit Us",
    subtitle: "Our Campus",
    value: SCHOOL.address.full,
  },
  {
    icon: Phone,
    title: "Call Us",
    subtitle: "We're a call away",
    value: SCHOOL.phone.join(", "),
  },
  {
    icon: Mail,
    title: "Email Us",
    subtitle: "Drop us a line",
    value: SCHOOL.email[0],
  },
  {
    icon: Clock,
    title: "Office Hours",
    subtitle: "When we're available",
    value: SCHOOL.officeHours,
  },
];

const subjectOptions = [
  "General Inquiry",
  "Admissions",
  "Fee Related",
  "Transport",
  "Other",
];

const faqs = CONTACT_FAQS;

export function ContactPageClient() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
  });

  const onSubmit = async (data: ContactFormData) => {
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Failed to send message. Please try again.");
        return;
      }

      toast.success("Message sent successfully! We will get back to you soon.");
      reset();
    } catch {
      toast.error("Something went wrong. Please try again.");
    }
  };

  return (
    <PageTransition>
      <PageHeader title="Contact Us" subtitle="We're here to help" />

      {/* Contact Info Cards */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <AnimatedSection>
            <SectionHeading
              title="Get in Touch"
              subtitle="Reach out to us through any of the following channels"
              light
            />
          </AnimatedSection>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
          >
            {contactCards.map((card) => (
              <motion.div
                key={card.title}
                variants={fadeUp}
                className="group relative overflow-hidden rounded-2xl border border-chalk/20 bg-white/[0.04] p-8 text-center shadow-lg backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-gold-500/40 hover:shadow-xl"
              >
                {/* Subtle gradient accent at top */}
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-gold-500 to-gold-400" />

                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-gold-500 to-gold-400 shadow-lg shadow-gold-500/25 transition-transform duration-300 group-hover:scale-110">
                  <card.icon className="h-7 w-7 text-white" />
                </div>
                <p className="text-xs font-medium uppercase tracking-widest text-chalk-gold">
                  {card.subtitle}
                </p>
                <h3 className="mt-1 font-heading text-lg font-bold text-chalk">
                  {card.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-chalk-dim">
                  {card.value}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <SectionDivider color="fill-board" />

      {/* Contact Form — Split Layout */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <AnimatedSection>
            <SectionHeading
              title="Send Us a Message"
              subtitle="Fill out the form below and we will get back to you shortly"
              light
            />
          </AnimatedSection>

          <div className="mt-12 grid grid-cols-1 gap-0 overflow-hidden rounded-3xl shadow-2xl lg:grid-cols-5">
            {/* Left decorative panel */}
            <AnimatedSection className="lg:col-span-2">
              <div className="flex h-full flex-col justify-between bg-navy-900 p-6 sm:p-8 text-white lg:p-10">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <MessageCircle className="h-5 w-5 text-gold-500" />
                    <span className="text-sm font-medium uppercase tracking-widest text-gold-500">
                      Let&apos;s Connect
                    </span>
                  </div>
                  <h3 className="font-heading text-2xl font-bold leading-snug lg:text-3xl">
                    We&apos;d love to hear from you
                  </h3>
                  <p className="mt-4 text-sm leading-relaxed text-gray-300">
                    Whether you have a question about admissions, fees,
                    transport, or anything else, our team is ready to answer all
                    your queries.
                  </p>
                </div>

                <div className="mt-8 space-y-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                      <Phone className="h-4 w-4 text-gold-400" />
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                        Phone
                      </p>
                      <p className="text-sm text-gray-200">
                        {SCHOOL.phone.join(" | ")}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                      <Mail className="h-4 w-4 text-gold-400" />
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                        Email
                      </p>
                      <p className="text-sm text-gray-200">
                        {SCHOOL.email[0]}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                      <MapPin className="h-4 w-4 text-gold-400" />
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                        Address
                      </p>
                      <p className="text-sm text-gray-200">
                        {SCHOOL.address.full}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Social links */}
                <div className="mt-8 border-t border-white/10 pt-6">
                  <p className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                    Follow Us
                  </p>
                  <div className="flex gap-3">
                    <a
                      href={SCHOOL.social.facebook}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-gold-500 hover:text-white"
                    >
                      <FacebookIcon className="h-4 w-4" />
                    </a>
                    <a
                      href={SCHOOL.social.instagram}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-gold-500 hover:text-white"
                    >
                      <InstagramIcon className="h-4 w-4" />
                    </a>
                    <a
                      href={SCHOOL.social.youtube}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-gold-500 hover:text-white"
                    >
                      <YoutubeIcon className="h-4 w-4" />
                    </a>
                  </div>
                </div>

                {/* Decorative quote */}
                <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-5">
                  <p className="font-heading text-sm italic leading-relaxed text-gray-300">
                    &ldquo;Education is the foundation of a brighter future. We
                    strive to provide an environment where every child discovers
                    their potential.&rdquo;
                  </p>
                  <p className="mt-2 text-xs font-medium text-gold-400">
                    — {SCHOOL.leadership[0].name},{" "}
                    {SCHOOL.leadership[0].designation}
                  </p>
                </div>
              </div>
            </AnimatedSection>

            {/* Right form panel */}
            <AnimatedSection delay={0.2} className="lg:col-span-3">
              <div className="h-full bg-white p-6 sm:p-8 lg:p-10">
                <form
                  onSubmit={handleSubmit(onSubmit)}
                  className="space-y-6"
                >
                  <div className="space-y-2">
                    <Label
                      htmlFor="fullName"
                      className="text-sm font-medium text-navy-900"
                    >
                      Full Name
                    </Label>
                    <Input
                      id="fullName"
                      placeholder="Enter your full name"
                      className="rounded-xl border-gray-200 bg-cream-50/50 px-4 py-3 transition-all focus:border-gold-500 focus:ring-4 focus:ring-gold-500/20"
                      {...register("fullName")}
                    />
                    {errors.fullName && (
                      <p className="text-sm text-red-500">
                        {errors.fullName.message}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label
                        htmlFor="email"
                        className="text-sm font-medium text-navy-900"
                      >
                        Email
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="your@email.com"
                        className="rounded-xl border-gray-200 bg-cream-50/50 px-4 py-3 transition-all focus:border-gold-500 focus:ring-4 focus:ring-gold-500/20"
                        {...register("email")}
                      />
                      {errors.email && (
                        <p className="text-sm text-red-500">
                          {errors.email.message}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label
                        htmlFor="phone"
                        className="text-sm font-medium text-navy-900"
                      >
                        Phone
                      </Label>
                      <Input
                        id="phone"
                        type="tel"
                        placeholder="+91-XXXXXXXXXX"
                        className="rounded-xl border-gray-200 bg-cream-50/50 px-4 py-3 transition-all focus:border-gold-500 focus:ring-4 focus:ring-gold-500/20"
                        {...register("phone")}
                      />
                      {errors.phone && (
                        <p className="text-sm text-red-500">
                          {errors.phone.message}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="subject"
                      className="text-sm font-medium text-navy-900"
                    >
                      Subject
                    </Label>
                    <select
                      id="subject"
                      {...register("subject")}
                      className="flex h-12 w-full rounded-xl border border-gray-200 bg-cream-50/50 px-4 py-3 text-sm transition-all focus:border-gold-500 focus:ring-4 focus:ring-gold-500/20 focus-visible:outline-none"
                    >
                      <option value="">Select a subject</option>
                      {subjectOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    {errors.subject && (
                      <p className="text-sm text-red-500">
                        {errors.subject.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="message"
                      className="text-sm font-medium text-navy-900"
                    >
                      Message
                    </Label>
                    <textarea
                      id="message"
                      rows={5}
                      placeholder="Write your message here..."
                      {...register("message")}
                      className="flex w-full rounded-xl border border-gray-200 bg-cream-50/50 px-4 py-3 text-sm transition-all placeholder:text-muted-foreground focus:border-gold-500 focus:ring-4 focus:ring-gold-500/20 focus-visible:outline-none"
                    />
                    {errors.message && (
                      <p className="text-sm text-red-500">
                        {errors.message.message}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-gold-500 to-gold-400 px-8 py-3.5 font-semibold text-white shadow-lg shadow-gold-500/25 transition-all duration-300 hover:shadow-xl hover:shadow-gold-500/30 hover:brightness-110 disabled:opacity-50 disabled:hover:shadow-lg"
                  >
                    <Send className="h-4 w-4" />
                    {isSubmitting ? "Sending..." : "Send Message"}
                  </button>
                </form>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      <SectionDivider flip color="fill-board" />

      {/* Google Maps */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <AnimatedSection>
            <SectionHeading
              title="Find Us"
              subtitle="Visit our campus in Arya Nagar, Murlipura"
              light
            />
          </AnimatedSection>

          <AnimatedSection delay={0.2}>
            <div className="mt-12 overflow-hidden rounded-2xl border border-gray-200 shadow-xl">
              <iframe
                src="https://www.google.com/maps?q=NK+Public+School+Arya+Nagar+Murlipura+Jaipur+Rajasthan+302039&output=embed"
                width="100%"
                height="400"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="NK Public School Location"
              />
            </div>
          </AnimatedSection>
        </div>
      </section>

      <SectionDivider color="fill-board" />

      {/* FAQ */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-3xl">
          <AnimatedSection>
            <SectionHeading
              title="Frequently Asked Questions"
              subtitle="Find quick answers to common queries about our school"
              light
            />
          </AnimatedSection>

          <AnimatedSection delay={0.2}>
            <div className="mt-12 space-y-4">
              <Accordion defaultValue={[]}>
                {faqs.map((faq, index) => (
                  <AccordionItem
                    key={index}
                    value={`faq-${index}`}
                    className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white px-2 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <AccordionTrigger className="px-4 py-5 text-left font-heading text-base font-semibold text-navy-900 hover:text-gold-600 [&[data-state=open]]:text-gold-600">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-5 text-sm leading-relaxed text-gray-600">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </PageTransition>
  );
}
