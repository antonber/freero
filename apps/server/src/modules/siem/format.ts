// What each kind of SIEM receives (pure). One record per audit event — everything the admin console
// shows, its wording, and its place in the hash chain (seq, prevHash, hash: the SIEM holds an
// independent copy of the chain) — plus `freero.audit.head` checkpoints: the log's head as of a
// moment, signed by the server (operators check the signature with audit:verify's key).
import { AUDIT_ACTIONS, type AuditEvent, type SiemSettings } from '@freero/shared';

export interface HeadCheckpoint {
  chain: string;
  seq: number;
  hash: string;
  at: number;
  signature: string;
}

export type SiemRecord =
  | ({ type: 'freero.audit.event'; description: string; time: string } & AuditEvent)
  | { type: 'freero.audit.head'; workspaceId: string; chain: string; seq: number; hash: string; time: string; signature: string }
  /** Sent by "Send test" in the admin console; carries nothing of the log. */
  | { type: 'freero.audit.test'; workspaceId: string; time: string };

export function records(workspaceId: string, events: AuditEvent[], head: HeadCheckpoint | null): SiemRecord[] {
  const out: SiemRecord[] = events.map((e) => ({ type: 'freero.audit.event', description: AUDIT_ACTIONS[e.action] ?? e.action, time: new Date(e.at).toISOString(), ...e }));
  if (head) out.push({ type: 'freero.audit.head', workspaceId, chain: head.chain, seq: head.seq, hash: head.hash, time: new Date(head.at).toISOString(), signature: head.signature });
  return out;
}

const timeOf = (r: SiemRecord) => Date.parse(r.time);

/** Splunk HTTP Event Collector: one JSON object per event, concatenated (the HEC batch format). */
export function splunkBody(rs: SiemRecord[], settings: SiemSettings, host: string): string {
  return rs
    .map((r) =>
      JSON.stringify({
        time: timeOf(r) / 1000,
        host,
        source: 'freero',
        sourcetype: settings.sourcetype || 'freero:audit',
        ...(settings.index ? { index: settings.index } : {}),
        event: r,
      }),
    )
    .join('\n');
}

/** Microsoft Sentinel (Azure Monitor Logs Ingestion API): an array of flat rows for the DCR's stream. */
export function sentinelBody(rs: SiemRecord[]): string {
  return JSON.stringify(
    rs.map((r) =>
      r.type === 'freero.audit.test'
        ? { TimeGenerated: r.time, RecordType: 'test', WorkspaceId: r.workspaceId }
        : r.type === 'freero.audit.head'
        ? { TimeGenerated: r.time, RecordType: 'head', WorkspaceId: r.workspaceId, Chain: r.chain, Seq: r.seq, Hash: r.hash, Signature: r.signature }
        : {
            TimeGenerated: r.time,
            RecordType: 'event',
            EventId: r.id,
            Action: r.action,
            Description: r.description,
            WorkspaceId: r.workspaceId,
            ActorId: r.actor?.id ?? null,
            ActorName: r.actor?.name ?? null,
            ActorEmail: r.actor?.email ?? null,
            TargetType: r.target?.type ?? null,
            TargetId: r.target?.id ?? null,
            TargetLabel: r.target?.label ?? null,
            IpAddress: r.ip,
            UserAgent: r.userAgent,
            Metadata: r.metadata,
            Chain: r.chain,
            Seq: r.seq,
            PrevHash: r.prevHash,
            Hash: r.hash,
          },
    ),
  );
}

/** A generic HTTPS collector: one JSON document per batch (signed with the sink's secret). */
export function httpsBody(workspaceId: string, rs: SiemRecord[]): string {
  return JSON.stringify({ source: 'freero', workspaceId, records: rs });
}

// RFC 5424 over TLS (RFC 5425): facility 13 (log audit), severity 6 (informational).
const PRI = 13 * 8 + 6;
const msgId = (s: string) => s.replace(/[^\x21-\x7e]/g, '_').slice(0, 32) || '-';

/** One syslog message per record; the JSON record is the MSG. */
export function syslogMessages(rs: SiemRecord[], host: string): string[] {
  const hostname = msgId(host).slice(0, 255);
  return rs.map((r) => `<${PRI}>1 ${r.time} ${hostname} freero - ${msgId(r.type === 'freero.audit.event' ? r.action : r.type)} - ${JSON.stringify(r)}`);
}
