import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { CertificatesView } from "./CertificatesView";

export const metadata = { title: "Isännöitsijäntodistukset" };

export default async function CertificatesPage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { virhe } = await searchParams;
  return (
    <CertificatesView
      ctx={ctx}
      virhe={virhe}
      basePath="/todistukset"
      header={<PageHeader title="Isännöitsijäntodistukset" subtitle="Tilaukset ja todistukset kaikista taloyhtiöistä" back={{ href: "/kokoukset", label: "Kokoukset" }} />}
    />
  );
}
