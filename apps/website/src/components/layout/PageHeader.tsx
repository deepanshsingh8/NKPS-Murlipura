"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  const pathname = usePathname();

  // Build breadcrumbs from path
  const segments = pathname.split("/").filter(Boolean);
  const breadcrumbs = segments.map((seg, i) => ({
    label: seg
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    href: "/" + segments.slice(0, i + 1).join("/"),
    isLast: i === segments.length - 1,
  }));

  return (
    <section className="relative w-full bg-navy-900 bg-gradient-to-br from-navy-900 via-navy-800 to-navy-900 py-16 pt-24 sm:py-24 sm:pt-32 overflow-hidden">
      {/* Subtle dot pattern texture */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative mx-auto max-w-4xl px-6 text-center"
      >
        {/* Breadcrumbs */}
        <nav className="flex items-center justify-center gap-1.5 text-sm mb-6" aria-label="Breadcrumb">
          <Link href="/" className="text-gray-400 hover:text-gold-400 transition-colors">
            Home
          </Link>
          {breadcrumbs.map((crumb) => (
            <span key={crumb.href} className="flex items-center gap-1.5">
              <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
              {crumb.isLast ? (
                <span className="text-gold-400 font-medium">{crumb.label}</span>
              ) : (
                <Link href={crumb.href} className="text-gray-400 hover:text-gold-400 transition-colors">
                  {crumb.label}
                </Link>
              )}
            </span>
          ))}
        </nav>

        <h1 className="font-heading text-4xl font-bold text-white md:text-5xl">
          {title}
        </h1>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: 64 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.3 }}
          className="mx-auto mt-4 h-1 rounded bg-gold-500"
        />
        {subtitle && (
          <p className="mt-4 text-lg text-gray-300">{subtitle}</p>
        )}
      </motion.div>
    </section>
  );
}
