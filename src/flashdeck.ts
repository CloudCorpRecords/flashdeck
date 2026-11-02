/**
 * flashdeck core: AnkiConnect client and tool logic.
 *
 * Every tool talks to a local Anki instance through AnkiConnect:
 * POST JSON {action, version: 6, params} to ANKICONNECT_URL
 * (default http://127.0.0.1:8765). The envelope is {result, error};
 * a non-null error is surfaced as an error, and a failed fetch is
 * surfaced honestly with its underlying message. All network access
 * goes through an injectable FetchFn so tests use fakes only.
 *
 * Local logic (no invented AnkiConnect actions):
 * - deckStats / collection_stats: per-state findCards counts computed
 *   locally from is:new / is:learn / is:review / is:suspended /
 *   is:buried queries.
 * - get_due_cards / get_cards: findCards + cardsInfo shaping.
 * - present_card: cardsInfo for one card, front/question shaping.
 * - createDeck: deck name validated locally (Parent::Child, max 2 levels).
 * - addNotes: batch capped at 100 locally.
 * - deleteNotes: refused locally without confirm=true.
 * - rate_card: posts action "answerCard" — flagged in BUILD-REPORT as
 *   an unverified mapping (AnkiConnect action-name drift risk), to be
 *   checked first at live smoke.
 */
import type { ClientOptions, FetchFn } from "./types.js";

export const VERSION = "0.1.0";
export const DEFAULT_ANKICONNECT_URL = "http://127.0.0.1:8765";

export function ankiConnectUrl(opts?: ClientOptions): string {
  if (opts?.url) return opts.url;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.ANKICONNECT_URL || DEFAULT_ANKICONNECT_URL;
}

const defaultFetch: FetchFn = (url, init) =>
  (globalThis as { fetch: FetchFn }).fetch(url, init) as ReturnType<FetchFn>;

export async function ankiInvoke<T = unknown>(
  action: string,
  params: Record<string, unknown> = {},
  opts: ClientOptions = {},
): Promise<T> {
  const fetchFn = opts.fetchFn ?? defaultFetch;
  const url = ankiConnectUrl(opts);
  let res: Awaited<ReturnType<FetchFn>>;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
    });
  } catch (err) {
    throw new Error(
      `AnkiConnect request failed (${action} -> ${url}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let envelope: { result?: unknown; error?: unknown };
  try {
    envelope = (await res.json()) as { result?: unknown; error?: unknown };
  } catch (err) {
    throw new Error(
      `AnkiConnect response was not valid JSON (${action}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (envelope.error !== null && envelope.error !== undefined) {
    throw new Error(`AnkiConnect error (${action}): ${String(envelope.error)}`);
  }
  return envelope.result as T;
}

export function validateDeckName(deck: string): string {
  const name = typeof deck === "string" ? deck.trim() : "";
  if (!name) throw new Error("Invalid deck name: '' (deck name must not be empty)");
  const parts = name.split("::").map((p) => p.trim());
  if (parts.some((p) => !p)) throw new Error(`Invalid deck name: '${deck}' (empty level)`);
  if (parts.length > 2) {
    throw new Error(`Invalid deck name: '${deck}' (max 2 levels, Parent::Child)`);
  }
  return parts.join("::");
}

export function deckClause(deck?: string): string {
  if (!deck) return "";
  const escaped = deck.replace(/"/g, '\\"');
  return ` deck:"${escaped}"`;
}

export function stateQuery(state?: string): string {
  if (!state) return "";
  const map: Record<string, string> = {
    due: "is:due",
    new: "is:new",
    learning: "is:learn",
    suspended: "is:suspended",
    buried: "is:buried",
    review: "is:review",
    learn: "is:learn",
  };
  const q = map[state.toLowerCase()];
  if (!q) throw new Error(`Invalid card state: '${state}' (expected due/new/learning/suspended/buried)`);
  return q;
}

function shapeCards(cards: unknown, includeAnswer?: boolean): unknown {
  if (!Array.isArray(cards)) return cards;
  if (includeAnswer) return cards;
  return cards.map((c) => {
    if (c && typeof c === "object") {
      const copy: Record<string, unknown> = { ...(c as Record<string, unknown>) };
      delete copy.answer;
      // cardsInfo exposes fields; drop an Answer field value when present.
      const fields = copy.fields as Record<string, { value?: unknown }> | undefined;
      if (fields && typeof fields === "object") {
        const fcopy: Record<string, unknown> = { ...fields };
        delete fcopy.Answer;
        delete fcopy.Back;
        copy.fields = fcopy;
      }
      return copy;
    }
    return c;
  });
}

async function findAndInfo(query: string, includeAnswer: boolean | undefined, opts: ClientOptions): Promise<unknown> {
  const ids = await ankiInvoke<number[]>("findCards", { query }, opts);
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const cards = await ankiInvoke("cardsInfo", { cards: ids }, opts);
  return shapeCards(cards, includeAnswer);
}

// --- Tools ---------------------------------------------------------------

export async function sync(opts: ClientOptions = {}): Promise<unknown> {
  return ankiInvoke("sync", {}, opts);
}

export async function getDueCards(args: { deck?: string; include_answer?: boolean }, opts: ClientOptions = {}): Promise<unknown> {
  const query = `is:due${deckClause(args.deck)}`;
  return findAndInfo(query, args.include_answer, opts);
}

export async function getCards(args: { deck?: string; state?: string; include_answer?: boolean }, opts: ClientOptions = {}): Promise<unknown> {
  const sq = stateQuery(args.state);
  const query = `${sq}${deckClause(args.deck)}`.trim() || "*";
  return findAndInfo(query, args.include_answer, opts);
}

export async function presentCard(args: { card_id: number }, opts: ClientOptions = {}): Promise<unknown> {
  const cards = await ankiInvoke<Record<string, unknown>[]>("cardsInfo", { cards: [args.card_id] }, opts);
  if (!Array.isArray(cards) || cards.length === 0) throw new Error(`Card not found: ${args.card_id}`);
  const card = cards[0];
  const fields = (card.fields ?? {}) as Record<string, { value?: unknown }>;
  const front = fields.Front?.value ?? fields.Question?.value ?? card.question ?? card.front ?? null;
  return { card_id: args.card_id, cardId: card.cardId ?? args.card_id, question: front, front, fields, deckName: card.deckName ?? null, modelName: card.modelName ?? null };
}

export async function rateCard(args: { card_id: number; ease: number }, opts: ClientOptions = {}): Promise<unknown> {
  if (![1, 2, 3, 4].includes(args.ease)) throw new Error(`Invalid ease: ${args.ease} (expected 1-4: Again/Hard/Good/Easy)`);
  // Unverified mapping — see header note and BUILD-REPORT.
  return ankiInvoke("answerCard", { cardId: args.card_id, ease: args.ease }, opts);
}

export async function listDecks(args: { include_stats?: boolean } = {}, opts: ClientOptions = {}): Promise<unknown> {
  const decks = await ankiInvoke<string[]>("deckNames", {}, opts);
  if (!args.include_stats) return decks;
  const withStats: Record<string, unknown>[] = [];
  for (const deck of decks as string[]) {
    const stats = await deckStats({ deck }, opts);
    withStats.push({ deck, stats });
  }
  return withStats;
}

const STAT_STATES: Array<[string, string]> = [
  ["new", "is:new"],
  ["learning", "is:learn"],
  ["review", "is:review"],
  ["suspended", "is:suspended"],
  ["buried", "is:buried"],
];

export async function deckStats(args: { deck: string }, opts: ClientOptions = {}): Promise<Record<string, unknown>> {
  const deck = validateDeckName(args.deck);
  const counts: Record<string, number> = {};
  let total = 0;
  for (const [label, q] of STAT_STATES) {
    const ids = await ankiInvoke<number[]>("findCards", { query: `${q}${deckClause(deck)}` }, opts);
    const n = Array.isArray(ids) ? ids.length : 0;
    counts[label] = n;
    total += n;
  }
  const dueIds = await ankiInvoke<number[]>("findCards", { query: `is:due${deckClause(deck)}` }, opts);
  counts.due = Array.isArray(dueIds) ? dueIds.length : 0;
  return { deck, total, ...counts };
}

export async function createDeck(args: { deck: string }, opts: ClientOptions = {}): Promise<unknown> {
  const deck = validateDeckName(args.deck);
  return ankiInvoke("createDeck", { deck }, opts);
}

export async function addNote(
  args: { deck_name: string; model_name: string; fields: Record<string, unknown>; tags?: string[] },
  opts: ClientOptions = {},
): Promise<unknown> {
  return ankiInvoke("addNote", {
    note: { deckName: args.deck_name, modelName: args.model_name, fields: args.fields, tags: args.tags ?? [] },
  }, opts);
}

export async function addNotes(
  args: { deck_name: string; model_name: string; notes: Record<string, unknown>[] },
  opts: ClientOptions = {},
): Promise<unknown> {
  if (!Array.isArray(args.notes)) throw new Error("Invalid notes: expected an array");
  if (args.notes.length > 100) throw new Error(`Too many notes: ${args.notes.length} (max 100 per batch)`);
  const notes = args.notes.map((n) => {
    const rec = n as Record<string, unknown>;
    const fields = (rec.fields && typeof rec.fields === "object" ? rec.fields : rec) as Record<string, unknown>;
    const tags = Array.isArray(rec.tags) ? (rec.tags as string[]) : [];
    return { deckName: args.deck_name, modelName: args.model_name, fields, tags };
  });
  return ankiInvoke("addNotes", { notes }, opts);
}

export async function findNotes(args: { query: string }, opts: ClientOptions = {}): Promise<unknown> {
  return ankiInvoke("findNotes", { query: args.query }, opts);
}

export async function notesInfo(args: { notes: number[] }, opts: ClientOptions = {}): Promise<unknown> {
  return ankiInvoke("notesInfo", { notes: args.notes }, opts);
}

export async function updateNoteFields(args: { note_id: number; fields: Record<string, unknown> }, opts: ClientOptions = {}): Promise<unknown> {
  return ankiInvoke("updateNoteFields", { note: { id: args.note_id, fields: args.fields } }, opts);
}

export async function deleteNotes(args: { notes: number[]; confirm?: boolean }, opts: ClientOptions = {}): Promise<unknown> {
  if (args.confirm !== true) {
    throw new Error("Refusing to delete notes without confirm=true (confirmation required)");
  }
  return ankiInvoke("deleteNotes", { notes: args.notes }, opts);
}

export async function getTags(opts: ClientOptions = {}): Promise<unknown> {
  return ankiInvoke("getTags", {}, opts);
}

export async function addTags(args: { notes: number[]; tags: string }, opts: ClientOptions = {}): Promise<unknown> {
  return ankiInvoke("addTags", { notes: args.notes, tags: args.tags }, opts);
}

export async function removeTags(args: { notes: number[]; tags: string }, opts: ClientOptions = {}): Promise<unknown> {
  return ankiInvoke("removeTags", { notes: args.notes, tags: args.tags }, opts);
}

export async function modelNames(opts: ClientOptions = {}): Promise<unknown> {
  return ankiInvoke("modelNames", {}, opts);
}

export async function modelFieldNames(args: { model_name: string }, opts: ClientOptions = {}): Promise<unknown> {
  return ankiInvoke("modelFieldNames", { modelName: args.model_name }, opts);
}

export async function collectionStats(opts: ClientOptions = {}): Promise<Record<string, unknown>> {
  const decks = await ankiInvoke<string[]>("deckNames", {}, opts);
  const counts: Record<string, number> = {};
  let total = 0;
  for (const [label, q] of STAT_STATES) {
    const ids = await ankiInvoke<number[]>("findCards", { query: q }, opts);
    const n = Array.isArray(ids) ? ids.length : 0;
    counts[label] = n;
    total += n;
  }
  const dueIds = await ankiInvoke<number[]>("findCards", { query: "is:due" }, opts);
  counts.due = Array.isArray(dueIds) ? dueIds.length : 0;
  return { decks: Array.isArray(decks) ? decks.length : 0, deck_names: decks, total, ...counts };
}

export async function checkConnection(opts: ClientOptions = {}): Promise<{ ok: boolean; url: string; decks?: unknown; error?: string }> {
  const url = ankiConnectUrl(opts);
  try {
    const decks = await ankiInvoke("deckNames", {}, opts);
    return { ok: true, url, decks };
  } catch (err) {
    return { ok: false, url, error: err instanceof Error ? err.message : String(err) };
  }
}
