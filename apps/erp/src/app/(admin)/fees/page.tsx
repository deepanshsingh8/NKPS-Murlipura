import { redirect } from "next/navigation";

// /fees lands on Academic by default. Sidebar exposes Academic / Transport /
// Payments as sub-items, so visiting /fees directly should still feel like
// "the fees module" — we just pick the most common landing.
export default function FeesIndexPage() {
  redirect("/fees/academic");
}
