import { redirect } from "next/navigation";

export default function AdminRegistrationsPage() {
  redirect("/administration/users?tab=registrations");
}
