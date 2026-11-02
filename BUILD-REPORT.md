# flashdeck — Build Report

Tranche #101+ Batch 1, MCP Rebuild 1000 program. Clean-room rebuild of
ankimcp/anki-mcp-server (candidate ai.ankimcp/anki-mcp-server, rank 14,
535 stars), built from the docs-derived spec in
`harness/fixtures/anki-mcp-server-tools-original.json` only.
Local build only — nothing pushed or published.

Identity: repo `flashdeck`, npm `@reneturcios/flashdeck`,
MCP name `io.github.CloudCorpRecords/flashdeck`, version `0.1.0`.
Build dir: `~/workspace/mcp-rebuild-100/builds/flashdeck/`

## Scope — LABELLED CORE SUBSET

The original documents 53 tools; this rebuild is a **labelled core
subset of 20 tools**: review/study, decks, notes, tags, models, and
collection stats. Fixture `_source` states this explicitly:
"docs-derived core subset (20 of the 53 tools documented in the
ankimcp/anki-mcp-server README, retrieved 2026-10-26) … Omitted:
remaining scheduling tools (forgetCards, setDueDate, areSuspended,
suspend, unsuspend, changeDeck), media tools, remaining
model-template tools, review_stats, and all 11 GUI tools. Schemas are
documented-parameter reconstructions, not hand-probed. Parity is
against this subset only."

Tools (20): sync, get_due_cards, get_cards, present_card, rate_card,
listDecks, deckStats, createDeck, addNote, addNotes, findNotes,
notesInfo, updateNoteFields, deleteNotes, getTags, addTags,
removeTags, modelNames, modelFieldNames, collection_stats.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `flashdeck: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Flashcard decks and spaced repetition
  via AnkiConnect: study, decks, notes, and stats." = **86 chars**
  (≤100 ✓); npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/flashdeck:0.1.0` carries **no** `version`
  field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/flashdeck"`
- `tsconfig.json` (318 bytes, fleet-identical), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26),
  `package-lock.json` (see Lockfile below)
- `src/index.ts`, `src/cli.ts` (`check`, `decks`, `due`, `stats`,
  `tags`, `models`, `sync`, `mcp`, `--version`; exit 2 usage /
  1 error), `src/mcp.ts`, `src/types.ts`, `src/flashdeck.ts`
  (core logic, `VERSION = "0.1.0"`)
- `test/flashdeck.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (adapted from clockport/shipcheck mechanics; image name and
  smoke-test server name changed to flashdeck)

`src/mcp.ts` uses the SDK's low-level `Server` API with explicit
schema literals exactly as the fixture (not McpServer+zod), per
standing rules; zod still validates every tools/call.

## AnkiConnect contract (local mapping)

All tools POST JSON `{action, version: 6, params}` to
`ANKICONNECT_URL` (default `http://127.0.0.1:8765`) via an injectable
`FetchFn`. Envelope `{result, error}`: a non-null `error` becomes an
`isError` result with its text; a failed fetch becomes an honest
`isError` with the underlying error.

| Tool | AnkiConnect mapping |
| --- | --- |
| sync | `sync` {} |
| listDecks | `deckNames` {} (include_stats: per-deck local stats shaping, see below) |
| createDeck | `createDeck` {deck} — deck validated locally first (Parent::Child, max 2 levels) |
| addNote | `addNote` {note:{deckName, modelName, fields, tags}} |
| addNotes | `addNotes` {notes:[{deckName, modelName, fields, tags}]} — batch ≤100 validated locally |
| findNotes | `findNotes` {query} |
| notesInfo | `notesInfo` {notes} |
| updateNoteFields | `updateNoteFields` {note:{id, fields}} |
| deleteNotes | `deleteNotes` {notes} — local gate: without `confirm=true`, returns isError refusing and never calls AnkiConnect |
| getTags | `getTags` {} |
| addTags | `addTags` {notes, tags} |
| removeTags | `removeTags` {notes, tags} |
| modelNames | `modelNames` {} |
| modelFieldNames | `modelFieldNames` {modelName} |
| get_due_cards | `findCards` {query:"is:due"+deck clause} then `cardsInfo` {cards}; answers omitted unless `include_answer` |
| get_cards | `findCards` with state query (due→is:due, new→is:new, learning→is:learn, suspended→is:suspended, buried→is:buried) + deck clause, then `cardsInfo` |
| present_card | `cardsInfo` {cards:[card_id]}, shaped to front/question fields |
| deckStats | **Local composite, no invented action:** per-state `findCards` counts (is:new / is:learn / is:review / is:suspended / is:buried / is:due + deck clause) |
| collection_stats | **Local composite:** `deckNames` + the same per-state `findCards` counts with no deck clause |
| rate_card | `answerCard` {cardId, ease} — **UNVERIFIED mapping, see Gaps** |

CLI mirrors key tools (`check`, `decks`, `due`, `stats`, `tags`,
`models`, `sync`) + `check` (connection probe shaping: deckNames on
success, honest error object on failure) + `--version`; unknown
command exits 2.

## Verification (exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo tsc_exit=$?
tsc_exit=0
```

### 2. Tests — 21 pass, fake FetchFn only, NO live Anki claimed
```
ℹ tests 21
ℹ pass 21
ℹ fail 0
```
Covers: envelope handling (result on null error, non-null error
surfaced, failed fetch surfaced, version-6 envelope), action shaping
(addNote, updateNoteFields, findNotes, modelFieldNames, rateCard),
deck validation (1–2 levels accepted, 3 levels / empty rejected,
createDeck validates before any call), batch cap (101 rejected
locally, valid batch shaped), delete gate (refused without
confirm=true, sent with it), due-card shaping (is:due query,
cardsInfo follow-up, answers omitted by default / included on
request), state mapping (learning→is:learn, invalid state rejected),
present_card front shaping, deckStats and collection_stats local
per-state counting, listDecks stats shaping.

### 3. Parity
```
$ python3 ~/workspace/mcp-rebuild-100/harness/parity.py \
    --original ~/workspace/mcp-rebuild-100/harness/fixtures/anki-mcp-server-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/flashdeck/dist/cli.js mcp" \
    --out ~/workspace/mcp-rebuild-100/builds/flashdeck/parity-out
verdict=PASS parity_pct=100.0 original_tools=20 rebuild_tools=20 missing=[] extra=[] schema_diffs=[]
parity_exit=0
```

### 4. Live check (no Anki running — honest error)
stdio `tools/call listDecks` with no Anki/AnkiConnect running:
```
{"result":{"content":[{"type":"text","text":"AnkiConnect request failed (deckNames -> http://127.0.0.1:8765): fetch failed"}],"isError":true},"jsonrpc":"2.0","id":2}
```
Exact isError text: `AnkiConnect request failed (deckNames -> http://127.0.0.1:8765): fetch failed`
Initialize returned `serverInfo: {"name":"flashdeck","version":"0.1.0"}`.
CLI: `--version` → `0.1.0` (exit 0); unknown command → Usage, exit 2;
`check --json` → `{"ok":false,"url":"http://127.0.0.1:8765","error":"AnkiConnect request failed (deckNames -> http://127.0.0.1:8765): fetch failed"}` (exit 1).

## Lockfile

Route 3 (per LOCKFILE-ROUTE.md): `package.json` only into fresh
`/tmp/flashdeck-lock/`, then
`npm install --package-lock-only --ignore-scripts --offline`
(rc=0). **Verified:** the produced lockfile parses, its `name` is
`@reneturcios/flashdeck`, `lockfileVersion` 3, 128 package entries.
The verified clean lockfile was placed at
`builds/flashdeck/package-lock.json` — clean lockfile placed (not a
clockport-copy fallback). `node_modules` in the build dir is a
`cp -a` copy of clockport's (local build only, gitignored).

## Gaps / risks

- **Core subset scope:** 20 of 53 documented tools only (see Scope).
  Parity is against this labelled subset, not the full original.
- **rate_card action-name risk (first check at live smoke):**
  `rate_card` posts AnkiConnect action `"answerCard"` with
  `{cardId, ease}`. This mapping is **unverified** — AnkiConnect
  action names for answering a card have drifted historically
  (singular/plural variants exist in the ecosystem), and no live
  Anki was available in this build to confirm it. If AnkiConnect
  rejects it, the tool surfaces that envelope error honestly rather
  than failing silently. Ease is validated locally (1–4) before the
  call. This is the first thing to check at live smoke.
- **Composite mappings:** deckStats / collection_stats /
  listDecks(include_stats) are real local logic over `findCards`
  per-state counts, not calls to a statistics action — no invented
  AnkiConnect action is used for them. Counts therefore reflect
  what `findCards` returns for each state query.
- **Schemas are documented-parameter reconstructions**, not
  hand-probed against a live original server (per fixture `_source`).
- **No live Anki claimed:** all behaviour tests use a fake FetchFn;
  the only live check was the no-Anki error path above. Container
  build not exercised locally; the publish-container workflow
  smoke-tests the image at publish time.
- Nothing pushed or published.
