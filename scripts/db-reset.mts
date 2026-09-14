import { rm } from "node:fs/promises";
import path from "node:path";
import { openLocalDb } from "./lib/local-db.mts";

/** Poistaa paikallisen kannan ja tiedostot ja ajaa migraatiot tyhjään kantaan. */
await rm(path.join(process.cwd(), ".data"), { recursive: true, force: true });
const db = await openLocalDb();
await db.close();
console.log("Paikallinen kanta tyhjennetty. Aja seuraavaksi npm run db:seed:demo tai npm run access:import.");
