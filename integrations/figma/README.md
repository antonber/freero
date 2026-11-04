# Freero plugin for Figma

Sends the selected Figma frames to a Freero board as pictures that link back to the frame; sending
a frame again updates its picture. MIT, no dependencies.

```
node integrations/figma/build.mjs            # → manifest.json + dist/ (for https://freero.app)
node integrations/figma/build.mjs --server https://your.freero --id <Figma plugin id>
```

Then in the Figma desktop app: Plugins → Development → Import plugin from manifest… →
`integrations/figma/manifest.json`. How it signs in, what it sends and the owner's publishing
steps: [docs/integrations/figma.md](../../docs/integrations/figma.md#the-figma-plugin).

- `src/code.js` runs in Figma's sandbox (selection, PNG export, remembering which picture a frame
  became on each board).
- `src/ui.js` + `src/ui.html` are the plugin's window; `src/freero.js` is everything said to
  Freero, tested against a real server in `apps/server/src/integrations/figma.test.ts`.
