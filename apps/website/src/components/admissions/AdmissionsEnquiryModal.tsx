"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, GraduationCap } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { contactFormSchema, type ContactFormData } from "@nkps/shared/lib/validations";

/**
 * Admissions enquiry pop-up shown on the /admissions page. It opens
 * automatically every time the page is visited (per product requirement —
 * each admissions visit should surface the enquiry prompt), captures the
 * visitor's enquiry, and can be dismissed — either way the admissions page
 * remains fully visible underneath. Closing it only hides it for the current
 * view; the next visit / refresh shows it again.
 *
 * Email + phone are validated (format-level) on both the client (zod here) and
 * the server (/api/contact) before anything is stored.
 */

export function AdmissionsEnquiryModal() {
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: { subject: "Admissions" },
  });

  // Auto-open on every visit, shortly after the page settles. No persistence
  // gate — each mount (page visit / refresh) re-opens the prompt by design.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, []);

  // Closing only hides it for the current view; it reopens on the next visit.
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  // Lock body scroll + close on Escape while open.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const onSubmit = async (data: ContactFormData) => {
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, subject: "Admissions" }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Failed to send enquiry. Please try again.");
        return;
      }

      toast.success("Thank you! Our admissions team will get in touch shortly.");
      reset();
      close();
    } catch {
      toast.error("Something went wrong. Please try again.");
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close admissions enquiry"
            onClick={close}
            className="absolute inset-0 bg-navy-950/70 backdrop-blur-sm"
          />

          {/* Dialog */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admissions-enquiry-title"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"
          >
            {/* Header */}
            <div className="relative bg-gradient-to-br from-navy-900 to-navy-800 px-6 py-7 text-center">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-gold-500 to-gold-400" />
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="absolute right-4 top-4 rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-500 to-gold-400 shadow-lg shadow-gold-500/25">
                <GraduationCap className="h-6 w-6 text-navy-900" />
              </div>
              <h2
                id="admissions-enquiry-title"
                className="font-heading text-xl font-bold text-white"
              >
                Admissions Open 2026&ndash;27
              </h2>
              <p className="mt-1.5 text-sm text-gray-300">
                Share your details and our team will get in touch. Prefer to
                browse first? Just close this and explore the page.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-6">
              <input type="hidden" value="Admissions" {...register("subject")} />

              <div className="space-y-1.5">
                <Label htmlFor="enq-name" className="text-sm font-medium text-navy-900">
                  Full Name
                </Label>
                <Input
                  id="enq-name"
                  placeholder="Parent / student name"
                  className="rounded-xl border-gray-200 bg-cream-50/50"
                  {...register("fullName")}
                />
                {errors.fullName && (
                  <p className="text-sm text-red-500">{errors.fullName.message}</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="enq-phone" className="text-sm font-medium text-navy-900">
                    Phone
                  </Label>
                  <Input
                    id="enq-phone"
                    type="tel"
                    inputMode="numeric"
                    placeholder="10-digit mobile"
                    className="rounded-xl border-gray-200 bg-cream-50/50"
                    {...register("phone")}
                  />
                  {errors.phone && (
                    <p className="text-sm text-red-500">{errors.phone.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="enq-email" className="text-sm font-medium text-navy-900">
                    Email
                  </Label>
                  <Input
                    id="enq-email"
                    type="email"
                    placeholder="your@email.com"
                    className="rounded-xl border-gray-200 bg-cream-50/50"
                    {...register("email")}
                  />
                  {errors.email && (
                    <p className="text-sm text-red-500">{errors.email.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="enq-message" className="text-sm font-medium text-navy-900">
                  Your Enquiry
                </Label>
                <textarea
                  id="enq-message"
                  rows={3}
                  placeholder="Which class are you applying for? Any questions?"
                  className="flex w-full rounded-xl border border-gray-200 bg-cream-50/50 px-4 py-2.5 text-sm transition-all placeholder:text-muted-foreground focus:border-gold-500 focus:ring-4 focus:ring-gold-500/20 focus-visible:outline-none"
                  {...register("message")}
                />
                {errors.message && (
                  <p className="text-sm text-red-500">{errors.message.message}</p>
                )}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-gold-500 to-gold-400 px-6 py-3 font-semibold text-navy-900 shadow-lg shadow-gold-500/25 transition-all duration-300 hover:brightness-110 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {isSubmitting ? "Sending…" : "Send Enquiry"}
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-xl px-4 py-3 text-sm font-medium text-gray-500 transition-colors hover:text-navy-900"
                >
                  Skip
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
