// /api/v1/workspaces/:workspaceId/webhooks (#48): a team workspace's webhooks managed by a script —
// the admin console's operations (modules/webhooks: owners and admins only, the same validation,
// SSRF-safe URLs, audit events webhook.*), for a credential with `webhooks:manage` whose person is
// an owner or admin there. The secret is answered once (create, rotate) and never again.
import { useInWorkspace } from '../apiauth/index';
import { requireAdmin } from '../admin/index';
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  redeliverWebhook,
  rotateWebhookSecret,
  testWebhook,
  updateWebhook,
  webhookDeliveries,
} from '../webhooks/index';
import type { ApiCall } from './service';

/** The workspace, once the person is its owner or admin and the team's API policy lets the credential in. */
async function adminOf(call: ApiCall, workspaceId: string): Promise<string> {
  const { name } = await requireAdmin(workspaceId, call.userId);
  await useInWorkspace(call.cred, workspaceId);
  call.audit.workspaceId = workspaceId;
  call.audit.target = { type: 'workspace', id: workspaceId, label: name };
  return workspaceId;
}

const obj = (b: unknown) => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {});

export async function listWebhooksFor(call: ApiCall, workspaceId: string) {
  const ws = await adminOf(call, workspaceId);
  return { webhooks: await listWebhooks(ws, call.userId) };
}

export async function createWebhookFor(call: ApiCall, workspaceId: string, body: unknown) {
  const ws = await adminOf(call, workspaceId);
  const out = await createWebhook(ws, call.userId, obj(body));
  call.audit.metadata = { webhookId: out.endpoint.id };
  return { webhook: out.endpoint, secret: out.secret };
}

export async function updateWebhookFor(call: ApiCall, workspaceId: string, webhookId: string, body: unknown) {
  const ws = await adminOf(call, workspaceId);
  call.audit.metadata = { webhookId };
  return { webhook: await updateWebhook(ws, call.userId, webhookId, obj(body)) };
}

export async function rotateWebhookFor(call: ApiCall, workspaceId: string, webhookId: string) {
  const ws = await adminOf(call, workspaceId);
  call.audit.metadata = { webhookId };
  const out = await rotateWebhookSecret(ws, call.userId, webhookId);
  return { webhook: out.endpoint, secret: out.secret };
}

export async function deleteWebhookFor(call: ApiCall, workspaceId: string, webhookId: string) {
  const ws = await adminOf(call, workspaceId);
  call.audit.metadata = { webhookId };
  await deleteWebhook(ws, call.userId, webhookId);
  return { ok: true as const };
}

export async function testWebhookFor(call: ApiCall, workspaceId: string, webhookId: string) {
  const ws = await adminOf(call, workspaceId);
  call.audit.metadata = { webhookId };
  return { delivery: await testWebhook(ws, call.userId, webhookId) };
}

export async function webhookDeliveriesFor(call: ApiCall, workspaceId: string, webhookId: string) {
  const ws = await adminOf(call, workspaceId);
  call.audit.metadata = { webhookId };
  return { deliveries: await webhookDeliveries(ws, call.userId, webhookId) };
}

export async function redeliverWebhookFor(call: ApiCall, workspaceId: string, webhookId: string, deliveryId: string) {
  const ws = await adminOf(call, workspaceId);
  call.audit.metadata = { webhookId, deliveryId };
  return { delivery: await redeliverWebhook(ws, call.userId, webhookId, deliveryId) };
}
