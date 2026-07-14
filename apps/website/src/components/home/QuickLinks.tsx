"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  GraduationCap,
  LayoutGrid,
  Calendar,
  ArrowRight,
} from "lucide-react";
import { staggerContainer, fadeUp } from "@nkps/shared/lib/animations";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { cn } from "@nkps/shared/lib/utils";
import { getCmsUrl, getErpUrl } from "@nkps/shared/lib/cross-app";

const links = [
  {
    icon: GraduationCap,
    title: "ERP Login",
    description: "Students, parents, teachers & staff — academic records, results, fees, attendance",
    href: getErpUrl("/portal/login"),
    featured: true,
  },
  {
    icon: LayoutGrid,
    title: "CMS Login",
    description: "Admins & editors — manage gallery, articles, transfer certificates, and site content",
    href: getCmsUrl("/login"),
    featured: false,
  },
  {
    icon: Calendar,
    title: "Academic Calendar",
    description: "Upcoming events, holidays, exams and PTM schedule",
    href: "/academic-calendar",
    featured: false,
  },
];

export function QuickLinks() {
  return (
    <section className="section-padding relative overflow-hidden">
      <div className="page-container relative z-10">
        <SectionHeading
          label="Get Started"
          title="Access Your Portal"
          subtitle="Jump into academic resources, results, and school information"
          light
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-5 mt-12"
        >
          {links.map((link) => (
            <motion.div
              key={link.title}
              variants={fadeUp}
            >
              <Link href={link.href} className="block h-full">
                <motion.div
                  whileHover={{ y: -4 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  className={cn(
                    "group relative rounded-3xl overflow-hidden p-4 sm:p-7 h-full cursor-pointer transition-all duration-300 hover:shadow-xl",
                    link.featured
                      ? "bg-gradient-to-br from-navy-900 to-navy-800 border border-gold-500/30 hover:border-gold-500/50"
                      : "bg-white/[0.04] border border-chalk/20 hover:border-gold-500/40 hover:bg-white/[0.06]"
                  )}
                >
                  <div className="relative flex items-start gap-3 sm:gap-5">
                    {/* Icon */}
                    <div className={cn(
                      "w-10 h-10 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg transition-shadow duration-300",
                      link.featured
                        ? "bg-gradient-to-br from-gold-500 to-gold-400 shadow-gold-500/25"
                        : "bg-gradient-to-br from-navy-900 to-navy-700 shadow-navy-900/20 group-hover:shadow-navy-900/30"
                    )}>
                      <link.icon className={cn("w-5 h-5 sm:w-6 sm:h-6", link.featured ? "text-navy-900" : "text-white")} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className={cn(
                          "text-lg sm:text-xl",
                          link.featured ? "text-white" : "text-chalk"
                        )}>
                          {link.title}
                        </h3>
                        <ArrowRight className={cn(
                          "w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300",
                          link.featured ? "text-gold-400" : "text-chalk-faint"
                        )} />
                      </div>
                      <p className={cn(
                        "text-sm mt-1 leading-relaxed",
                        link.featured ? "text-gray-300" : "text-chalk-dim"
                      )}>
                        {link.description}
                      </p>
                    </div>
                  </div>
                </motion.div>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
