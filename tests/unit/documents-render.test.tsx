/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { describe, expect, it } from "vitest";
import { renderDocumentPdf } from "@/documents/render";
import { MeetingNotice, type MeetingNoticeData } from "@/documents/MeetingNotice";
import { Minutes, type MinutesData } from "@/documents/Minutes";
import { VotingList } from "@/documents/VotingList";
import { ManagerCertificate, type ManagerCertificateData } from "@/documents/ManagerCertificate";
import { formatEuro, formatMeetingTime, formatDate } from "@/documents/format";

const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 4)).toString("latin1") === "%PDF";

const base: MeetingNoticeData = {
  organizationName: "Isännöinti Testi Oy",
  companyName: "As Oy Kuvitteellinen",
  companyBusinessId: "1234567-1",
  companyAddress: "Testikatu 1, 41660 Toivakka",
  kind: "annual_general",
  startsAt: "2027-04-14T15:00:00.000Z",
  location: "Kerhohuone",
  remoteParticipation: true,
  remoteUrl: "https://example.test/kokous",
  fiscalYear: "2026",
  items: [
    { position: 1, title: "Kokouksen avaus", proposal: "Puheenjohtaja avaa kokouksen.", decision: "Avattiin klo 18.02." },
    { position: 2, title: "Kokouksen järjestäytyminen", proposal: null, decision: null },
  ],
  manager: { name: "Isa Isännöitsijä", email: "isa@example.test", phone: null },
  issuedOn: "2027-03-20",
  attachmentsNote: "Tilinpäätös ja talousarvio ovat nähtävillä portaalissa.",
};

describe("asiakirjojen renderöinti", () => {
  it("kokouskutsu tuottaa PDF:n ja on deterministinen", async () => {
    const a = await renderDocumentPdf(<MeetingNotice data={base} />);
    const b = await renderDocumentPdf(<MeetingNotice data={base} />);
    expect(isPdf(a.bytes)).toBe(true);
    expect(a.sha256).toBe(b.sha256);
  });

  it("kokouskutsu ja pöytäkirja eivät kaadu tyhjillä kentillä", async () => {
    const empty: MinutesData = {
      ...base,
      kind: "board",
      companyBusinessId: null,
      companyAddress: null,
      location: null,
      remoteParticipation: false,
      remoteUrl: null,
      fiscalYear: null,
      items: [],
      manager: null,
      attachmentsNote: null,
      chairName: null,
      secretaryName: null,
      checkerNames: [],
      attendance: { presentCount: 0, representedShares: 0, totalVotes: 0, totalShares: null, names: [] },
    } as MinutesData;
    expect(isPdf((await renderDocumentPdf(<MeetingNotice data={{ ...empty, attachmentsNote: null }} />)).bytes)).toBe(true);
    expect(isPdf((await renderDocumentPdf(<Minutes data={empty} />)).bytes)).toBe(true);
  });

  it("ääniluettelo ja osakasluettelo", async () => {
    const data = {
      mode: "votes" as const,
      organizationName: "Isännöinti Testi Oy",
      companyName: "As Oy Kuvitteellinen",
      meetingTitle: "Varsinainen yhtiökokous",
      startsAt: base.startsAt,
      issuedOn: "2027-04-14",
      rows: [
        { name: "Osakas Yksi", proxyName: null, units: "A 1", shares: 500, fullVotes: 500, votes: 200, present: true, remote: false, capped: true },
        { name: "Osakas Kaksi", proxyName: "Asiamies", units: "A 2", shares: 500, fullVotes: 500, votes: 200, present: false, remote: false, capped: false },
      ],
      totalShares: 1000,
      representedShares: 500,
      representedVotes: 500,
      totalVotes: 100,
      cap: 100,
    };
    expect(isPdf((await renderDocumentPdf(<VotingList data={data} />)).bytes)).toBe(true);
    expect(isPdf((await renderDocumentPdf(<VotingList data={{ ...data, mode: "shareholders", rows: [] }} />)).bytes)).toBe(true);
  });

  it("isännöitsijäntodistus tyhjillä tiedoilla", async () => {
    const data: ManagerCertificateData = {
      approved: false,
      organizationName: "Isännöinti Testi Oy",
      issuedOn: "2026-09-15",
      verifyUrl: "https://erappu.fi/tarkista/luonnos",
      company: {
        name: "As Oy Kuvitteellinen", businessId: "1234567-1", address: null, propertyCodes: [], articlesDate: null, tenure: null, lessor: null,
        leaseEndsOn: null, propertyArea: null, insurance: null, propertyMaintenance: null, apartmentCount: 0, commercialCount: 0,
        apartmentAreaM2: 0, commercialAreaM2: 0, parkingSpaces: null, totalShares: null, htjSynced: false, commonSpaces: [],
      },
      buildings: [],
      unit: { label: "A 1", kindLabel: "Asuinhuoneisto", shareRanges: "–", shareCount: 0, areaM2: null, layout: null, floor: null, intendedUse: null, building: null },
      finance: { charges: [], monthlyTotal: null, loans: [], loanShare: [], paymentStatus: null },
      repairs: { done: [], planned: [] },
      restrictions: [],
      manager: { name: null, email: null, phone: null },
    };
    const pdf = await renderDocumentPdf(<ManagerCertificate data={data} />);
    expect(isPdf(pdf.bytes)).toBe(true);
  });
});

describe("asiakirjojen muotoilut", () => {
  it("euro ja päivä ilman kapeita välilyöntejä", () => {
    expect(formatEuro(1250.5)).toBe("1 250,50 €");
    expect(formatEuro(120)).toBe("120 €");
    expect(formatDate("2026-09-01")).toBe("1.9.2026");
    expect(formatMeetingTime("2027-04-14T15:00:00.000Z")).toBe("keskiviikko 14.4.2027 klo 18.00");
  });
});
