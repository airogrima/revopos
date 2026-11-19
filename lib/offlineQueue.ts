import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { getClient, secureStorage } from "./supabase";
import { friendly, newKey } from "./perms";

/**
 * Persistent offline queue.
 *
 * Operations are written to the device keystore BEFORE the app tells the person
 * the work is saved, so they survive a crash or the app being closed. Each has
 * a stable local id that doubles as its idempotency key:
 *  - pos_checkout is idempotent on its key in the database, so a retry after a
 *    lost response cannot post the sale, its payments, its stock movements or
 *    its journal entry twice.
 *  - receive_serials is protected by the unique serial/IMEI constraint; an
 *    operation that was already sent once and now reports "already recorded"
 *    is treated as done.
 * Operations are sent strictly in the order they were made. If one cannot be
 * sent because of a connection problem, everything after it waits. If one is
 * refused for good (Failed), later operations that touch the same group
 * (e.g. the same product) are held back so a sale is never sent ahead of the
 * stock it depends on.
 */

export type QueueStatus = "waiting" | "failed";
export type QueueKind = "pos_checkout" | "receive_serials";
export interface QueueOp {
  id: string;
  kind: QueueKind;
  orgId: string;
  /** RPC arguments without the staff token; it is added at send time. */
  args: Record<string, unknown>;
  staffId: string | null;
  /** Operations in the same group are never reordered around a failure. */
  group: string;
  label: string;
  totalKobo: number;
  createdAt: number;
  status: QueueStatus;
  error?: string;
  sent: boolean;
  attempts: number;
}

const KEY = "rp_offline_queue_v1";
let ops: QueueOp[] = [];
let loaded = false;
let flushing = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

async function persist() {
  try { await secureStorage.setItem(KEY, JSON.stringify(ops)); } catch { /* keep in memory */ }
}

export async function loadQueue(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await secureStorage.getItem(KEY);
    if (raw) ops = (JSON.parse(raw) as QueueOp[]).filter((o) => o && o.id && o.kind);
  } catch { ops = []; }
  loaded = true;
  emit();
}

export const queueItems = () => ops;
export const newOpId = newKey;

export async function enqueue(op: Omit<QueueOp, "createdAt" | "status" | "sent" | "attempts" | "id"> & { id?: string }): Promise<QueueOp> {
  await loadQueue();
  const full: QueueOp = { ...op, id: op.id ?? newKey(), createdAt: Date.now(), status: "waiting", sent: false, attempts: 0 };
  ops = [...ops, full];
  await persist(); emit();
  return full;
}

export async function discard(id: string) { ops = ops.filter((o) => o.id !== id); await persist(); emit(); }
export async function retry(id: string) {
  ops = ops.map((o) => (o.id === id ? { ...o, status: "waiting", error: undefined } : o));
  await persist(); emit();
}

const isNetwork = (m: string) => /network|fetch|timeout|failed to connect|offline/i.test(m);

/** Send what can be sent, oldest first. `token` is the acting staff session, if any. */
export async function flush(currentStaffId: string | null, token: string | null): Promise<void> {
  await loadQueue();
  if (flushing || ops.length === 0) return;
  flushing = true;
  const blocked = new Set<string>();
  try {
    const client = await getClient();
    for (const op of [...ops]) {
      if (op.status === "failed") { blocked.add(op.group); continue; }
      if (blocked.has(op.group)) continue;
      // A sale rung up by one person is only sent under that person's session.
      if (op.staffId && op.staffId !== currentStaffId) { blocked.add(op.group); continue; }
      const fn = op.kind;
      ops = ops.map((o) => (o.id === op.id ? { ...o, sent: true, attempts: o.attempts + 1 } : o));
      await persist();
      const { error } = await client.rpc(fn, { ...op.args, p_staff_token: op.staffId ? token : null });
      if (!error) { ops = ops.filter((o) => o.id !== op.id); await persist(); emit(); continue; }
      if (isNetwork(error.message)) break; // still offline: everything later waits too
      if (/locked|28000/i.test(error.message)) { blocked.add(op.group); continue; } // needs a PIN, not a failure
      if (op.kind === "receive_serials" && op.sent && /already recorded/i.test(error.message)) {
        ops = ops.filter((o) => o.id !== op.id); await persist(); emit(); continue;
      }
      ops = ops.map((o) => (o.id === op.id ? { ...o, status: "failed", error: friendly(error.message) } : o));
      blocked.add(op.group);
      await persist(); emit();
    }
  } catch { /* offline */ }
  finally { flushing = false; emit(); }
}

export type SyncState = "synced" | "waiting" | "failed";

/** Live view of the queue plus a periodic and on-foreground retry. */
export function useOfflineQueue(staffId: string | null, token: string | null) {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    void loadQueue().then(() => flush(staffId, token));
    const t = setInterval(() => void flush(staffId, token), 15000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") void flush(staffId, token); });
    return () => { subs.delete(f); clearInterval(t); sub.remove(); };
  }, [staffId, token]);
  const items = ops;
  const state: SyncState = items.some((o) => o.status === "failed") ? "failed" : items.length > 0 ? "waiting" : "synced";
  return { items, state, waiting: items.filter((o) => o.status === "waiting").length, failed: items.filter((o) => o.status === "failed"), syncNow: () => flush(staffId, token) };
}
