import { redirect } from "next/navigation";

export default function AdminRegistrationsPage() {
  redirect("/people/users?tab=registrations");
}
