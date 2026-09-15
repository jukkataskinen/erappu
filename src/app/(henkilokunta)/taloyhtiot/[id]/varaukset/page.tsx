import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { requireStaff } from "@/lib/auth/current-user";
import { BookingsView, type BookingsSearch } from "../../../varaukset/BookingsView";

export const metadata = { title: "Varaukset" };

export default async function CompanyBookingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<BookingsSearch> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const sp = await searchParams;
  return (
    <>
      <CompanyHeader company={company} active="varaukset" />
      <BookingsView ctx={ctx} sp={sp} fixedCompany={{ id: company.id, name: company.name }} />
    </>
  );
}
