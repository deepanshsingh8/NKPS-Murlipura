import { Metadata } from "next";
import Link from "next/link";
import { NotebookPen, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CurriculumOverview } from "@/components/academics/CurriculumOverview";
import { StaffDirectory } from "@/components/academics/StaffDirectory";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildMetadata, breadcrumbJsonLd } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Academics & CBSE Curriculum — NK Public School Jaipur",
  description:
    "CBSE curriculum at NK Public School, Jaipur — structured pre-primary, primary, secondary and senior-secondary programs with experienced faculty in Science, Commerce and Humanities streams.",
  path: "/academics",
});

export default function AcademicsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Academics", path: "/academics" },
        ])}
      />
      <PageHeader
        title="Academics"
        subtitle="Excellence in CBSE Education"
      />
      <CurriculumOverview />

      {/* Holiday Homework CTA */}
      <section className="px-6 pb-4">
        <div className="mx-auto max-w-5xl">
          <Link
            href="/holiday-homework"
            className="group flex flex-col items-start justify-between gap-4 rounded-2xl border border-gold-500/30 bg-gold-500/5 p-6 transition-colors hover:bg-gold-500/10 sm:flex-row sm:items-center sm:p-8"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-gold-400">
                <NotebookPen className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-heading text-xl font-bold text-chalk">
                  Holiday Homework
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-chalk-dim">
                  Download summer and winter break assignments, organised by class.
                </p>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-gold-500 to-gold-400 px-5 py-2.5 text-sm font-semibold text-navy-900 transition-transform group-hover:translate-x-0.5">
              View Homework <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </div>
      </section>

      <StaffDirectory />
    </>
  );
}
