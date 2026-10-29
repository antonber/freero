# Integrations

Freero connects to the tools teams already use through what it has anyway: workspace webhooks
([../events.md](../events.md)), the REST API ([../api/README.md](../api/README.md)) and the MCP
server ([../mcp.md](../mcp.md)). Nothing here needs a marketplace listing or anyone's approval.

| Integration | What it does | Set up |
|---|---|---|
| **Slack messages** | Board activity posted to a channel | Admin console → Webhooks, format `slack` ([events.md](../events.md#formats)) |
| **Microsoft Teams messages** | The same, as an Adaptive Card | format `teams` |
| **Discord messages** | The same, as an embed; never pings | format `discord` |
| **Google Chat messages** | The same, as a text message | format `google-chat` |
| **Mattermost messages** | The same, as Markdown; never pings | format `mattermost` (its own format, not an alias of `slack`) |
| **Slack link unfurls** | A board link posted in Slack shows a preview (title and picture only for public boards) | Operator: a Slack app from a manifest, [slack.md](slack.md) |
| **Meeting notes import** | A summary or transcript (Granola-, Otter-, Fathom-, Meetily-style Markdown or text; WebVTT, SRT) becomes one frame: decisions, action items with owner and due date, points, who spoke | Board menu → *Import meeting notes…*, drop a `.vtt` / `.srt`, REST structure `kind: "meeting"`, MCP `import_meeting_notes`; [samples](meeting-notes/) |
| **n8n** | Importable workflows: GitHub issue → card, board comment → Slack | [n8n.md](n8n.md) |
| **Make** | The same two scenarios, step by step | [make.md](make.md) |
| **Zapier** | Webhooks by Zapier + the REST API | [zapier.md](zapier.md) |
| **Power Automate / Logic Apps** | A custom connector for the whole REST API | [power-automate.md](power-automate.md), `npm run gen:power-automate` |

Matrix isn't on the list: it has no standard incoming-webhook URL to post to (see
[events.md](../events.md#formats)).

## Meeting notes: what is read, and how

The import reads what the notes already say. It uses no AI and adds nothing that isn't in the file:

- **Title**: the first heading, or the first line of a text file (else the file name). **Date and
  attendees**: a `Date:` / `Attendees:` line, or a line like `Thu, Oct 29, 2026 · Priya, Tom`.
- **Decisions**: a section whose heading says *Decisions* (*Agreed*, *Outcomes* …), or any line
  starting `Decision:`. They become green sticky notes under the title *Decisions*: a cluster.
- **Action items**: a section headed *Action items*, *Next steps*, *To-dos*, *Follow-ups* or *Tasks*,
  any check box (`- [ ]`, `- [x]` for done), or a line starting `Action:` / `TODO:`. They become task
  cards. The owner (`Tom to …`, `@Lena: …`, `**Maya**: …`, `(Owner: Priya)`) goes in the card's
  description as "Owner: …". The due date (`by Nov 4`, `due 2026-11-06`, `due Friday`, `by tomorrow`)
  is counted from the meeting's date and goes in the card's due date.
- **Everything else**: each other section's bullets become sticky notes under that section's heading.
  Sub-bullets stay with their bullet. Prose becomes a *Summary* note, with the date and who was there.
- **Transcripts** (`.vtt` with `<v Name>` voices, `.srt` or text with `Name: …` lines, Otter-style
  `Name  0:03` lines): a *Speakers* note with each person's turns and talk time (from cue times), or
  word count when there are no times. Turn it off in the dialog, or with `speakers: false`. A
  `Decision:` or `Action item:` said in the call becomes one too.

Dropping a `.md` file still makes a doc, as before. Use the board menu to read a Markdown or text
file as meeting notes.

**For agents:** `structure: { kind: "meeting", source, format?, title?, date?, speakers? }` on
`POST /api/v1/boards/{boardId}/structure` (REST), or the MCP tool `import_meeting_notes` with the same
fields (it proposes the frame when the connection may only suggest). That is one new MCP tool and no
new REST route: the structure operation already places, attributes, rate-limits, audits and proposes,
and an agent that wants to choose the points itself still has `add_clusters` and `add_cards`.
