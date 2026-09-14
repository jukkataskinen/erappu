import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/kirjaudu");
  if (user.memberships.length > 0) redirect("/tyopoyta");
  if (user.portal.length > 0) redirect("/portaali");
  redirect("/ei-oikeutta");
}
