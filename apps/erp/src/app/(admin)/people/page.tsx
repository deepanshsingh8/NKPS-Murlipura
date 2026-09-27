import { redirect } from "next/navigation";

/**
 * The People hub was a page of tiles duplicating the sidebar's own People list
 * — and it had drifted, listing three destinations when the menu had five.
 * A hub that repeats the menu next to it earns its place only while it says
 * something the menu cannot.
 *
 * Kept as a redirect because it was a nav entry, so it will be in bookmarks.
 */
export default function AdminPeopleHubPage() {
  redirect("/people/students");
}
