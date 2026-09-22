import type { Metadata } from "next";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/Shell";

/**
 * erappu.fi:n julkiset markkinointisivut. Sovellus on hakukoneilta piilossa
 * (juurilayoutin robots: noindex), mutta nämä sivut indeksoidaan.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://www.erappu.fi"),
  title: { default: "eRappu – selkeää ja läpinäkyvää isännöintiä", template: "%s | eRappu" },
  description:
    "eRappu kokoaa taloyhtiön asiat yhteen: kokoukset ja sähköiset allekirjoitukset, isännöitsijäntodistukset, vuosikello, huoltopyynnöt ja asukasportaali.",
  robots: { index: true, follow: true },
  openGraph: { type: "website", locale: "fi_FI", siteName: "eRappu" },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-[17px] leading-[1.65] md:text-[18px]">
      <MarketingHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
