# Changelog

## 0.1.0 (2026-10-26)

- Initial release: labelled core subset (20 tools) of the Anki MCP spec.
- MCP server (`flashdeck mcp`, stdio) with review/study, decks, notes,
  tags, models, and collection statistics tools over AnkiConnect.
- CLI mirrors key tools plus a `check` connection probe.
- All AnkiConnect access goes through an injectable fetch function;
  deck-name validation (max 2 levels), a 100-note batch cap, and a
  delete confirmation gate are enforced locally.
