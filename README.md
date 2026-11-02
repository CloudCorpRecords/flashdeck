# flashdeck

flashdeck lets an agent study and manage Anki flashcards through a
local Anki instance running AnkiConnect. It covers the review loop
(due cards, presenting a card, rating it), decks, notes, tags, note
types, and collection statistics — a labelled core subset of 20 tools
from the 53 documented in the original Anki MCP spec.

Anki must be running with the AnkiConnect add-on installed. By
default flashdeck talks to `http://127.0.0.1:8765`; set
`ANKICONNECT_URL` to point elsewhere.

## Install

```bash
npx @reneturcios/flashdeck check
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/flashdeck
```

The container defaults to the MCP server. Pass CLI arguments to use
it as a CLI instead. Note the container still needs network access
to the host's AnkiConnect endpoint.

## CLI

```bash
flashdeck check           # probe AnkiConnect (deck list on success)
flashdeck decks           # list decks
flashdeck due [deck]      # due cards, optionally for one deck
flashdeck stats [deck]    # deck stats, or collection stats with no deck
flashdeck tags            # all tags
flashdeck models          # all note types
flashdeck sync            # sync with AnkiWeb
flashdeck --version
```

Most commands accept `--json`. Exit codes: `0` success, `1` error
(the message names the AnkiConnect or validation problem), `2`
usage error.

## MCP server

```bash
npx -y @reneturcios/flashdeck mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "flashdeck": {
      "command": "npx",
      "args": ["-y", "@reneturcios/flashdeck", "mcp"]
    }
  }
}
```

### Tools

| Tool | Input | What it does |
| --- | --- | --- |
| `sync` | — | Sync with AnkiWeb. |
| `get_due_cards` | `deck?`, `include_answer?` | Due cards, optional deck filter; answers omitted unless requested. |
| `get_cards` | `deck?`, `state?`, `include_answer?` | Cards filtered by state (due/new/learning/suspended/buried) and deck. |
| `present_card` | `card_id` | Show a card's question/front. |
| `rate_card` | `card_id`, `ease` (1-4) | Rate Again/Hard/Good/Easy and schedule next review. |
| `listDecks` | `include_stats?` | List decks, optional per-deck stats. |
| `deckStats` | `deck` | Statistics for one deck. |
| `createDeck` | `deck` | Create a deck (Parent::Child, max 2 levels). |
| `addNote` | `deck_name`, `model_name`, `fields`, `tags?` | Create one note. |
| `addNotes` | `deck_name`, `model_name`, `notes` | Batch-create up to 100 notes. |
| `findNotes` | `query` | Search notes with Anki query syntax. |
| `notesInfo` | `notes` | Details for notes. |
| `updateNoteFields` | `note_id`, `fields` | Update a note's fields. |
| `deleteNotes` | `notes`, `confirm?` | Delete notes; refused without `confirm: true`. |
| `getTags` | — | All tags. |
| `addTags` | `notes`, `tags` | Add tags to notes. |
| `removeTags` | `notes`, `tags` | Remove tags from notes. |
| `modelNames` | — | List note types. |
| `modelFieldNames` | `model_name` | Field names for a note type. |
| `collection_stats` | — | Aggregated collection statistics. |

Deck statistics are computed locally from per-state card searches;
no statistics endpoint is assumed. When Anki is not running, tools
return an error naming the failed AnkiConnect request rather than
an empty result.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, fake fetch only, no live Anki
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
