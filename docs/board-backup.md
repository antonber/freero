# Board backups: the `.freero` file

A `.freero` file is one board — its content, its comments and the files it shows — that anyone may
restore as a new board on any Freero (KAI-137). It is made by the server
(`GET /api/boards/:id/backup`, the board menu's "Download board backup (.freero)") and read by the
server (`POST /api/boards/restore-backup`, the dashboard's "Restore backup", or opening the file
with the installed app). Code: `apps/server/src/modules/backup/` (`format.ts` is this spec).

## Layout

A ZIP archive (media type `application/vnd.freero.board+zip`):

| Entry | What |
|---|---|
| `freero.json` | The manifest (below). Always present. |
| `board.json` | The shared document: `{ "<collection>": { "<key>": <JSON value> } }` — `elements` (items by id), `settings`, `comments`, `tags`, `tableCells`, `presenterNotes`, `diagramSources`, … exactly the board document's top-level maps (`@freero/shared` `ydoc.ts`). |
| `editors.json` | Only in an owner's or editor's backup, and only when the board has any: the contents of hidden frames (the `editors` layer), same layout. Restored as hidden content again. |
| `files/<name>` | The uploads the content references (`/uploads/<name>`: images, PDFs, video, audio, attachments), stored uncompressed under their stored names. |

### `freero.json`

```json
{
  "format": "freero.board-backup",
  "version": 1,
  "minReaderVersion": 1,
  "exportedAt": "2026-10-28T12:00:00.000Z",
  "origin": "https://freero.example.com",
  "board": { "id": "AbC123xYz0", "title": "Launch plan", "description": "", "createdAt": "…" },
  "content": {
    "doc": { "path": "board.json", "sha256": "…" },
    "editors": { "path": "editors.json", "sha256": "…" }
  },
  "files": [{ "name": "k2…Q.png", "path": "files/k2…Q.png", "bytes": 48213, "sha256": "…" }],
  "missingFiles": [{ "name": "z9…a.mp4", "reason": "over the 200 MB one backup carries" }]
}
```

- `content.editors` is `null` when the backup carries no hidden content.
- `missingFiles`: uploads the content references that the file does not carry (gone when it was
  made, or over `MAX_BACKUP_MB`). A restore leaves those references as they are (they still work on
  the Freero the file came from), except attachments, which are dropped.

### Versions

`version` is the format the writer used; `minReaderVersion` the oldest reader that understands it.
Within one format, versions only ADD (new manifest fields, new collections): a reader keeps what it
knows. A change older readers would get wrong raises `minReaderVersion`; a reader older than that
refuses the file with "made by a newer version of Freero". Reading an OLDER file runs it through
`UPGRADES` in `format.ts`, one step per version, so every file this format ever wrote restores.

## What a backup carries

What the person downloading it may read and take out, nothing more:

- The workspace's **downloads policy** applies (403 like any export; the refusal is audited), and
  every download is in the workspace's audit log (`board.exported`, format `freero`).
- **Hidden frames' contents** only for owners and editors (who see them).
- **Never anyone's private drafts** or sealed ballots (private layers), and never pending
  suggestions.
- **Left out on purpose** (`Y_LEFT_OUT_OF_BACKUPS` in `@freero/shared`): live sessions (votes, the
  timer, private mode, facilitation, planning poker, a retro's step), live activity results, the call
  link and tracker links (server state that doesn't belong to a new board), and items' `trackerLink`.
- Comments keep their authors' ids and names as written; on another Freero those ids don't resolve,
  so comments show the name stored with them.

## What a restore does

Nothing is created unless every check passes:

1. **Size and shape before unpacking**: the file ≤ `MAX_BACKUP_MB`; at most 20,000 entries; each
   entry's declared size within its limit and the total within `MAX_BACKUP_MB` + 256 MB (zip bombs
   are refused before anything is inflated); only the entry names above are unpacked.
2. **Integrity**: every entry's sha256 must match the manifest — a file changed after it was made
   is refused ("checksum mismatch").
3. **Version**: as above.
4. **Content shape**: collections are objects of entries, items have an `id` equal to their key and
   a `type`; at most 200,000 entries.
5. **Where**: a workspace (and project) the restorer may create boards in, under their board quota.
6. **Files**: each referenced file is uploaded again as the restorer's own (new names), checked
   exactly like an upload of its kind (an image must be one, video / audio a container Freero plays,
   anything else stays a download-only attachment) and counted toward their upload quota. If any
   step after this fails, the files uploaded for it are deleted again.
7. **Fresh ids**: every item gets a new id, rewritten everywhere it appears — keys (`elements`, table
   cells, presenter notes), references (frames, connector ends, riders, a thread's item) and links
   (`#<id>`). Upload URLs are rewritten to the new files.
8. **One transaction**: the new board's row and its document (and hidden content) are written
   together, from the JSON, as a fresh document — the file's own edit history is never replayed.
   Audited as `board.backup_restored` (source board, its Freero, format version, files).

Rate limit: `RATE_LIMIT_BACKUP` per person, for downloads and restores together.
