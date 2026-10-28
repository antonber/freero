# AI in Freero

Freero's AI features run on a model provider that **you** configure: Freero's operator for the whole
server, or a team workspace's admins for their workspace. Nothing is on by default. With no provider
configured, there is no AI anywhere in the app and every AI route answers 404.

What it can do today (KAI-102), from the AI button in the selection toolbar, the right-click menu
("AI ▸") or the board menu:

| Action | Reads | Adds to the board |
|---|---|---|
| Generate ideas | your prompt (and the selection, if any, as background) | a titled grid of stickies |
| Cluster by theme | the selected notes (stickies, cards) | named groups: the notes move into them, each group gets a title |
| Summarise | the selection, or the whole board | a written note beside it |
| Diagram from text | your prompt (and the selection, if any) | a flowchart, sequence diagram or mind map with attached connectors |

Every action is **previewed first**: nothing touches the board until the person clicks Insert, and
the result then lands as one step they can undo. The model never places anything: it returns
structure (a list, groups, Mermaid, an outline), which Freero's own layout places on free space.

## What happens to your data

**Your board content is sent to the provider you configured.** When someone runs an action, Freero's
server sends that provider:

- the person's prompt;
- the board content the action reads: the selected items, or for a whole-board summary the board's
  outline (its text, structure, tags, votes and comments as that person sees it: never other
  people's private drafts, never hidden frames' contents they can't see), cut to `AI_MAX_INPUT_TOKENS`.

The provider processes it under its own terms (data retention, training, region): choose a provider
and plan whose terms fit your organization, or run a model yourself (Ollama, vLLM, LM Studio).

Freero itself **does not store prompts, board content sent to the model, or the model's answers**.
It keeps:

- **usage counts** per workspace, person and month (requests, input and output tokens), for budgets
  and the admin console; included in personal and workspace data exports;
- an **audit log entry for every request** (`ai.request`): who, which board, the task, provider and
  model, tokens and the outcome (ok, unusable answer, provider error, couldn't be placed). Never the
  prompt or any board text.

The workspace's **downloads policy** applies: people the workspace doesn't allow to export or copy
its boards can't run actions that read board content (the same check as exports and API reads;
refusals are audited as `board.download_refused`). Generating ideas from a prompt alone reads nothing
from the board.

## Safety

- **Board text is data, never instructions.** It goes to the model inside one delimited block, as a
  single JSON string with `<` and `>` escaped, so nothing written on a board can close the block,
  pose as the person's request or add instructions; the system prompt tells the model that the block
  is untrusted content. Prompts are server-side templates: clients send a task, never a prompt template.
- **Model output is validated before anything reaches a board**: it must be JSON of the expected
  shape; lists are clamped (at most 30 ideas, 12 groups), groups may only name notes the model was
  shown, Mermaid must parse. An unusable answer gets one repair turn, then the action fails with
  nothing written. Text is placed as text (never HTML), and the layout limits of structure insertion
  apply (elements, characters, depth).
- **Keys** are sealed at rest (`platform/secrets`, AES-256-GCM under `SESSION_SECRET`), write-only in
  the admin console, never sent to browsers, never logged.
- **Endpoints a workspace types in** are called only over https, without following redirects, and
  never at private, loopback or link-local addresses (checked when connecting, so DNS can't be used
  to reach them) — unless the operator sets `AI_WORKSPACE_PRIVATE_ENDPOINTS=true` for a self-hosted
  model on the local network. The operator's own `AI_BASE_URL` may be anything.
- **Who**: only people who can edit the board; in a team workspace, only whom its admins allow
  (members, admins, or everyone with edit access).
- **Limits**: per-person and per-workspace rate limits (`RATE_LIMIT_AI`, `RATE_LIMIT_AI_WORKSPACE`), a
  monthly token budget per team workspace, and a monthly cap per person on the operator's provider
  (`AI_INSTANCE_MONTHLY_TOKENS_PER_USER`). Usage is counted after each call, so concurrent calls can
  overshoot a budget by at most those calls.

## Setting it up

**Operator (the whole server)** — see [configuration.md](configuration.md#ai):

```
AI_PROVIDER=anthropic            # or openai (any OpenAI-compatible endpoint)
AI_API_KEY=sk-ant-…
AI_MODEL=claude-sonnet-5-5       # default for anthropic; required for openai
AI_INSTANCE_FOR=teams            # who may use this provider: teams, personal (both: personal,teams)
AI_WORKSPACE_KEYS=true           # let team admins bring their own provider instead
```

- `AI_INSTANCE_FOR=teams` (default): team admins can choose "this server's provider" for their
  workspace. Add `personal` to give it to boards in personal workspaces too (each person is capped by
  `AI_INSTANCE_MONTHLY_TOKENS_PER_USER`).
- Without `AI_PROVIDER` but with `AI_WORKSPACE_KEYS=true`, only workspaces that bring their own key
  get AI ("your model, your bill").
- A local model: `AI_PROVIDER=openai`, `AI_BASE_URL=http://localhost:11434/v1` (Ollama),
  `AI_MODEL=llama3.3`, no key.
- Azure OpenAI: `AI_PROVIDER=openai`, `AI_BASE_URL=https://<resource>.openai.azure.com/openai/v1`,
  `AI_MODEL=<deployment>`, `AI_API_KEY=<key>` (sent as `api-key` and as a bearer token).

**Workspace admins** — admin console → **AI** (shown only when the server offers AI): turn AI on, pick
the server's provider or your own (provider, endpoint, model, key), set who may use it and a monthly
token budget, test the connection, and see this month's usage per person. Turning AI off applies to
everyone at once. Every change is in the audit log (`ai.settings_changed`; the key itself never).

## API

`GET /api/boards/:id/ai`, `POST /api/boards/:id/ai/actions` and the admin routes are described in
`@freero/shared` `api.ts` ("AI"). An action takes `target: 'preview'` (default: placed, not written;
the app inserts `snapshot` with `Editor.insertElements` and applies `moves`) or `target: 'board'`
(written now as one change attributed to the caller, through `modules/structure`) or `target:
'suggestions'` (proposed for the board's editors to accept or reject, badge "AI for <you>"; KAI-169).
A result that moves OTHER people's items — sorting notes someone else wrote — is always proposed as
suggestions, whatever was asked (the response's `target` says so, and the app opens the review
list): one person's AI action never rearranges a colleague's work without that being reviewable.

## Not yet

Results are attributed to the person who ran the action (`createdBy`), with "AI" only in the audit
log and on suggestions (`suggestedBy` on items accepted from one); marking items "made with AI"
belongs to agent participants (KAI-168). Streaming partial results isn't needed while every result is validated
whole before it can be previewed.
