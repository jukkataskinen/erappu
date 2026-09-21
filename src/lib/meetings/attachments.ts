import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isGeneralMeeting } from "./labels";

/**
 * Pykälän liitteet (0112). Liite on yhtiön dokumentti, joka kytketään
 * asialistan kohtaan. Tunnus "Liite 3.1" = pykälän numero ja liitteen
 * järjestysnumero pykälän sisällä; se lasketaan aina uudelleen, joten
 * asioiden siirto ja liitteen poisto pitävät numeroinnin yhtenäisenä.
 */

export function attachmentLabel(itemPosition: number, index: number): string {
  return `Liite ${itemPosition}.${index}`;
}

/** Kokouksessa ladatun liitteen näkyvyys: sama kuin kokouksen esityslistalla. */
export function attachmentVisibility(meetingKind: string): "owners" | "board" {
  return isGeneralMeeting(meetingKind) ? "owners" : "board";
}

export class AttachmentError extends Error {}

/** Liitteitä voi muuttaa, kunnes pöytäkirja on allekirjoitettu tai kokous peruttu. */
export const ATTACHMENTS_EDITABLE = ["draft", "notice_sent", "held"] as const;

export interface ItemAttachment {
  id: string;
  item_id: string;
  document_id: string;
  item_position: number;
  index: number;
  label: string;
  /** Tyhjä, jos katsoja ei saa nähdä dokumenttia (dokumentin näkyvyys). */
  title: string | null;
  mime_type: string | null;
  visibility: string | null;
}

export async function listItemAttachments(tx: Sql, meetingIds: string | string[]): Promise<ItemAttachment[]> {
  const ids = Array.isArray(meetingIds) ? meetingIds : [meetingIds];
  if (ids.length === 0) return [];
  const rows = await tx.query<Omit<ItemAttachment, "label" | "index"> & { index: string | number }>(
    `select a.id, a.item_id, a.document_id, i.position as item_position,
            row_number() over (partition by a.item_id order by a.position, a.created_at) as index,
            d.title, d.mime_type, d.visibility
       from er_meeting_item_attachments a
       join er_meeting_items i on i.id = a.item_id
       left join er_documents d on d.id = a.document_id
      where a.meeting_id = any($1::uuid[])
      order by i.position, a.position, a.created_at`,
    [ids],
  );
  return rows.map((r) => {
    const index = Number(r.index);
    return { ...r, index, label: attachmentLabel(r.item_position, index) };
  });
}

/** Ryhmittely pykälittäin (item_id → liitteet). */
export function byItem(attachments: ItemAttachment[]): Map<string, ItemAttachment[]> {
  const map = new Map<string, ItemAttachment[]>();
  for (const a of attachments) map.set(a.item_id, [...(map.get(a.item_id) ?? []), a]);
  return map;
}

async function editableItem(tx: Sql, meetingId: string, itemId: string) {
  const [row] = await tx.query<{ organization_id: string; company_id: string; kind: string; status: string }>(
    `select m.organization_id, m.company_id, m.kind, m.status
       from er_meeting_items i join er_meetings m on m.id = i.meeting_id
      where i.id = $2 and m.id = $1`,
    [meetingId, itemId],
  );
  if (!row) throw new AttachmentError("Asiaa ei löytynyt.");
  if (!(ATTACHMENTS_EDITABLE as readonly string[]).includes(row.status)) {
    throw new AttachmentError("Liitteitä ei voi enää muuttaa, koska pöytäkirja on allekirjoitettu tai kokous on peruttu.");
  }
  return row;
}

/** Kokouksen tiedot uuden liitteen tallennusta varten (tarkistaa myös, että liitteitä saa muuttaa). */
export async function attachmentTarget(tx: Sql, meetingId: string, itemId: string) {
  return editableItem(tx, meetingId, itemId);
}

export async function attachDocument(tx: Sql, input: { meetingId: string; itemId: string; documentId: string; userId: string }): Promise<string> {
  const item = await editableItem(tx, input.meetingId, input.itemId);
  const [doc] = await tx.query<{ id: string }>("select id from er_documents where id = $1 and company_id = $2", [input.documentId, item.company_id]);
  if (!doc) throw new AttachmentError("Dokumenttia ei löytynyt tämän yhtiön dokumenteista.");
  const [existing] = await tx.query("select id from er_meeting_item_attachments where item_id = $1 and document_id = $2", [input.itemId, input.documentId]);
  if (existing) throw new AttachmentError("Dokumentti on jo tämän asian liitteenä.");
  const [row] = await tx.query<{ id: string }>(
    `insert into er_meeting_item_attachments (organization_id, meeting_id, item_id, document_id, position, created_by)
     values ($1, $2, $3, $4, coalesce((select max(position) from er_meeting_item_attachments where item_id = $3), 0) + 1, $5)
     returning id`,
    [item.organization_id, input.meetingId, input.itemId, input.documentId, input.userId],
  );
  await audit(tx, {
    organizationId: item.organization_id, userId: input.userId, action: "attach", entity: "meeting_item", entityId: input.itemId,
    details: { document_id: input.documentId },
  });
  return row.id;
}

/** Poistaa liitteen asialta. Dokumentti jää yhtiön dokumentteihin. */
export async function removeAttachment(tx: Sql, input: { meetingId: string; attachmentId: string; userId: string }): Promise<boolean> {
  const [a] = await tx.query<{ item_id: string; document_id: string }>(
    "select item_id, document_id from er_meeting_item_attachments where id = $1 and meeting_id = $2",
    [input.attachmentId, input.meetingId],
  );
  if (!a) return false;
  const item = await editableItem(tx, input.meetingId, a.item_id);
  await tx.query("delete from er_meeting_item_attachments where id = $1", [input.attachmentId]);
  await audit(tx, {
    organizationId: item.organization_id, userId: input.userId, action: "detach", entity: "meeting_item", entityId: a.item_id,
    details: { document_id: a.document_id },
  });
  return true;
}

/** Yhtiön dokumentit, joista liitteen voi valita (uusimmat ensin, ilman kokousten omia asiakirjoja). */
export async function listAttachableDocuments(tx: Sql, companyId: string) {
  return tx.query<{ id: string; title: string; category: string; created_at: string }>(
    `select id, title, category, created_at from er_documents
      where company_id = $1 and share_group_id is null and coalesce(subject_table, '') <> 'er_meetings'
        and category not in ('photo')
      order by created_at desc limit 200`,
    [companyId],
  );
}
