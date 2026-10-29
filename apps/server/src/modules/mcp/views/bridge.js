// The view side of the MCP Apps protocol (io.modelcontextprotocol/ui, spec 2026-01-26): JSON-RPC
// over postMessage with the host that frames this view. Small on purpose (no SDK bundle): the view
// asks to initialize, says it is ready, receives the tool's input and result as notifications,
// reports its size, and may ask the host to open a link, change display mode or call a tool of
// this server. Only messages from the parent window are read.
var FreeroBridge = (function () {
  var nextId = 0;
  var waiting = new Map();
  var handlers = {};
  function post(msg) {
    window.parent.postMessage(msg, '*');
  }
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var m = e.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.id !== undefined && m.method === undefined) {
      var w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message || 'The assistant refused'));
      else w.resolve(m.result);
      return;
    }
    if (typeof m.method !== 'string') return;
    var result = {};
    try {
      var h = handlers[m.method];
      if (h) result = h(m.params || {}) || {};
    } catch (err) {
      /* a handler's failure is the view's own problem, never the host's */
    }
    if (m.id !== undefined) post({ jsonrpc: '2.0', id: m.id, result: result });
  });
  return {
    request: function (method, params) {
      var id = ++nextId;
      post({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
      return new Promise(function (resolve, reject) {
        waiting.set(id, { resolve: resolve, reject: reject });
        setTimeout(function () {
          if (waiting.delete(id)) reject(new Error('The assistant did not answer'));
        }, 60000);
      });
    },
    notify: function (method, params) {
      post({ jsonrpc: '2.0', method: method, params: params || {} });
    },
    on: function (method, fn) {
      handlers[method] = fn;
    },
    /** Initializes with the host; `onContext(hostContext)` runs now and on every change. */
    start: function (name, onContext) {
      handlers['ui/notifications/host-context-changed'] = function (ctx) {
        onContext(ctx || {});
      };
      return this.request('ui/initialize', {
        appInfo: { name: name, version: '1.0.0' },
        appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
        protocolVersion: '2026-01-26',
      }).then(function (init) {
        onContext((init && init.hostContext) || {});
        FreeroBridge.notify('ui/notifications/initialized', {});
        // The host sizes the frame to the view.
        var last = 0;
        var report = function () {
          var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
          if (h !== last) {
            last = h;
            FreeroBridge.notify('ui/notifications/size-changed', { height: h });
          }
        };
        new ResizeObserver(report).observe(document.documentElement);
        report();
        return init || {};
      });
    },
    openLink: function (url) {
      return this.request('ui/open-link', { url: url });
    },
  };
})();

/** Light or dark, as the host says (or the system, before it does). */
function freeroApplyTheme(ctx) {
  var theme = ctx && (ctx.theme === 'dark' || ctx.theme === 'light') ? ctx.theme : null;
  if (theme) document.documentElement.setAttribute('data-theme', theme);
}
