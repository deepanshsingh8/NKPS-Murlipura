import { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { AnimatedSection } from "@nkps/shared/components/AnimatedSection";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@nkps/shared/components/ui/accordion";
import {
  getDisclosureItems,
  getDisclosureDocuments,
  getDisclosureBoardResults,
} from "@/lib/disclosure";
import { ExternalLink, FileText, Download } from "lucide-react";
import type { DisclosureItem, DisclosureBoardResult } from "@nkps/shared/types";
import { buildMetadata } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Mandatory Public Disclosure — NK Public School, Murlipura",
  description:
    "CBSE mandatory public disclosure for NK Public School, Murlipura, Jaipur — affiliation details, infrastructure, staff, results, documents and statutory information.",
  path: "/mandatory-public-disclosure",
});

export const revalidate = 60;

function DisclosureTable({ data }: { data: { label: string; value: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <tbody>
          {data.map((item, index) => (
            <tr
              key={index}
              className={index % 2 === 0 ? "bg-cream-50" : "bg-white"}
            >
              <td className="border border-gray-200 px-4 py-3 font-medium text-navy-800 w-1/2">
                {item.label}
              </td>
              <td className="border border-gray-200 px-4 py-3 text-gray-700">
                {item.value || <span className="text-gray-400 italic">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoardResultsTable({ results, examClass }: { results: DisclosureBoardResult[]; examClass: string }) {
  const filtered = results.filter((r) => r.exam_class === examClass);
  if (filtered.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic py-2">
        No data available for Class {examClass}.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-navy-900 text-white">
            <th className="border border-navy-800 px-4 py-2.5 text-left font-semibold">
              Academic Year
            </th>
            <th className="border border-navy-800 px-4 py-2.5 text-left font-semibold">
              Registered
            </th>
            <th className="border border-navy-800 px-4 py-2.5 text-left font-semibold">
              Passed
            </th>
            <th className="border border-navy-800 px-4 py-2.5 text-left font-semibold">
              Pass %
            </th>
            <th className="border border-navy-800 px-4 py-2.5 text-left font-semibold">
              Remarks
            </th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r, index) => (
            <tr
              key={r.id}
              className={index % 2 === 0 ? "bg-cream-50" : "bg-white"}
            >
              <td className="border border-gray-200 px-4 py-3 font-medium text-navy-800">
                {r.academic_year}
              </td>
              <td className="border border-gray-200 px-4 py-3 text-gray-700">
                {r.registered}
              </td>
              <td className="border border-gray-200 px-4 py-3 text-gray-700">
                {r.passed}
              </td>
              <td className="border border-gray-200 px-4 py-3 text-gray-700">
                {r.pass_percentage}%
              </td>
              <td className="border border-gray-200 px-4 py-3 text-gray-700">
                {r.remarks || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MandatoryPublicDisclosurePage() {
  const [items, documents, boardResults] = await Promise.all([
    getDisclosureItems(),
    getDisclosureDocuments(),
    getDisclosureBoardResults(),
  ]);

  const groupedItems: Record<string, DisclosureItem[]> = {};
  items.forEach((item) => {
    if (!groupedItems[item.section]) groupedItems[item.section] = [];
    groupedItems[item.section].push(item);
  });

  const generalData = (groupedItems["general"] ?? []).map((i) => ({
    label: i.label,
    value: i.value,
  }));

  const staffData = (groupedItems["staff"] ?? []).map((i) => ({
    label: i.label,
    value: i.value,
  }));

  const infraData = (groupedItems["infrastructure"] ?? []).map((i) => ({
    label: i.label,
    value: i.value,
  }));

  const resultTextData = (groupedItems["result_academics"] ?? []).map((i) => ({
    label: i.label,
    value: i.value,
  }));

  return (
    <PageTransition>
      <PageHeader
        title="Mandatory Public Disclosure"
        subtitle="As per CBSE requirements"
      />

      <section className="py-16 px-4 md:px-8 max-w-5xl mx-auto">
        <AnimatedSection>
          <p className="text-gray-600 mb-8 text-sm">
            The following information is published as per CBSE Affiliation
            Bye-Laws and mandatory disclosure requirements. This information is
            updated periodically. Click on a section to view details.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.1}>
          <Accordion defaultValue={[]}>
            {/* Section A: General Information */}
            <AccordionItem
              value="general"
              className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              <AccordionTrigger className="px-5 py-4 text-left font-heading text-base font-bold text-navy-900 hover:text-gold-600 [&[data-state=open]]:text-gold-600">
                A. General Information
              </AccordionTrigger>
              <AccordionContent className="px-5 pb-5">
                <DisclosureTable data={generalData} />
              </AccordionContent>
            </AccordionItem>

            {/* Section B: Documents and Information */}
            <AccordionItem
              value="documents"
              className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              <AccordionTrigger className="px-5 py-4 text-left font-heading text-base font-bold text-navy-900 hover:text-gold-600 [&[data-state=open]]:text-gold-600">
                B. Documents and Information
              </AccordionTrigger>
              <AccordionContent className="px-5 pb-5">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <tbody>
                      {documents.map((doc, index) => (
                        <tr
                          key={doc.id}
                          className={
                            index % 2 === 0 ? "bg-cream-50" : "bg-white"
                          }
                        >
                          <td className="border border-gray-200 px-4 py-3 font-medium text-navy-800">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                              {doc.label}
                            </div>
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-right w-40">
                            {doc.file_url ? (
                              <a
                                href={doc.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
                              >
                                <Download className="h-3.5 w-3.5" />
                                View / Download
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-gray-400 italic text-sm">
                                Not available
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Section C: Result and Academics */}
            <AccordionItem
              value="result_academics"
              className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              <AccordionTrigger className="px-5 py-4 text-left font-heading text-base font-bold text-navy-900 hover:text-gold-600 [&[data-state=open]]:text-gold-600">
                C. Result and Academics
              </AccordionTrigger>
              <AccordionContent className="px-5 pb-5 space-y-6">
                {/* Text fields */}
                <DisclosureTable data={resultTextData} />

                {/* Board Results */}
                <div>
                  <h3 className="text-sm font-heading font-bold text-navy-900 mb-3 border-b border-gold-500 pb-1.5">
                    Last Three-Year Result of Board Examination — Class X
                  </h3>
                  <BoardResultsTable
                    results={boardResults}
                    examClass="X"
                  />
                </div>

                <div>
                  <h3 className="text-sm font-heading font-bold text-navy-900 mb-3 border-b border-gold-500 pb-1.5">
                    Last Three-Year Result of Board Examination — Class XII
                  </h3>
                  <BoardResultsTable
                    results={boardResults}
                    examClass="XII"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Section D: Staff (Teaching) */}
            <AccordionItem
              value="staff"
              className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              <AccordionTrigger className="px-5 py-4 text-left font-heading text-base font-bold text-navy-900 hover:text-gold-600 [&[data-state=open]]:text-gold-600">
                D. Staff (Teaching)
              </AccordionTrigger>
              <AccordionContent className="px-5 pb-5">
                <DisclosureTable data={staffData} />
              </AccordionContent>
            </AccordionItem>

            {/* Section E: School Infrastructure */}
            <AccordionItem
              value="infrastructure"
              className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              <AccordionTrigger className="px-5 py-4 text-left font-heading text-base font-bold text-navy-900 hover:text-gold-600 [&[data-state=open]]:text-gold-600">
                E. School Infrastructure
              </AccordionTrigger>
              <AccordionContent className="px-5 pb-5">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <tbody>
                      {infraData.map((item, index) => (
                        <tr
                          key={index}
                          className={
                            index % 2 === 0 ? "bg-cream-50" : "bg-white"
                          }
                        >
                          <td className="border border-gray-200 px-4 py-3 font-medium text-navy-800 w-1/2">
                            {item.label}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-gray-700">
                            {item.label
                              .toLowerCase()
                              .includes("youtube") && item.value ? (
                              <a
                                href={item.value}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-medium transition-colors"
                              >
                                Watch Video
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            ) : item.value ? (
                              item.value
                            ) : (
                              <span className="text-gray-400 italic">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </AnimatedSection>
      </section>
    </PageTransition>
  );
}
