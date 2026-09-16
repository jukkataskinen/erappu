/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { ComponentType } from "react";
import type { RoomKey } from "@/lib/responsibility/content";
import { BalconyArt } from "./BalconyArt";
import { BathroomArt } from "./BathroomArt";
import { DoorsArt } from "./DoorsArt";
import { KitchenArt } from "./KitchenArt";
import { LivingRoomArt } from "./LivingRoomArt";
import { SaunaArt } from "./SaunaArt";
import { WindowsArt } from "./WindowsArt";
import { YardArt } from "./YardArt";

/** Jokainen kuva piirtää vain `<g>`-ryhmän viewBoxiin 0 0 1000 640; pisteet ovat omassa kerroksessaan. */
export const ROOM_ART: Record<RoomKey, ComponentType> = {
  keittio: KitchenArt,
  kylpyhuone: BathroomArt,
  ovet: DoorsArt,
  ikkunat: WindowsArt,
  sauna: SaunaArt,
  olohuone: LivingRoomArt,
  parveke: BalconyArt,
  piha: YardArt,
};
