import { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { AnimatedSection } from "@nkps/shared/components/AnimatedSection";
import { getProspectusDocuments } from "@/lib/prospectus";
import { ExternalLink, FileText, Download, BookText } from "lucide-react";
import { buildMetadata } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Prospectus — NK Public School, Murlipura",
  description:
    "Download the NK Public School, Murlipura prospectus — admission information, academics, facilities and campus life for prospective parents and students.",
  path: "/prospectus",
});

export const revalidate = 60;

export default async function ProspectusPage() {
  const documents = await getProspectusDocuments();

  return (
    <PageTransition>
      <PageHeader
        title="Prospectus"
        subtitle="Download our school prospectus and brochures"
      />

      <section className="mx-auto max-w-3xl px-4 py-16 md:px-8">
        <AnimatedSection>
          <p className="mb-8 text-center text-[15px] leading-relaxed text-chalk-dim">
            Explore what NK Public School, Murlipura has to offer. Download the
            prospectus below to learn about our academics, facilities, admission
            process and campus life.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.1}>
          {documents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-chalk/20 bg-white/[0.04] p-10 text-center">
              <BookText className="mx-auto mb-3 h-8 w-8 text-chalk-faint" />
              <p className="text-sm text-chalk-faint">
                The prospectus will be available for download here soon.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-black/5 bg-white p-4 shadow-[0_14px_28px_-14px_rgba(0,0,0,0.55)] transition-shadow hover:shadow-[0_20px_40px_-16px_rgba(0,0,0,0.7)] sm:p-5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-gold-400">
                      <FileText className="h-5 w-5" />
                    </div>
                    <p className="truncate font-medium text-navy-900">
                      {doc.title}
                    </p>
                  </div>
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-gold-500 to-gold-400 px-4 py-2.5 text-sm font-semibold text-navy-900 transition-all hover:shadow-lg hover:shadow-gold-500/25"
                  >
                    <Download className="h-4 w-4" />
                    Download
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </AnimatedSection>
      </section>
    </PageTransition>
  );
}
