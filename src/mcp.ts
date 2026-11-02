/**
 * flashdeck MCP server — low-level Server API with explicit schema
 * literals exactly as the fixture, so tools/list parity is exact.
 * Zod validates every tools/call argument set.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  VERSION,
  addNote,
  addNotes,
  addTags,
  collectionStats,
  createDeck,
  deckStats,
  deleteNotes,
  findNotes,
  getCards,
  getDueCards,
  getTags,
  listDecks,
  modelFieldNames,
  modelNames,
  notesInfo,
  presentCard,
  rateCard,
  removeTags,
  sync,
  updateNoteFields,
} from "./flashdeck.js";

const EmptyArgs = z.object({});
const GetDueCardsArgs = z.object({ deck: z.string().optional(), include_answer: z.boolean().optional() });
const GetCardsArgs = z.object({ deck: z.string().optional(), state: z.string().optional(), include_answer: z.boolean().optional() });
const PresentCardArgs = z.object({ card_id: z.number() });
const RateCardArgs = z.object({ card_id: z.number(), ease: z.number() });
const ListDecksArgs = z.object({ include_stats: z.boolean().optional() });
const DeckStatsArgs = z.object({ deck: z.string() });
const CreateDeckArgs = z.object({ deck: z.string() });
const AddNoteArgs = z.object({ deck_name: z.string(), model_name: z.string(), fields: z.record(z.string(), z.unknown()), tags: z.array(z.string()).optional() });
const AddNotesArgs = z.object({ deck_name: z.string(), model_name: z.string(), notes: z.array(z.record(z.string(), z.unknown())) });
const FindNotesArgs = z.object({ query: z.string() });
const NotesInfoArgs = z.object({ notes: z.array(z.number()) });
const UpdateNoteFieldsArgs = z.object({ note_id: z.number(), fields: z.record(z.string(), z.unknown()) });
const DeleteNotesArgs = z.object({ notes: z.array(z.number()), confirm: z.boolean().optional() });
const AddTagsArgs = z.object({ notes: z.array(z.number()), tags: z.string() });
const RemoveTagsArgs = z.object({ notes: z.array(z.number()), tags: z.string() });
const ModelFieldNamesArgs = z.object({ model_name: z.string() });

const TOOLS = [
  { name: "sync", description: "Sync with AnkiWeb.", inputSchema: { type: "object" as const, properties: {} } },
  { name: "get_due_cards", description: "Get due cards, optionally filtered by deck.", inputSchema: { type: "object" as const, properties: { deck: { type: "string", description: "Deck name to filter due cards by." }, include_answer: { type: "boolean", description: "When true, include each card's answer (back side)." } } } },
  { name: "get_cards", description: "Get cards filtered by state and deck.", inputSchema: { type: "object" as const, properties: { deck: { type: "string", description: "Deck name to filter cards by." }, include_answer: { type: "boolean", description: "When true, include each card's answer (back side)." }, state: { type: "string", description: "Card state to filter by, such as new, learning, review, or due." } } } },
  { name: "present_card", description: "Show a card's question/front.", inputSchema: { type: "object" as const, properties: { card_id: { type: "number", description: "ID of the card to present." } }, required: ["card_id"] } },
  { name: "rate_card", description: "Rate a card (Again/Hard/Good/Easy) and schedule next review.", inputSchema: { type: "object" as const, properties: { card_id: { type: "number", description: "ID of the card being rated." }, ease: { type: "number", description: "Ease rating: 1 (Again), 2 (Hard), 3 (Good), or 4 (Easy)." } }, required: ["card_id", "ease"] } },
  { name: "listDecks", description: "List decks, optionally with per-deck statistics.", inputSchema: { type: "object" as const, properties: { include_stats: { type: "boolean", description: "When true, include per-deck statistics in the result." } } } },
  { name: "deckStats", description: "Get statistics for one deck.", inputSchema: { type: "object" as const, properties: { deck: { type: "string", description: "Name of the deck to get statistics for." } }, required: ["deck"] } },
  { name: "createDeck", description: "Create a new deck with the given name, using :: for nested decks such as Parent::Child.", inputSchema: { type: "object" as const, properties: { deck: { type: "string", description: "Name of the new deck (use :: for nested decks, such as Parent::Child)." } }, required: ["deck"] } },
  { name: "addNote", description: "Create one note.", inputSchema: { type: "object" as const, properties: { deck_name: { type: "string", description: "Name of the deck to add the note to." }, fields: { type: "object", description: "Field values for the note, keyed by field name." }, model_name: { type: "string", description: "Note type (model) name, such as Basic." }, tags: { type: "array", items: { type: "string" }, description: "Tags to apply to the new note." } }, required: ["deck_name", "model_name", "fields"] } },
  { name: "addNotes", description: "Batch-create up to 100 notes.", inputSchema: { type: "object" as const, properties: { deck_name: { type: "string", description: "Name of the deck to add the notes to." }, model_name: { type: "string", description: "Note type (model) name, such as Basic." }, notes: { type: "array", items: { type: "object" }, description: "Notes to create (up to 100), each an object of field values keyed by field name." } }, required: ["deck_name", "model_name", "notes"] } },
  { name: "findNotes", description: "Search notes with Anki query syntax.", inputSchema: { type: "object" as const, properties: { query: { type: "string", description: "Search query in Anki query syntax, such as deck:Default or tag:marked." } }, required: ["query"] } },
  { name: "notesInfo", description: "Get details for notes.", inputSchema: { type: "object" as const, properties: { notes: { type: "array", items: { type: "number" }, description: "IDs of the notes to get details for." } }, required: ["notes"] } },
  { name: "updateNoteFields", description: "Update a note's fields.", inputSchema: { type: "object" as const, properties: { fields: { type: "object", description: "Field values to set, keyed by field name." }, note_id: { type: "number", description: "ID of the note to update." } }, required: ["note_id", "fields"] } },
  { name: "deleteNotes", description: "Delete the specified notes from the collection; deletion is refused unless confirm is true.", inputSchema: { type: "object" as const, properties: { confirm: { type: "boolean", description: "Must be true to confirm the deletion." }, notes: { type: "array", items: { type: "number" }, description: "IDs of the notes to delete." } }, required: ["notes"] } },
  { name: "getTags", description: "Get all tags currently in the collection via AnkiConnect.", inputSchema: { type: "object" as const, properties: {} } },
  { name: "addTags", description: "Add tags to notes.", inputSchema: { type: "object" as const, properties: { notes: { type: "array", items: { type: "number" }, description: "IDs of the notes to tag." }, tags: { type: "string", description: "Space-separated tag names to add." } }, required: ["notes", "tags"] } },
  { name: "removeTags", description: "Remove tags from notes.", inputSchema: { type: "object" as const, properties: { notes: { type: "array", items: { type: "number" }, description: "IDs of the notes to remove tags from." }, tags: { type: "string", description: "Space-separated tag names to remove." } }, required: ["notes", "tags"] } },
  { name: "modelNames", description: "List note types.", inputSchema: { type: "object" as const, properties: {} } },
  { name: "modelFieldNames", description: "List field names for a note type.", inputSchema: { type: "object" as const, properties: { model_name: { type: "string", description: "Note type (model) name, such as Basic." } }, required: ["model_name"] } },
  { name: "collection_stats", description: "Get aggregated collection statistics.", inputSchema: { type: "object" as const, properties: {} } },
];

function textResult(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }] };
}
function errorResult(err: unknown) {
  return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
}

const server = new Server({ name: "flashdeck", version: VERSION }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case "sync": EmptyArgs.parse(args ?? {}); return textResult(await sync());
      case "get_due_cards": return textResult(await getDueCards(GetDueCardsArgs.parse(args ?? {})));
      case "get_cards": return textResult(await getCards(GetCardsArgs.parse(args ?? {})));
      case "present_card": return textResult(await presentCard(PresentCardArgs.parse(args ?? {})));
      case "rate_card": return textResult(await rateCard(RateCardArgs.parse(args ?? {})));
      case "listDecks": return textResult(await listDecks(ListDecksArgs.parse(args ?? {})));
      case "deckStats": return textResult(await deckStats(DeckStatsArgs.parse(args ?? {})));
      case "createDeck": return textResult(await createDeck(CreateDeckArgs.parse(args ?? {})));
      case "addNote": return textResult(await addNote(AddNoteArgs.parse(args ?? {})));
      case "addNotes": return textResult(await addNotes(AddNotesArgs.parse(args ?? {})));
      case "findNotes": return textResult(await findNotes(FindNotesArgs.parse(args ?? {})));
      case "notesInfo": return textResult(await notesInfo(NotesInfoArgs.parse(args ?? {})));
      case "updateNoteFields": return textResult(await updateNoteFields(UpdateNoteFieldsArgs.parse(args ?? {})));
      case "deleteNotes": return textResult(await deleteNotes(DeleteNotesArgs.parse(args ?? {})));
      case "getTags": EmptyArgs.parse(args ?? {}); return textResult(await getTags());
      case "addTags": return textResult(await addTags(AddTagsArgs.parse(args ?? {})));
      case "removeTags": return textResult(await removeTags(RemoveTagsArgs.parse(args ?? {})));
      case "modelNames": EmptyArgs.parse(args ?? {}); return textResult(await modelNames());
      case "modelFieldNames": return textResult(await modelFieldNames(ModelFieldNamesArgs.parse(args ?? {})));
      case "collection_stats": EmptyArgs.parse(args ?? {}); return textResult(await collectionStats());
    }
  } catch (err) {
    return errorResult(err);
  }
  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}
void main();
