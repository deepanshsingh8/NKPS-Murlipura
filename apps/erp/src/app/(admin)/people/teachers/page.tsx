import { redirect } from "next/navigation";

/**
 * Teacher records now live on the Staff page's Teachers tab — one person, one
 * row, rather than a staff profile here and an assignment record there under a
 * second menu entry also called "Teachers".
 *
 * The route is kept as a redirect rather than deleted: it was in the sidebar,
 * so it will be in bookmarks and in the browser history of everyone who used
 * it. No nav entry points here any more.
 */
export default function AdminTeachersPage() {
  redirect("/people/staff?group=teaching");
}
