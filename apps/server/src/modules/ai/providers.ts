// Model provider adapters (plain HTTP, no vendor SDKs): the Anthropic Messages API and any
// OpenAI-compatible chat completions endpoint (OpenAI, Azure OpenAI's v1 API, Ollama, vLLM,
// LM Studio …). One call in, one text reply out, with the tokens it used.
//
// Endpoints a workspace's admins typed in are untrusted: they are called only over https unless
// the operator allows private endpoints, never follow redirects, and their host must not resolve
// to a private, loopback or link-local address (checked when connecting, so DNS rebinding can't
// slip one in). The operator's own endpoint (AI_BASE_URL) is trusted: a local model is fine there.
// Keys travel only in request headers and never appear in errors or logs.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { estimateTokens, type AiProviderKind } from '@freero/shared';
import { isBlockedAddress } from '../unfurl/index';

/** Anthropic API version sent with every Messages request. */
export const ANTHROPIC_VERSION = '2026-10-21';
/** Largest reply body read from a provider. */
const MAX_REPLY_BYTES = 4 * 1024 * 1024;

export interface ProviderEndpoint {
  provider: AiProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Configured by a workspace (untrusted URL) rather than the operator. */
  untrusted: boolean;
}

export interface ModelCall {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens: number;
  /** JSON Schema the reply must follow (sent where the provider supports structured output). */
  schema?: Record<string, unknown>;
  timeoutMs: number;
}

export interface ModelReply {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** The provider stopped because of its output limit: the JSON may be cut off. */
  truncated: boolean;
}

/** The provider can't be reached, refused the call, or answered something unusable. Safe to show. */
export class ProviderError extends Error {
  constructor(
    message: string,
    /** Tokens the failed call still used, when the provider said. */
    readonly usage: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 },
  ) {
    super(message);
  }
}

// ---- HTTP ----

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb): void {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    const addrs = (list as dns.LookupAddress[] | undefined) ?? [];
    if (err) return cb(err, '');
    if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address)))
      return cb(Object.assign(new ProviderError('The AI endpoint resolves to a private address, which this server doesn’t call.'), { code: 'EBLOCKED' }), '');
    if (options.all) cb(null, addrs);
    else cb(null, addrs[0].address, addrs[0].family);
  });
}

export interface EndpointRules {
  /** Refuse private / loopback addresses (workspace endpoints, unless the operator allows them). */
  blockPrivate: boolean;
  /** Only https (workspace endpoints, unless the operator allows private endpoints). */
  httpsOnly: boolean;
}

/** Throws a ProviderError unless `raw` is an endpoint these rules let the server call. */
export function checkEndpoint(raw: string, rules: EndpointRules): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError('The AI endpoint is not a valid URL.');
  }
  if (url.protocol !== 'https:' && (rules.httpsOnly || url.protocol !== 'http:')) throw new ProviderError('The AI endpoint must be an https:// URL.');
  if (url.username || url.password) throw new ProviderError('Put the key in the key field, not in the URL.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (rules.blockPrivate && (host === 'localhost' || (net.isIP(host) && isBlockedAddress(host))))
    throw new ProviderError('The AI endpoint is a private address, which this server doesn’t call.');
  return url;
}

/** POSTs JSON and reads a JSON reply (no redirects, one deadline, a byte cap). */
export function postJson(raw: string, headers: Record<string, string>, body: unknown, opts: { timeoutMs: number; rules: EndpointRules }): Promise<{ status: number; json: unknown }> {
  return postBody(raw, headers, Buffer.from(JSON.stringify(body)), 'application/json', opts);
}

/** POSTs `payload` as `contentType` and reads a JSON reply, under the same rules as postJson. */
function postBody(
  raw: string,
  headers: Record<string, string>,
  payload: Buffer,
  contentType: string,
  opts: { timeoutMs: number; rules: EndpointRules },
): Promise<{ status: number; json: unknown }> {
  const url = checkEndpoint(raw, opts.rules);
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': contentType, 'content-length': String(payload.length), accept: 'application/json' },
        timeout: opts.timeoutMs,
        ...(opts.rules.blockPrivate ? { lookup: guardedLookup as unknown as net.LookupFunction } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_REPLY_BYTES) req.destroy(new ProviderError('The AI provider’s answer was too large.'));
          else chunks.push(c);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not JSON: the status decides */
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
        res.on('error', reject);
      },
    );
    const deadline = setTimeout(() => req.destroy(new ProviderError('The AI provider took too long to answer.')), opts.timeoutMs);
    req.on('timeout', () => req.destroy(new ProviderError('The AI provider took too long to answer.')));
    req.on('error', (e) => {
      clearTimeout(deadline);
      reject(e instanceof ProviderError ? e : new ProviderError(`Couldn’t reach the AI provider (${(e as NodeJS.ErrnoException).code ?? 'network error'}).`));
    });
    req.on('close', () => clearTimeout(deadline));
    req.end(payload);
  });
}

const errorMessage = (json: unknown): string | null => {
  const e = (json as { error?: { message?: unknown } | string } | null)?.error;
  const m = typeof e === 'string' ? e : e?.message;
  return typeof m === 'string' ? m.slice(0, 300) : null;
};

function failed(status: number, json: unknown): ProviderError {
  const detail = errorMessage(json);
  if (status === 401 || status === 403) return new ProviderError('The AI provider refused the key. An admin needs to check the AI settings.');
  if (status === 429) return new ProviderError('The AI provider is rate limiting this key. Try again in a minute.');
  if (status === 404) return new ProviderError(`The AI provider doesn’t know this endpoint or model${detail ? `: ${detail}` : '.'}`);
  return new ProviderError(`The AI provider answered ${status}${detail ? `: ${detail}` : '.'}`);
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

// ---- adapters ----

async function anthropic(ep: ProviderEndpoint, call: ModelCall, rules: EndpointRules): Promise<ModelReply> {
  const body: Record<string, unknown> = {
    model: ep.model,
    max_tokens: call.maxTokens,
    system: call.system,
    messages: call.messages,
  };
  if (call.schema) body.output_config = { format: { type: 'json_schema', schema: call.schema } };
  const { status, json } = await postJson(
    `${ep.baseUrl.replace(/\/+$/, '')}/v1/messages`,
    { 'x-api-key': ep.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    body,
    { timeoutMs: call.timeoutMs, rules },
  );
  if (status < 200 || status >= 300) throw failed(status, json);
  const r = json as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number }; stop_reason?: string };
  const usage = { inputTokens: num(r?.usage?.input_tokens) ?? 0, outputTokens: num(r?.usage?.output_tokens) ?? 0 };
  if (r?.stop_reason === 'refusal') throw new ProviderError('The model declined this request.', usage);
  const text = (r?.content ?? []).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
  return { text, ...usage, truncated: r?.stop_reason === 'max_tokens' };
}

async function openai(ep: ProviderEndpoint, call: ModelCall, rules: EndpointRules): Promise<ModelReply> {
  // No response_format: local servers differ in what they accept. The prompt asks for JSON and the
  // reply is validated like any other.
  const headers: Record<string, string> = ep.apiKey ? { authorization: `Bearer ${ep.apiKey}`, 'api-key': ep.apiKey } : {};
  const { status, json } = await postJson(
    `${ep.baseUrl.replace(/\/+$/, '')}/chat/completions`,
    headers,
    {
      model: ep.model,
      messages: [{ role: 'system', content: call.system }, ...call.messages],
      max_completion_tokens: call.maxTokens,
    },
    { timeoutMs: call.timeoutMs, rules },
  );
  if (status < 200 || status >= 300) throw failed(status, json);
  const r = json as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const choice = r?.choices?.[0];
  const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  return {
    text,
    // Endpoints that don't report usage are metered by an estimate.
    inputTokens: num(r?.usage?.prompt_tokens) ?? estimateTokens(call.system + call.messages.map((m) => m.content).join('')),
    outputTokens: num(r?.usage?.completion_tokens) ?? estimateTokens(text),
    truncated: choice?.finish_reason === 'length',
  };
}

/** A recording's speech as timed text. */
export interface Transcription {
  segments: Array<{ start: number; end: number; text: string }>;
  /** The whole text (when the endpoint gives no segments, one segment holds it). */
  text: string;
}

/**
 * Speech to text through an OpenAI-compatible endpoint's `/audio/transcriptions` (multipart, the
 * one wire format such endpoints share: OpenAI, Azure OpenAI v1, whisper servers, vLLM). The
 * Anthropic Messages API has no speech input: callers check `provider` first.
 */
export async function transcribe(
  ep: ProviderEndpoint,
  audio: { bytes: Buffer; contentType: string; fileName: string },
  model: string,
  opts: { allowPrivate: boolean; timeoutMs: number },
): Promise<Transcription> {
  const rules: EndpointRules = ep.untrusted ? { blockPrivate: !opts.allowPrivate, httpsOnly: !opts.allowPrivate } : { blockPrivate: false, httpsOnly: false };
  const boundary = `freero${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const field = (name: string, value: string) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  const payload = Buffer.concat([
    field('model', model),
    field('response_format', 'verbose_json'),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${audio.fileName}"\r\nContent-Type: ${audio.contentType}\r\n\r\n`),
    audio.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const headers: Record<string, string> = ep.apiKey ? { authorization: `Bearer ${ep.apiKey}`, 'api-key': ep.apiKey } : {};
  const { status, json } = await postBody(`${ep.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, headers, payload, `multipart/form-data; boundary=${boundary}`, {
    timeoutMs: opts.timeoutMs,
    rules,
  });
  if (status < 200 || status >= 300) throw failed(status, json);
  const r = json as { text?: unknown; segments?: Array<{ start?: unknown; end?: unknown; text?: unknown }> } | null;
  const text = typeof r?.text === 'string' ? r.text : '';
  const segments = (Array.isArray(r?.segments) ? r.segments : [])
    .map((s) => ({ start: num(s?.start), end: num(s?.end), text: typeof s?.text === 'string' ? s.text.trim() : '' }))
    .filter((s): s is { start: number; end: number; text: string } => s.start !== null && s.end !== null && !!s.text);
  if (!text && !segments.length) throw new ProviderError('The AI provider’s transcription came back empty.');
  return { segments, text };
}

/** One model call through the endpoint's provider. */
export function callModel(ep: ProviderEndpoint, call: ModelCall, opts: { allowPrivate: boolean }): Promise<ModelReply> {
  const rules: EndpointRules = ep.untrusted ? { blockPrivate: !opts.allowPrivate, httpsOnly: !opts.allowPrivate } : { blockPrivate: false, httpsOnly: false };
  return ep.provider === 'anthropic' ? anthropic(ep, call, rules) : openai(ep, call, rules);
}
