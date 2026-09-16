/** Yhteydenottojen (0095) nimet, tilat ja lomakkeen tarkistus. Ei palvelinriippuvuuksia. */
import { z } from "zod";

export const CONTACT_TOPICS = ["general", "charges", "renovation", "maintenance", "documents", "other"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export const CONTACT_TOPIC_LABEL: Record<ContactTopic, string> = {
  general: "Yleinen kysymys",
  charges: "Vastikkeet ja maksut",
  renovation: "Remontti tai muutostyö",
  maintenance: "Kiinteistö ja kunnossapito",
  documents: "Asiakirjat ja todistukset",
  other: "Muu asia",
};

export const CONTACT_STATUSES = ["open", "answered", "closed"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

type Tone = "neutral" | "info" | "ok" | "warn" | "alert";

/** Henkilökunnan näkökulma: avoin odottaa vastausta. */
export const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = { open: "Odottaa vastausta", answered: "Vastattu", closed: "Käsitelty" };
export const CONTACT_STATUS_TONE: Record<ContactStatus, Tone> = { open: "alert", answered: "info", closed: "neutral" };
/** Portaalin näkökulma: avoin on lähetetty isännöinnille. */
export const CONTACT_STATUS_LABEL_PORTAL: Record<ContactStatus, string> = { open: "Lähetetty", answered: "Isännöinti vastasi", closed: "Käsitelty" };
export const CONTACT_STATUS_TONE_PORTAL: Record<ContactStatus, Tone> = { open: "neutral", answered: "ok", closed: "neutral" };

export const MAX_CONTACT_BODY = 5000;
export const MAX_CONTACT_ATTACHMENTS = 5;

const trimmed = (max: number, min: number, message: string) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string({ message }).min(min, message).max(max, `Enintään ${max} merkkiä.`));

/** Portaalin uusi yhteydenotto. `target` on "yhtio:<id>" tai "huoneisto:<id>". */
export const newContactSchema = z.object({
  target: z.string().regex(/^(yhtio|huoneisto):[0-9a-f-]{36}$/i, "Valitse, mitä yhteydenotto koskee."),
  topic: z.enum(CONTACT_TOPICS, { message: "Valitse aihe." }),
  subject: trimmed(200, 3, "Kirjoita otsikko (vähintään 3 merkkiä)."),
  body: trimmed(MAX_CONTACT_BODY, 1, "Kirjoita viesti."),
});

export const replySchema = z.object({
  thread_id: z.string().uuid(),
  body: trimmed(MAX_CONTACT_BODY, 1, "Kirjoita viesti."),
});

export function parseTarget(target: string): { kind: "company" | "unit"; id: string } {
  const [kind, id] = target.split(":");
  return { kind: kind === "huoneisto" ? "unit" : "company", id };
}
