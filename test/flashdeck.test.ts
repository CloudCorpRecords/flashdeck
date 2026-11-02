import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addNote,
  addNotes,
  ankiInvoke,
  collectionStats,
  createDeck,
  deckStats,
  deleteNotes,
  findNotes,
  getDueCards,
  getCards,
  listDecks,
  modelFieldNames,
  presentCard,
  rateCard,
  sync,
  updateNoteFields,
  validateDeckName,
} from "../src/flashdeck.js";
import type { FetchFn } from "../src/types.js";

type Call = { action: string; version: number; params: Record<string, unknown> };

function fakeFetch(handler: (action: string, params: Record<string, unknown>) => unknown): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchFn = async (_url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Call;
    calls.push(body);
    const result = handler(body.action, body.params);
    return { ok: true, status: 200, json: async () => ({ result, error: null }) };
  };
  return { fetchFn, calls };
}

describe("envelope handling", () => {
  it("returns result on null error and posts version 6 envelope", async () => {
    const { fetchFn, calls } = fakeFetch(() => ["Default"]);
    const r = await ankiInvoke("deckNames", {}, { fetchFn, url: "http://x:8765" });
    assert.deepEqual(r, ["Default"]);
    assert.equal(calls[0].version, 6);
    assert.equal(calls[0].action, "deckNames");
  });
  it("surfaces non-null envelope error", async () => {
    const fetchFn: FetchFn = async () => ({ json: async () => ({ result: null, error: "deck not found" }) });
    await assert.rejects(() => ankiInvoke("deckNames", {}, { fetchFn }), /AnkiConnect error.*deck not found/);
  });
  it("surfaces failed fetch honestly", async () => {
    const fetchFn: FetchFn = async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:8765"); };
    await assert.rejects(() => ankiInvoke("deckNames", {}, { fetchFn }), /AnkiConnect request failed.*ECONNREFUSED/);
  });
  it("sync maps to sync action", async () => {
    const { fetchFn, calls } = fakeFetch(() => null);
    await sync({ fetchFn });
    assert.equal(calls[0].action, "sync");
  });
});

describe("action shaping", () => {
  it("addNote shapes note with deckName/modelName/fields/tags", async () => {
    const { fetchFn, calls } = fakeFetch(() => 123);
    const r = await addNote({ deck_name: "D", model_name: "Basic", fields: { Front: "q" }, tags: ["t"] }, { fetchFn });
    assert.equal(r, 123);
    assert.deepEqual(calls[0].params, { note: { deckName: "D", modelName: "Basic", fields: { Front: "q" }, tags: ["t"] } });
  });
  it("updateNoteFields shapes note id/fields", async () => {
    const { fetchFn, calls } = fakeFetch(() => null);
    await updateNoteFields({ note_id: 7, fields: { Front: "x" } }, { fetchFn });
    assert.equal(calls[0].action, "updateNoteFields");
    assert.deepEqual(calls[0].params, { note: { id: 7, fields: { Front: "x" } } });
  });
  it("findNotes passes query", async () => {
    const { fetchFn, calls } = fakeFetch(() => [1, 2]);
    assert.deepEqual(await findNotes({ query: "deck:Default" }, { fetchFn }), [1, 2]);
    assert.deepEqual(calls[0].params, { query: "deck:Default" });
  });
  it("modelFieldNames maps model_name to modelName", async () => {
    const { fetchFn, calls } = fakeFetch(() => ["Front", "Back"]);
    assert.deepEqual(await modelFieldNames({ model_name: "Basic" }, { fetchFn }), ["Front", "Back"]);
    assert.deepEqual(calls[0].params, { modelName: "Basic" });
  });
  it("rateCard posts answerCard with cardId/ease and validates ease", async () => {
    const { fetchFn, calls } = fakeFetch(() => true);
    await rateCard({ card_id: 42, ease: 3 }, { fetchFn });
    assert.equal(calls[0].action, "answerCard");
    assert.deepEqual(calls[0].params, { cardId: 42, ease: 3 });
    await assert.rejects(() => rateCard({ card_id: 1, ease: 9 }, { fetchFn }), /Invalid ease/);
  });
});

describe("deck validation", () => {
  it("accepts single and Parent::Child decks", () => {
    assert.equal(validateDeckName("Default"), "Default");
    assert.equal(validateDeckName("Parent::Child"), "Parent::Child");
  });
  it("rejects 3 levels and empty levels", () => {
    assert.throws(() => validateDeckName("A::B::C"), /max 2 levels/);
    assert.throws(() => validateDeckName(""), /must not be empty/);
    assert.throws(() => validateDeckName("A::"), /empty level/);
  });
  it("createDeck validates before calling AnkiConnect", async () => {
    const { fetchFn, calls } = fakeFetch(() => 1);
    await assert.rejects(() => createDeck({ deck: "A::B::C" }, { fetchFn }), /max 2 levels/);
    assert.equal(calls.length, 0);
    await createDeck({ deck: "New::Sub" }, { fetchFn });
    assert.deepEqual(calls[0].params, { deck: "New::Sub" });
  });
});

describe("batch cap and delete gate", () => {
  it("addNotes rejects >100 locally", async () => {
    const { fetchFn, calls } = fakeFetch(() => []);
    const notes = Array.from({ length: 101 }, (_, i) => ({ Front: String(i) }));
    await assert.rejects(() => addNotes({ deck_name: "D", model_name: "Basic", notes }, { fetchFn }), /max 100/);
    assert.equal(calls.length, 0);
  });
  it("addNotes shapes a valid batch", async () => {
    const { fetchFn, calls } = fakeFetch(() => [1, 2]);
    await addNotes({ deck_name: "D", model_name: "Basic", notes: [{ Front: "a" }, { Front: "b" }] }, { fetchFn });
    const sent = (calls[0].params as { notes: unknown[] }).notes;
    assert.equal(sent.length, 2);
  });
  it("deleteNotes refuses without confirm=true and calls with it", async () => {
    const { fetchFn, calls } = fakeFetch(() => null);
    await assert.rejects(() => deleteNotes({ notes: [1] }, { fetchFn }), /Refusing to delete/);
    assert.equal(calls.length, 0);
    await deleteNotes({ notes: [1], confirm: true }, { fetchFn });
    assert.equal(calls[0].action, "deleteNotes");
  });
});

describe("due-card shaping and composites", () => {
  it("getDueCards queries is:due, then cardsInfo, omitting answers by default", async () => {
    const { fetchFn, calls } = fakeFetch((action) => {
      if (action === "findCards") return [10, 11];
      if (action === "cardsInfo") return [
        { cardId: 10, fields: { Front: { value: "q1" }, Back: { value: "a1" } }, answer: "a1" },
        { cardId: 11, fields: { Front: { value: "q2" }, Back: { value: "a2" } }, answer: "a2" },
      ];
      return null;
    });
    const r = (await getDueCards({}, { fetchFn })) as Array<Record<string, unknown>>;
    assert.equal(calls[0].action, "findCards");
    assert.equal((calls[0].params as { query: string }).query, "is:due");
    assert.equal(calls[1].action, "cardsInfo");
    assert.equal(r.length, 2);
    assert.equal((r[0] as { answer?: unknown }).answer, undefined);
    const withAns = (await getDueCards({ deck: "Default", include_answer: true }, { fetchFn })) as Array<Record<string, unknown>>;
    assert.equal((withAns[0] as { answer?: unknown }).answer, "a1");
  });
  it("getCards maps learning state to is:learn", async () => {
    const { fetchFn, calls } = fakeFetch((a) => (a === "findCards" ? [] : null));
    await getCards({ state: "learning" }, { fetchFn });
    assert.equal((calls[0].params as { query: string }).query, "is:learn");
    await assert.rejects(() => getCards({ state: "bogus" }, { fetchFn }), /Invalid card state/);
  });
  it("presentCard returns front/question for one card", async () => {
    const { fetchFn } = fakeFetch(() => [{ cardId: 5, fields: { Front: { value: "What is 2+2?" }, Back: { value: "4" } }, deckName: "Math" }]);
    const r = (await presentCard({ card_id: 5 }, { fetchFn })) as { question: string };
    assert.equal(r.question, "What is 2+2?");
  });
  it("deckStats computes per-state counts locally via findCards", async () => {
    const { fetchFn, calls } = fakeFetch((a, p) => {
      const q = (p as { query: string }).query;
      if (q.startsWith("is:new")) return [1, 2];
      if (q.startsWith("is:due")) return [3];
      return [];
    });
    const r = await deckStats({ deck: "Default" }, { fetchFn });
    assert.equal(r.new, 2);
    assert.equal(r.due, 1);
    assert.ok(calls.every((c) => c.action === "findCards"));
  });
  it("collectionStats aggregates deckNames + per-state counts", async () => {
    const { fetchFn } = fakeFetch((a, p) => {
      if (a === "deckNames") return ["A", "B"];
      const q = (p as { query: string }).query;
      if (q === "is:new") return [1];
      return [];
    });
    const r = await collectionStats({ fetchFn });
    assert.equal(r.decks, 2);
    assert.equal(r.new, 1);
  });
  it("listDecks returns deckNames and shapes stats when asked", async () => {
    const { fetchFn } = fakeFetch((a) => (a === "deckNames" ? ["Only"] : []));
    assert.deepEqual(await listDecks({}, { fetchFn }), ["Only"]);
    const withStats = (await listDecks({ include_stats: true }, { fetchFn })) as Array<{ deck: string }>;
    assert.equal(withStats[0].deck, "Only");
  });
});
