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
      verifyUrl: "https://app.esinetti.fi/verify",
      legalBasis: "AOYL 7:27 §",
      order: { purpose: null, ordererName: null, withAttachments: false },
      company: {
        name: "As Oy Kuvitteellinen", businessId: "1234567-1", registeredOn: null, address: null, articlesDate: null, commercialRegisterNote: null,
        htjSynced: false, htjTransferredOn: null, boardChair: null, propertyMaintenance: null, totalShares: null, sharesApartments: 0, sharesOther: 0,
        vat: "Ei tiedossa", chargesDecidedBy: null, articlesMaintenanceClause: null, shareIssueAuthorization: null, articlesLawsuit: null, notes: null,
        shareCertificates: "–", energy: "–",
      },
      manager: { name: null, email: null, phone: null, office: "Isännöinti Testi Oy", officeAddress: null, officePhone: null },
      properties: [],
      buildingSummary: { count: "0", apartmentArea: "–", floorArea: "–", volume: "–", staircases: "–", elevators: "0" },
      buildings: [],
      spaces: [],
      parking: { built: null, hall: null, other: null, company: null, rules: null },
      asbestosNote: null,
      unit: {
        label: "A 1", kindLabel: "Asuinhuoneisto", shareRanges: "–", shareCount: 0, votes: null, areaM2: null, areaVerified: "Ei tiedossa", layout: null, floor: null,
        staircase: null, intendedUse: null, building: null, address: null, htjId: null, notes: null,
      },
      possession: { companyPossession: "Ei", companyRented: "Ei", widowRight: "Ei tiedossa", spousesCommonHome: "Ei tiedossa", otherRestrictions: null, shortTermRental: "–" },
      renovationNotices: [],
      renovationNoticesSince: null,
      finance: { charges: [], monthlyTotal: null, priceList: [], loans: [], creditLimits: [], loanShare: [], paymentStatus: null, mortgages: [], mortgagesTotal: null, insurances: [] },
      repairs: { needsReportOn: null, planOn: null, planSummary: null, decided: [], done: [], planned: [] },
      restrictions: [],
      attachments: [],
    };
    const pdf = await renderDocumentPdf(<ManagerCertificate data={data} />);
    expect(isPdf(pdf.bytes)).toBe(true);
    const withAttachments = await renderDocumentPdf(
      <ManagerCertificate
        data={{
          ...data,
          order: { purpose: "Pankkia varten", ordererName: "Testi Tilaaja", withAttachments: true },
          attachments: [
            { number: 1, key: "articles", label: "Yhtiöjärjestys", title: "YJ", dateText: "2008", pages: 4, status: "attached" },
            { number: 2, key: "budget", label: "Talousarvio", title: null, dateText: null, pages: null, status: "missing" },
            { number: 3, key: "energy_certificate", label: "Energiatodistus", title: "ET", dateText: "2019", pages: null, status: "failed", reason: "suojattu PDF" },
          ],
        }}
      />,
    );
    expect(isPdf(withAttachments.bytes)).toBe(true);
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
