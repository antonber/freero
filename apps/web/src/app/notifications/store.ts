// The signed-in user's notifications for this tab: the unread count (kept live over
// /ws/notifications while any bell is mounted) and the inbox, loaded when it is opened.
import { createStore, useStore } from 'zustand';
import type { AppNotification, NotificationsLiveMessage } from '@freero/shared';
import { api, wsBase } from '../api/client';

export interface NotificationsState {
  unread: number;
  items: AppNotification[] | null;
  hasMore: boolean;
  loading: boolean;
  error: boolean;
}

const initial: NotificationsState = { unread: 0, items: null, hasMore: false, loading: false, error: false };
export const notificationsStore = createStore<NotificationsState>(() => initial);

export function useNotifications<T>(sel: (s: NotificationsState) => T): T {
  return useStore(notificationsStore, sel);
}

/** First page (again): on open, and on every live change while the list is loaded. */
export async function loadNotifications(): Promise<void> {
  notificationsStore.setState({ loading: true, error: false });
  try {
    const r = await api.listNotifications();
    notificationsStore.setState({ items: r.notifications, unread: r.unread, hasMore: r.hasMore, loading: false });
  } catch {
    notificationsStore.setState({ loading: false, error: true });
  }
}

export async function loadMoreNotifications(): Promise<void> {
  const { items, loading } = notificationsStore.getState();
  if (!items?.length || loading) return;
  notificationsStore.setState({ loading: true });
  try {
    const r = await api.listNotifications(items[items.length - 1].createdAt);
    const seen = new Set(items.map((n) => n.id));
    notificationsStore.setState({ items: [...items, ...r.notifications.filter((n) => !seen.has(n.id))], hasMore: r.hasMore, loading: false });
  } catch {
    notificationsStore.setState({ loading: false });
  }
}

/** Marks some (or, without ids, all) read; the list updates at once, the count from the server. */
export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const now = Date.now();
  const { items } = notificationsStore.getState();
  notificationsStore.setState({
    items: items?.map((n) => (!n.readAt && (!ids || ids.includes(n.id)) ? { ...n, readAt: now } : n)) ?? null,
  });
  try {
    const { unread } = await api.markNotificationsRead(ids);
    notificationsStore.setState({ unread });
  } catch {
    // The badge corrects itself on the next live message or reload.
  }
}

// ---- live connection (one per tab, while any bell is mounted) ----

let users = 0;
let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let closing: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let account: string | null = null;

/** How long the socket outlives the last bell (dashboard → board keeps one connection). */
const LINGER_MS = 3000;

function open(): void {
  const ws = new WebSocket(`${wsBase()}/ws/notifications`);
  socket = ws;
  ws.onopen = () => {
    attempt = 0;
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(String(e.data)) as NotificationsLiveMessage;
      if (msg.type !== 'changed') return;
      const changed = msg.unread !== notificationsStore.getState().unread;
      notificationsStore.setState({ unread: msg.unread });
      if (changed && notificationsStore.getState().items) void loadNotifications();
    } catch {
      // not ours
    }
  };
  ws.onclose = (e) => {
    if (socket !== ws) return;
    socket = null;
    // 4401: signed out (here or elsewhere) — nothing to reconnect to.
    if (users === 0 || e.code === 4401) return;
    // Changes missed meanwhile arrive with the next connection's first message (the unread count).
    const delay = Math.min(30_000, 1000 * 2 ** attempt++);
    retry = setTimeout(() => {
      retry = null;
      if (users > 0 && !socket) open();
    }, delay);
  };
}

function disconnect(): void {
  if (retry) clearTimeout(retry);
  if (closing) clearTimeout(closing);
  retry = closing = null;
  const ws = socket;
  socket = null;
  ws?.close(1000);
}

/**
 * Keeps `userId`'s unread count live while the caller is mounted; returns the release function.
 * Another account than before (sign-out, sign-in as someone else) starts from scratch.
 */
export function retainLiveConnection(userId: string): () => void {
  if (account !== userId) {
    disconnect();
    notificationsStore.setState(initial);
    account = userId;
  }
  users++;
  if (closing) clearTimeout(closing);
  closing = null;
  if (!socket && !retry) {
    attempt = 0;
    open();
  }
  return () => {
    users--;
    if (users > 0) return;
    closing = setTimeout(disconnect, LINGER_MS);
  };
}
