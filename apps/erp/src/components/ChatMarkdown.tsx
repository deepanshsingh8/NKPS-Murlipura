"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Assistant replies, rendered as markdown.
 *
 * The model writes markdown — bold figures, GFM tables for class-wise
 * breakdowns, bullet lists for caveats — because that is what it produces
 * naturally and what reads best. Before this, both ask surfaces printed the
 * reply inside `whitespace-pre-wrap`, so a breakdown of fifteen classes
 * reached the user as fifteen lines of raw pipe characters.
 *
 * ── Two node types are deliberately NOT rendered ────────────────────────────
 * Student records reach the model as tool results, and a student's own name is
 * free text somebody typed into the ERP. A pupil recorded as
 * `[click here](http://…)` would otherwise become a live link in the office's
 * browser, and a markdown image would fire an outbound request — with whatever
 * the URL carried — the moment the answer painted.
 *
 * Neither adds anything here: the assistant answers with counts, names and
 * tables, and never has cause to link out. So links render as plain text and
 * images are dropped. react-markdown ignores raw HTML unless rehype-raw is
 * added, which is why that is not a third case.
 *
 * ── The one exception: `allowedPaths` ───────────────────────────────────────
 * The in-app guide DOES have cause to link — "open Students" should be
 * clickable. It gets a narrower rule rather than a looser one: a link renders
 * only when its href exactly matches a path the caller passes in, which comes
 * from the screen registry. Anything else, including every absolute URL, stays
 * plain text. So the set of linkable destinations is a checked-in list, not
 * whatever the model wrote, and that stays true even if the guide is later
 * given a tool that can return text somebody else typed.
 */
export function ChatMarkdown({
  children,
  allowedPaths,
}: {
  children: string;
  allowedPaths?: readonly string[];
}) {
  const linkable = new Set(allowedPaths ?? []);

  return (
    <div className="ai-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Wide tables scroll inside the bubble rather than pushing the
          // whole page sideways.
          table: ({ children: cells }) => (
            <div className="ai-prose-scroll">
              <table>{cells}</table>
            </div>
          ),
          a: ({ href, children: label }) =>
            href && linkable.has(href) ? (
              <Link href={href} className="underline underline-offset-2">
                {label}
              </Link>
            ) : (
              <span>{label}</span>
            ),
          img: () => null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
