/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Osakasluettelo ja ääniluettelo yhtiökokousta varten.
 *
 * Sama asiakirja kahdessa tilassa: osakasluettelo kokouksen alkuun
 * (kaikki osakkaat, osakkeet ja täydet äänet) ja ääniluettelo kokouksessa
 * vahvistettavaksi (läsnä ja edustettuina olevat, äänet AOYL 6:13 §:n
 * leikkurin jälkeen). Ei henkilötunnuksia eikä osoitteita.
 */

import { Page, Text, View } from "@react-pdf/renderer";
import { DataTable, DocumentFooter, DocumentHeader, DocumentRoot, KeyValues, Muted, pageStyle } from "./components";
import { formatDate, formatInteger, formatMeetingTime } from "./format";
import { type as typeScale, weight } from "./theme";

export interface VotingListRow {
  name: string;
  proxyName: string | null;
  units: string;
  shares: number;
  fullVotes: number;
  votes: number;
  present: boolean;
  remote: boolean;
  capped: boolean;
}

export interface VotingListData {
  mode: "shareholders" | "votes";
  organizationName: string;
  companyName: string;
  meetingTitle: string;
  startsAt: string;
  issuedOn: string;
  rows: VotingListRow[];
  totalShares: number | null;
  representedShares: number;
  representedVotes: number;
  totalVotes: number;
  cap: number | null;
}

export function VotingList({ data }: { data: VotingListData }) {
  const votesMode = data.mode === "votes";
  const title = votesMode ? "Ääniluettelo" : "Osakasluettelo";
  const rows = (votesMode ? data.rows.filter((r) => r.present) : data.rows).map((r) => ({
    name: r.proxyName ? `${r.name} (asiamies ${r.proxyName})` : r.name,
    units: r.units,
    shares: formatInteger(r.shares),
    fullVotes: formatInteger(r.fullVotes),
    votes: `${formatInteger(r.votes)}${r.capped ? " *" : ""}`,
    presence: r.present ? (r.remote ? "etänä" : "läsnä") : "",
  }));

  const columns = votesMode
    ? [
        { key: "name", label: "Osakas", flex: 3 },
        { key: "units", label: "Huoneistot", flex: 1.4 },
        { key: "presence", label: "Osallistuminen", flex: 1.1 },
        { key: "shares", label: "Osakkeet", flex: 0.9, align: "right" as const },
        { key: "votes", label: "Äänet", flex: 0.9, align: "right" as const },
      ]
    : [
        { key: "name", label: "Osakas", flex: 3 },
        { key: "units", label: "Huoneistot", flex: 1.6 },
        { key: "shares", label: "Osakkeet", flex: 1, align: "right" as const },
        { key: "fullVotes", label: "Äänet", flex: 1, align: "right" as const },
      ];

  return (
    <DocumentRoot title={title} subject={data.companyName} date={data.issuedOn}>
      <Page size="A4" style={pageStyle}>
        <DocumentHeader right={data.companyName} />
        <Text style={{ fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.25 }}>{title}</Text>
        <Muted style={{ marginTop: 3 }}>
          {data.meetingTitle}, {formatMeetingTime(data.startsAt)}
        </Muted>

        <KeyValues
          columns={3}
          items={
            votesMode
              ? [
                  { label: "Edustetut osakkeet", value: formatInteger(data.representedShares) },
                  { label: "Äänet ennen leikkuria", value: formatInteger(data.representedVotes) },
                  { label: "Äänet leikkurin jälkeen", value: formatInteger(data.totalVotes) },
                  { label: "Enimmäisäänimäärä", value: data.cap === null ? "Ei rajoitusta" : `${formatInteger(data.cap)} (1/5)` },
                  { label: "Osakkeita yhtiössä", value: formatInteger(data.totalShares) },
                  { label: "Laadittu", value: formatDate(data.issuedOn) },
                ]
              : [
                  { label: "Osakkaita", value: formatInteger(data.rows.length) },
                  { label: "Osakkeita yhtiössä", value: formatInteger(data.totalShares) },
                  { label: "Laadittu", value: formatDate(data.issuedOn) },
                ]
          }
        />

        <DataTable columns={columns} rows={rows} emptyText={votesMode ? "Läsnäolijoita ei ole merkitty." : "Osakkaita ei ole rekisterissä."} />

        {votesMode ? (
          <View style={{ marginTop: 8 }}>
            <Muted>
              * Äänimäärä rajattu: kukaan ei voi äänestää yli viidesosalla kokouksessa edustettujen osakkeiden äänimäärästä (AOYL 6:13 §), ellei
              yhtiöjärjestyksessä toisin määrätä.
            </Muted>
          </View>
        ) : (
          <View style={{ marginTop: 8 }}>
            <Muted>Omistajatiedot tarkistetaan huoneistotietojärjestelmästä (HTJ).</Muted>
          </View>
        )}
        <DocumentFooter left={`${data.organizationName} · ${data.companyName}`} />
      </Page>
    </DocumentRoot>
  );
}
