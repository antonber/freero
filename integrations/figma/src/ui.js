// The Freero plugin's page (#172): sign-in, the board picker and sending. Inlined after freero.js
// by build.mjs (its exports become plain declarations here). Talks to the sandbox (code.js) with
// postMessage and to Freero with fetch.
const $ = (id) => document.getElementById(id);
const toCode = (msg) => parent.postMessage({ pluginMessage: msg }, '*');
const state = { saved: {}, selection: [], fileKey: null, client: null, pending: null, exports: new Map() };

function status(text, error = false) {
  $('status').textContent = text;
  $('status').className = error ? 'error' : 'muted';
}

function save() {
  toCode({ type: 'save', saved: state.saved });
}

function show() {
  const signedIn = !!state.client;
  $('signin').hidden = signedIn;
  $('send').hidden = !signedIn;
  $('filekey').hidden = !!state.fileKey;
  const n = state.selection.length;
  $('selected').textContent = n ? `${n} selected: ${state.selection.map((s) => s.name).slice(0, 3).join(', ')}${n > 3 ? '…' : ''}` : 'Select one or more frames to send.';
  $('go').disabled = !n || !$('boards').value;
}

async function connect(auth) {
  const server = state.saved.server;
  const client = new FreeroClient({
    server,
    auth,
    onTokens: (next) => {
      state.saved.auth = next;
      save();
    },
  });
  const me = await client.me();
  state.client = client;
  state.saved.auth = auth;
  save();
  $('who').textContent = `Signed in as ${me.user?.name ?? me.name ?? me.user?.email ?? 'you'}`;
  await loadBoards('');
  status('');
  show();
}

async function loadBoards(q) {
  const boards = await state.client.boards(q);
  const sel = $('boards');
  sel.replaceChildren(...boards.map((b) => Object.assign(document.createElement('option'), { value: b.id, textContent: b.title || 'Untitled' })));
  const last = state.saved.boards?.[state.saved.server];
  if (last && boards.some((b) => b.id === last)) sel.value = last;
  else if (boards[0]) sel.value = boards[0].id;
  show();
}

function serverOrComplain() {
  const server = serverOrigin($('server').value);
  if (!server) {
    status('Enter your Freero address, like freero.app.', true);
    return null;
  }
  state.saved.server = server;
  return server;
}

$('oauth').onclick = async () => {
  const server = serverOrComplain();
  if (!server) return;
  try {
    const known = state.saved.clientIds?.[server] ?? null;
    state.pending = await startSignIn(server, { clientId: known });
    state.saved.clientIds = { ...state.saved.clientIds, [server]: state.pending.clientId };
    save();
    toCode({ type: 'open', url: state.pending.authorizeUrl });
    $('waiting').hidden = false;
    const pending = state.pending;
    const until = Date.now() + 5 * 60_000;
    while (state.pending === pending && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2000));
      const tokens = await pickUpSignIn(pending);
      if (tokens) {
        state.pending = null;
        $('waiting').hidden = true;
        await connect(tokens);
        return;
      }
    }
    $('waiting').hidden = true;
  } catch (e) {
    status(e.message, true);
  }
};

$('useToken').onclick = async () => {
  if (!serverOrComplain()) return;
  const token = $('token').value.trim();
  if (!token) return status('Paste a token from Freero → Settings → API tokens.', true);
  try {
    await connect({ token });
    $('token').value = '';
  } catch (e) {
    status(e.status === 401 ? 'Freero didn’t accept that token.' : e.message, true);
  }
};

$('signout').onclick = () => {
  state.client = null;
  delete state.saved.auth;
  save();
  show();
};

let searchTimer = 0;
$('search').oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadBoards($('search').value.trim()).catch((e) => status(e.message, true)), 250);
};
$('boards').onchange = () => {
  state.saved.boards = { ...state.saved.boards, [state.saved.server]: $('boards').value };
  save();
  show();
};
$('filelink').onchange = () => {
  const key = fileKeyOf($('filelink').value);
  if (!key) return status('That isn’t a link to a Figma design file.', true);
  status('');
  toCode({ type: 'fileKey', key });
};

/** The sandbox's PNG of one frame (and the item it became on this board before). */
function exportFrame(id, boardKey) {
  return new Promise((resolve) => {
    state.exports.set(id, resolve);
    toCode({ type: 'export', id, boardKey });
  });
}

$('go').onclick = async () => {
  const boardId = $('boards').value;
  const boardKey = `${state.saved.server}|${boardId}`;
  $('go').disabled = true;
  let sent = 0;
  let updated = 0;
  try {
    for (const frame of state.selection) {
      status(`Sending ${frame.name}…`);
      const out = await exportFrame(frame.id, boardKey);
      if (out.error) {
        status(`Figma couldn’t export ${frame.name}.`, true);
        continue;
      }
      const link = state.fileKey ? frameLink(state.fileKey, frame.id) : undefined;
      const r = await state.client.sendPicture(boardId, out.bytes, { link, alt: out.name, replace: out.replace ?? undefined });
      if (r.item) toCode({ type: 'remember', id: frame.id, boardKey, itemId: r.item.id });
      if (r.replaced) updated++;
      else sent++;
    }
    status(updated ? `Sent ${sent} new, updated ${updated}.` : `Sent ${sent}.`);
    toCode({ type: 'notify', text: 'Sent to Freero' });
    $('openBoard').hidden = false;
  } catch (e) {
    status(e.status === 413 ? 'That frame is too large for this Freero server.' : e.message, true);
  } finally {
    show();
  }
};
$('openBoard').onclick = () => toCode({ type: 'open', url: `${state.saved.server}/board/${encodeURIComponent($('boards').value)}` });

window.onmessage = async (event) => {
  const msg = event.data?.pluginMessage;
  if (!msg) return;
  if (msg.type === 'saved') {
    state.saved = msg.saved ?? {};
    $('server').value = state.saved.server ?? '';
    if (state.saved.auth && state.saved.server) await connect(state.saved.auth).catch(() => status('Sign in to Freero again.'));
    show();
  } else if (msg.type === 'selection') {
    state.selection = msg.items;
    state.fileKey = msg.fileKey;
    show();
  } else if (msg.type === 'exported') {
    state.exports.get(msg.id)?.(msg);
    state.exports.delete(msg.id);
  }
};

toCode({ type: 'ready' });
