import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { BookingsView, type BookingsSearch } from "./BookingsView";

export const metadata = { title: "Varaukset" };

export default async function BookingsPage({ searchParams }: { searchParams: Promise<BookingsSearch> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="Varaukset" subtitle="Saunat, pesutuvat ja kerhohuoneet. Osakkaat ja asukkaat varaavat vuorot portaalissa." />
      <BookingsView ctx={ctx} sp={sp} />
    </>
  );
}
