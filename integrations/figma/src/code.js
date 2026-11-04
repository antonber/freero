// The Freero plugin for Figma (#172) — the part that runs in Figma's sandbox: it reads the
// selection, exports frames as PNG, remembers which Freero picture each frame became (per board, in
// the frame's plugin data, so sending again updates it) and keeps the sign-in in Figma's client
// storage. Everything that talks to Freero runs in the plugin's page (ui.js), which has the network.
// Written for Figma's sandbox: no optional chaining or nullish coalescing.

var DEFAULT_SERVER = '__FREERO_URL__';
var MAX_SIDE = 4096;

figma.showUI(__html__, { width: 360, height: 560, themeColors: true });

function exportable(node) {
  return node && typeof node.exportAsync === 'function' && 'width' in node && node.type !== 'SLICE';
}

function selection() {
  return figma.currentPage.selection.filter(exportable).map(function (n) {
    return { id: n.id, name: n.name, type: n.type, w: Math.round(n.width), h: Math.round(n.height) };
  });
}

function fileKey() {
  // Figma tells private and organisation plugins the file's key; a Community plugin asks the person
  // for the file's link once and keeps the key with the file.
  return figma.fileKey || figma.root.getPluginData('freero:fileKey') || null;
}

// With "documentAccess": "dynamic-page" (the manifest), nodes are looked up asynchronously.
function nodeById(id) {
  return figma.getNodeByIdAsync ? figma.getNodeByIdAsync(id) : Promise.resolve(figma.getNodeById(id));
}

function send() {
  figma.ui.postMessage({ type: 'selection', items: selection(), fileKey: fileKey() });
}

figma.on('selectionchange', send);

figma.ui.onmessage = function (msg) {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'ready') {
    figma.clientStorage.getAsync('freero').then(function (saved) {
      figma.ui.postMessage({ type: 'saved', saved: saved || { server: DEFAULT_SERVER } });
      send();
    });
  } else if (msg.type === 'save') {
    figma.clientStorage.setAsync('freero', msg.saved);
  } else if (msg.type === 'fileKey') {
    figma.root.setPluginData('freero:fileKey', String(msg.key || ''));
    send();
  } else if (msg.type === 'open') {
    figma.openExternal(String(msg.url));
  } else if (msg.type === 'export') {
    nodeById(msg.id)
      .then(function (node) {
        if (!exportable(node)) throw new Error('gone');
        var scale = Math.min(2, MAX_SIDE / Math.max(node.width, node.height, 1));
        return node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } }).then(function (bytes) {
          figma.ui.postMessage({ type: 'exported', id: node.id, name: node.name, bytes: bytes, replace: node.getPluginData('freero:' + msg.boardKey) || null });
        });
      })
      .catch(function () {
        figma.ui.postMessage({ type: 'exported', id: msg.id, error: 'export' });
      });
  } else if (msg.type === 'remember') {
    nodeById(msg.id).then(function (target) {
      if (target && typeof target.setPluginData === 'function') target.setPluginData('freero:' + msg.boardKey, String(msg.itemId));
    });
  } else if (msg.type === 'notify') {
    figma.notify(String(msg.text));
  } else if (msg.type === 'close') {
    figma.closePlugin();
  }
};
