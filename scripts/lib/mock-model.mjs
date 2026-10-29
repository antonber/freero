// Test-only model provider: answers Freero's AI requests with canned, well-formed JSON in both
// wire formats Freero speaks — the Anthropic Messages API (POST …/v1/messages) and OpenAI-compatible
// chat completions (POST …/chat/completions) — and records every request (path, headers, body) so
// checks can see what Freero sent. Never a real, paid model. `npm run verify` uses it; it also runs
// standalone for driving the UI by hand:
//
//   node scripts/lib/mock-model.mjs --port 4402
//
// An instruction containing MALFORMED gets a reply that is not JSON (to check that nothing lands).

import http from 'node:http';
import { pathToFileURL } from 'node:url';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

/** The JSON string between two tags of Freero's prompt, decoded ('' when absent). */
function block(text, tag) {
  const a = text.indexOf(`<${tag}>`);
  const b = text.indexOf(`</${tag}>`);
  if (a < 0 || b < a) return '';
  try {
    return JSON.parse(text.slice(a + tag.length + 2, b).trim());
  } catch {
    return '';
  }
}

const TOOLING = /build|test|deploy|ci\b|slow|flaky|pipeline|bug|tool/i;
const PEOPLE = /pair|review|offsite|team|fun|mentor|help|people|retro/i;

/** A plausible answer for the task the system prompt names. */
export function answer(system, user) {
  const instruction = block(user, 'instruction');
  const content = block(user, 'board_content');
  if (/MALFORMED/.test(instruction)) return 'Sure! Here is what I came up with, in prose instead of JSON.';
  if (/Connection test/.test(user)) return JSON.stringify({ ok: true });
  if (/Task: brainstorm/.test(system)) {
    const topic = instruction.replace(/[.?!]+$/, '').slice(0, 40) || 'the board';
    return JSON.stringify({
      title: 'Fresh ideas',
      ideas: [
        `Two truths and a lie about ${topic}`,
        'One-word check-in round',
        'Share a photo of your desk',
        'Pick a theme song for the sprint',
        'Draw your week as a weather map',
        'Celebrate one small win each',
        'Swap a tip you learned recently',
        'Rate your energy from 1 to 5',
      ],
    });
  }
  if (/Task: sort the numbered notes/.test(system)) {
    const notes = String(content)
      .split('\n')
      .map((l) => /^(\d+)\.\s*(.*)$/.exec(l.trim()))
      .filter(Boolean)
      .map((m) => ({ n: Number(m[1]), text: m[2] }));
    const tooling = notes.filter((x) => TOOLING.test(x.text)).map((x) => x.n);
    const people = notes.filter((x) => !TOOLING.test(x.text) && PEOPLE.test(x.text)).map((x) => x.n);
    const rest = notes.filter((x) => !tooling.includes(x.n) && !people.includes(x.n)).map((x) => x.n);
    const clusters = [
      { title: 'Tooling and speed', notes: tooling },
      { title: 'Team and collaboration', notes: people },
      { title: 'Everything else', notes: rest },
    ].filter((c) => c.notes.length);
    return JSON.stringify({ clusters });
  }
  if (/Task: summarise/.test(system)) {
    const items = String(content)
      .split('\n')
      .map((l) => /\] [a-z]+(?: [a-z]+)?: (.*)$/.exec(l))
      .filter(Boolean)
      .map((m) => m[1]);
    return JSON.stringify({
      title: 'Where the board stands',
      summary: `The board holds ${items.length} notes. The team is most concerned with speed of delivery and wants to keep the habits that help them work together.`,
      points: items.slice(0, 5).map((t) => `Raised: ${t}`),
    });
  }
  if (/sequence diagram/.test(system) && /Task: draw a sequence/.test(system))
    return JSON.stringify({
      mermaid: 'sequenceDiagram\n  participant U as User\n  participant A as App\n  participant S as Server\n  U->>A: Click save\n  A->>S: POST /save\n  S-->>A: 200 OK\n  A-->>U: Saved',
    });
  if (/Task: draw a mind map/.test(system))
    return JSON.stringify({ outline: 'Launch plan\n  - Product\n    - Beta feedback\n    - Pricing\n  - Marketing\n    - Blog post\n    - Webinar\n  - Support\n    - Docs\n    - FAQ' });
  if (/Task: draw a flowchart/.test(system))
    return JSON.stringify({
      mermaid:
        'flowchart TD\n  A([Ticket opened]) --> B[Triage]\n  B --> C{Bug or question?}\n  C -->|bug| D[Reproduce]\n  C -->|question| E[Answer]\n  D --> F[Fix and release]\n  E --> G([Resolved])\n  F --> G',
    });
  return JSON.stringify({});
}

const tokens = (s) => Math.ceil(String(s).length / 4);

/** Starts the provider. Returns { url, port, requests, close() }; `requests` grows with each call. */
export async function startMockModel({ port = 0, host = '127.0.0.1' } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      /* not JSON */
    }
    requests.push({ method: req.method, path: req.url, headers: req.headers, body });
    const json = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    // Speech to text (OpenAI-compatible, multipart): the model asked for and a canned, timed transcript.
    if (req.method === 'POST' && req.url.endsWith('/audio/transcriptions')) {
      const model = /name="model"\r\n\r\n([^\r]*)/.exec(raw)?.[1] ?? '';
      const last = requests[requests.length - 1];
      last.transcription = { model, hasFile: /name="file"; filename="/.test(raw), contentType: req.headers['content-type'] ?? '' };
      if (!req.headers.authorization) return json(401, { error: { message: 'missing key' } });
      return json(200, {
        text: 'Welcome to the plan. Here is what we decided.',
        segments: [
          { id: 0, start: 0, end: 1.2, text: ' Welcome to the plan.' },
          { id: 1, start: 1.2, end: 2.5, text: ' Here is what we decided.' },
        ],
      });
    }
    if (req.method !== 'POST' || !body) return json(404, { error: { message: 'not found' } });
    if (req.url.endsWith('/v1/messages')) {
      if (!req.headers['x-api-key']) return json(401, { error: { type: 'authentication_error', message: 'missing x-api-key' } });
      const user = body.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
      const text = answer(body.system ?? '', user);
      return json(200, {
        id: `msg_mock_${requests.length}`,
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        usage: { input_tokens: tokens(raw), output_tokens: tokens(text) },
      });
    }
    if (req.url.endsWith('/chat/completions')) {
      const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
      const user = body.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
      const text = answer(system, user);
      return json(200, {
        id: `chatcmpl-mock-${requests.length}`,
        object: 'chat.completion',
        model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: tokens(raw), completion_tokens: tokens(text) },
      });
    }
    return json(404, { error: { message: `no route ${req.url}` } });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actual = server.address().port;
  return {
    port: actual,
    url: `http://${host}:${actual}`,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : dflt;
  };
  const m = await startMockModel({ port: Number(arg('--port', '4402')) });
  console.log(`mock model provider on ${m.url} (Anthropic: ${m.url}, OpenAI-compatible: ${m.url}/v1)`);
}
