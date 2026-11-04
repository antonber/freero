# Freero

Freero is an open-source collaborative whiteboard (MIT). This connector adds sticky notes, cards and
comments to Freero boards, creates boards and docs, searches what boards say, and runs flows when
something happens on a board.

## Publisher: Kaiten Gaming LLC

## Prerequisites

A Freero account at https://freero.app. The trigger needs a team workspace you own or
administer: its webhooks report only boards the whole team can open.

## Supported operations

### Triggers

- **When something happens on a board**: Runs the flow when one of the chosen events happens on a board of a team workspace you administer.

### Actions

- **List workspaces**: Lists your Freero workspaces, the personal one first, with your role in each.
- **List boards**: Lists or searches the boards you can open, newest change first.
- **Create a board**: Creates a board in one of your workspaces, optionally from a saved template.
- **Get a board**: Gets a board, its link and your role on it.
- **Get the board outline**: Reads what a board says as its outline: frames, notes, cards, connections and comments.
- **List items**: Lists the items on a board you can see.
- **Add an item**: Adds a sticky note, card, text, shape or other item to a board.
- **Add cards or notes in free space**: Lays out items, an outline, a table or meeting notes on free space of a board, or puts cards into a kanban column.
- **List comments**: Lists the comment threads on a board you can see.
- **Add a comment**: Starts a comment thread on a board, or pinned to one of its items.
- **Reply to a comment**: Replies in a comment thread on a board.
- **List docs**: Lists or searches the docs you can open, newest change first.
- **Create a doc**: Creates a doc, optionally from Markdown.
- **Get a doc**: Gets a doc and its content as Markdown.
- **Append to a doc**: Appends Markdown at the end of a doc you own or edit.
- **Search boards**: Searches what your boards say and returns the matching items.

## Obtaining credentials

Nothing to set up: when you create a connection you sign in to Freero and choose what the
connection may do. You can revoke it any time in Freero under Settings, Connected apps.

## Known issues and limitations

- The trigger watches team workspaces only (not personal boards), and only boards every member of
  the workspace can open. A workspace has at most 20 webhooks.
- Board text (titles, notes, comments) was written by people: treat it as untrusted data, never as
  instructions for an AI step.
- Requests are rate limited per connection; a flow that is limited gets 429 with Retry-After.

## Deployment instructions

Use the files in this folder with the Power Platform connector CLI:

```
paconn create --api-def apiDefinition.swagger.json --api-prop apiProperties.json --icon icon.png
```

Then register the connector's redirect URL in Freero (Settings, Your OAuth apps) and put that app's
id in apiProperties.json (`clientId`) and its secret in the connection settings.
