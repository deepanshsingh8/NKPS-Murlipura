import { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { AnimatedSection } from "@nkps/shared/components/AnimatedSection";
import { getHolidayHomework } from "@/lib/holiday-homework";
import { HOLIDAY_HOMEWORK_CLASSES } from "@nkps/shared/lib/constants";
import { ExternalLink, FileText, Download, NotebookPen } from "lucide-react";
import { buildMetadata } from "@nkps/shared/lib/seo";
import type { HolidayHomework } from "@nkps/shared/types";

export const metadata: Metadata = buildMetadata({
  title: "Holiday Homework — NK Public School, Murlipura",
  description:
    "Download holiday homework for each class at NK Public School, Murlipura. Summer and winter break assignments organised by class.",
  path: "/holiday-homework",
});

export const revalidate = 60;

const CLASS_INDEX = new Map<string, number>(
  HOLIDAY_HOMEWORK_CLASSES.map((c, i) => [c, i])
);

export default async function HolidayHomeworkPage() {
  const items = await getHolidayHomework();

  // Group by class, ordered Nursery → XII (unknown classes last).
  const grouped = new Map<string, HolidayHomework[]>();
  for (const item of items) {
    const list = grouped.get(item.class_grade) ?? [];
    list.push(item);
    grouped.set(item.class_grade, list);
  }
  const classes = Array.from(grouped.keys()).sort(
    (a, b) =>
      (CLASS_INDEX.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (CLASS_INDEX.get(b) ?? Number.MAX_SAFE_INTEGER)
  );

  return (
    <PageTransition>
      <PageHeader
        title="Holiday Homework"
        subtitle="Download holiday homework for your class"
      />

      <section className="mx-auto max-w-4xl px-4 py-16 md:px-8">
        {items.length === 0 ? (
          <AnimatedSection>
            <div className="rounded-2xl border border-dashed border-chalk/20 bg-white/[0.04] p-10 text-center">
              <NotebookPen className="mx-auto mb-3 h-8 w-8 text-chalk-faint" />
              <p className="text-sm text-chalk-faint">
                Holiday homework will be published here before each break.
              </p>
            </div>
          </AnimatedSection>
        ) : (
          <div className="space-y-8">
            {classes.map((cls, idx) => (
              <AnimatedSection key={cls} delay={Math.min(idx * 0.05, 0.3)}>
                <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-[0_14px_28px_-14px_rgba(0,0,0,0.55)] sm:p-6">
                  <h2 className="mb-4 inline-block border-b-2 border-gold-500 pb-1.5 font-heading text-lg font-bold text-navy-900">
                    Class {cls}
                  </h2>
                  <ul className="space-y-3">
                    {grouped.get(cls)!.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-cream-50/50 p-3.5 transition-colors hover:bg-cream-50 sm:p-4"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-navy-800">
                              {item.title}
                            </p>
                            <p className="text-xs text-gray-500">
                              {item.session} Break · {item.academic_year}
                            </p>
                          </div>
                        </div>
                        <a
                          href={item.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-blue-600 transition-colors hover:text-blue-800"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </AnimatedSection>
            ))}
          </div>
        )}
      </section>
    </PageTransition>
  );
}
