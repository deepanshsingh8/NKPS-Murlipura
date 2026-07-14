"use client";

import { useState } from "react";
import { Download, Search, Info, AlertTriangle, Loader2, FileText, GraduationCap } from "lucide-react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { SectionDivider } from "@nkps/shared/components/SectionDivider";
import { AnimatedSection } from "@nkps/shared/components/AnimatedSection";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { cn } from "@nkps/shared/lib/utils";

interface LookupResult {
  studentName: string;
  classLastAttended: string | null;
  academicYear: string;
  signedUrl: string;
}

export function TransferCertificatesPageClient() {
  const [admissionNo, setAdmissionNo] = useState("");
  const [dob, setDob] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!admissionNo.trim() || !dob.trim()) {
      setError("Enter both admission number and date of birth.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/transfer-certificates/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admissionNo: admissionNo.trim(), dob }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Details don't match any existing TCs");
        return;
      }

      setResult(data as LookupResult);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewSearch = () => {
    setResult(null);
    setError(null);
    setAdmissionNo("");
    setDob("");
  };

  return (
    <PageTransition>
      <PageHeader
        title="Transfer Certificates"
        subtitle="Securely look up and download a TC issued by NK Public School"
      />

      <SectionDivider color="fill-board" />

      <section className="py-20 px-6">
        <div className="mx-auto max-w-3xl">
          <AnimatedSection>
            <SectionHeading title="Find Your Transfer Certificate" light />
          </AnimatedSection>

          {/* Privacy Notice */}
          <AnimatedSection delay={0.1}>
            <div className="mt-8 rounded-2xl border border-chalk/20 bg-white/[0.04] p-5 md:p-6">
              <div className="flex gap-4 items-start">
                <div className="flex-shrink-0 rounded-xl bg-gold-500/10 p-2.5">
                  <Info className="h-5 w-5 text-chalk-gold" />
                </div>
                <div>
                  <h3 className="font-semibold text-chalk text-sm">
                    Why we ask for both details
                  </h3>
                  <p className="mt-1 text-sm text-chalk-dim leading-relaxed">
                    Transfer certificates contain personal information, so we never
                    list them publicly. Enter the student&apos;s admission number
                    and date of birth exactly as they appear in school records to
                    retrieve the matching certificate. If you can&apos;t find it,
                    please contact the school office.
                  </p>
                </div>
              </div>
            </div>
          </AnimatedSection>

          {/* Result */}
          {result ? (
            <AnimatedSection delay={0.15}>
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-10 rounded-3xl border border-gold-500/30 bg-white p-8 shadow-sm"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 rounded-2xl bg-navy-900 p-3">
                    <GraduationCap className="h-6 w-6 text-gold-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-600">
                      Match found
                    </p>
                    <h3 className="mt-1 font-heading text-2xl font-bold text-navy-900">
                      {result.studentName}
                    </h3>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {result.classLastAttended && (
                        <span className="inline-block rounded-full bg-cream-100 px-3 py-1 text-xs font-semibold text-navy-800">
                          Class {result.classLastAttended}
                        </span>
                      )}
                      <span className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                        AY {result.academicYear}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between border-t border-gray-100 pt-6">
                  <p className="text-xs text-gray-500 leading-relaxed">
                    The download link below is valid for 60 seconds. Generate a new
                    one by searching again if it expires.
                  </p>
                  <a
                    href={result.signedUrl}
                    download
                    className={cn(
                      "inline-flex shrink-0 items-center gap-2 rounded-full px-6 py-3",
                      "bg-gradient-to-r from-gold-500 to-gold-400 text-navy-900",
                      "font-semibold text-sm shadow-sm",
                      "transition-all duration-300",
                      "hover:shadow-md hover:shadow-gold-500/25 hover:scale-[1.02]",
                      "active:scale-95"
                    )}
                  >
                    <Download className="h-4 w-4" />
                    Download Certificate
                  </a>
                </div>

                <button
                  type="button"
                  onClick={handleNewSearch}
                  className="mt-5 text-xs font-medium text-navy-800/60 hover:text-navy-900 transition-colors"
                >
                  ← Search for another certificate
                </button>
              </motion.div>
            </AnimatedSection>
          ) : (
            <AnimatedSection delay={0.15}>
              <form
                onSubmit={handleSubmit}
                className="mt-10 rounded-3xl border border-navy-900/5 bg-white p-6 md:p-8 shadow-sm"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label
                      htmlFor="admission-no"
                      className="block text-xs font-semibold uppercase tracking-wider text-navy-800/70"
                    >
                      Admission Number
                    </label>
                    <input
                      id="admission-no"
                      type="text"
                      autoComplete="off"
                      placeholder="e.g., 1234"
                      value={admissionNo}
                      onChange={(e) => setAdmissionNo(e.target.value)}
                      className={cn(
                        "mt-2 w-full rounded-xl border-2 border-navy-900/10 bg-white px-4 py-3",
                        "text-navy-900 placeholder:text-navy-800/40",
                        "transition-all duration-300",
                        "focus:border-gold-500 focus:outline-none focus:ring-4 focus:ring-gold-500/10"
                      )}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="dob"
                      className="block text-xs font-semibold uppercase tracking-wider text-navy-800/70"
                    >
                      Date of Birth
                    </label>
                    <input
                      id="dob"
                      type="date"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      className={cn(
                        "mt-2 w-full rounded-xl border-2 border-navy-900/10 bg-white px-4 py-3",
                        "text-navy-900",
                        "transition-all duration-300",
                        "focus:border-gold-500 focus:outline-none focus:ring-4 focus:ring-gold-500/10"
                      )}
                    />
                  </div>
                </div>

                {error && (
                  <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className={cn(
                    "mt-6 inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full px-7 py-3",
                    "bg-navy-900 text-white",
                    "font-semibold text-sm shadow-sm",
                    "transition-all duration-300",
                    "hover:bg-navy-800 hover:shadow-md",
                    "disabled:opacity-60 disabled:cursor-not-allowed",
                    "active:scale-95"
                  )}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching...
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4" />
                      Find Certificate
                    </>
                  )}
                </button>
              </form>
            </AnimatedSection>
          )}

          <AnimatedSection delay={0.2}>
            <div className="mt-12 flex items-start gap-3 text-sm text-chalk-faint">
              <FileText className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                Transfer certificates are uploaded by the school administration.
                If both fields are correct and you still see a no-match message,
                please contact the school office at{" "}
                <a
                  href="/contact"
                  className="font-semibold text-chalk hover:text-chalk-gold underline-offset-4 hover:underline"
                >
                  the contact page
                </a>
                .
              </p>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </PageTransition>
  );
}
