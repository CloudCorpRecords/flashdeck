#!/usr/bin/env node
/**
 * flashdeck CLI.
 *   flashdeck check [--json]
 *   flashdeck decks [--json]
 *   flashdeck due [deck] [--json]
 *   flashdeck stats [deck] [--json]
 *   flashdeck tags [--json]
 *   flashdeck models [--json]
 *   flashdeck sync [--json]
 *   flashdeck mcp
 *   flashdeck --version
 * Exit codes: 0 success, 1 error, 2 usage error.
 */
import {
  VERSION,
  checkConnection,
  collectionStats,
  deckStats,
  getDueCards,
  getTags,
  listDecks,
  modelNames,
  sync,
} from "./flashdeck.js";

function usage(): never {
  console.error(`Usage:
  flashdeck check [--json]
  flashdeck decks [--json]
  flashdeck due [deck] [--json]
  flashdeck stats [deck] [--json]
  flashdeck tags [--json]
  flashdeck models [--json]
  flashdeck sync [--json]
  flashdeck mcp
  flashdeck --version`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") { console.log(VERSION); return; }
  if (cmd === "mcp") { await import("./mcp.js"); return; }
  if (!cmd) usage();
  const asJson = rest.includes("--json");
  const args = rest.filter((a) => a !== "--json");
  const out = (v: unknown) => {
    if (asJson) console.log(JSON.stringify(v, null, 2));
    else console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  };
  try {
    if (cmd === "check") { const r = await checkConnection(); out(r); if (!r.ok) process.exit(1); }
    else if (cmd === "decks") out(await listDecks({}));
    else if (cmd === "due") out(await getDueCards({ deck: args[0] }));
    else if (cmd === "stats") out(args[0] ? await deckStats({ deck: args[0] }) : await collectionStats());
    else if (cmd === "tags") out(await getTags());
    else if (cmd === "models") out(await modelNames());
    else if (cmd === "sync") out(await sync());
    else usage();
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
void main();
