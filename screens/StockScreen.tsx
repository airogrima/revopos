/**
 * Stock on the phone: what is on hand, what is low, and quick receive / adjust /
 * write-off. Quantities come from item_stock_levels; every change goes through
 * record_stock_movement, so permissions, manager approval for adjustments and
 * the audit log work exactly as on the web.
 */
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getClient } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { friendly } from "../lib/perms";
import { needsApproval, sessionLocked, useTerminal } from "../lib/terminal";
import { useModules } from "../lib/modules";
import { C } from "../theme";
import { Card, EmptyState, ErrorView, Loading, Row, Screen, ScreenTitle, u } from "../components/ui";
import { Chips, Ghost, Input, Message, Primary } from "../components/mini";
import { ApprovalSheet, PinGate, TerminalBar } from "../components/Terminal";

interface Level { item_id: string; name: string; sku: string | null; unit: string | null; reorder_level: number | null; quantity_on_hand: number }
type Kind = "addition" | "adjustment" | "damaged" | "lost";
const KINDS: { value: Kind; label: string }[] = [
  { value: "addition", label: "Received" }, { value: "adjustment", label: "Count fix" },
  { value: "damaged", label: "Damaged" }, { value: "lost", label: "Lost" },
];

export default function StockScreen() {
  return (
    <Screen>
      <TerminalBar />
      <PinGate><Body /></PinGate>
    </Screen>
  );
}

function Body() {
  const { orgId } = useOrg();
  const term = useTerminal();
  const { has, can } = useModules();
  const { loading, error, data, reload } = useOrgData<Level[]>(async (c, org) => {
    const { data: d, error: e } = await c.from("item_stock_levels").select("item_id,name,sku,unit,reorder_level,quantity_on_hand").eq("org_id", org).order("name");
    if (e) throw new Error(e.message);
    return (d ?? []) as Level[];
  });
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [open, setOpen] = useState<Level | null>(null);
  const [kind, setKind] = useState<Kind>("addition");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const retry = useRef<((t: string) => void) | null>(null);

  if (loading) return <Loading label="Loading stock…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  const staffOk = (k: string) => (term.mode ? term.staffCan(k) : can(k));
  if (!has("inventory") || !staffOk("stock.view")) {
    return <EmptyState title="Stock is not available" body="Stock needs the Pro plan and the stock permission. Ask an owner or admin." />;
  }
  const canChange = staffOk("stock.receive") || staffOk("stock.adjust");
  const rows = (data ?? []).filter((l) =>
    (q === "" || l.name.toLowerCase().includes(q.toLowerCase()) || (l.sku ?? "").toLowerCase() === q.toLowerCase()) &&
    (!lowOnly || (l.reorder_level !== null && Number(l.quantity_on_hand) <= Number(l.reorder_level))));
  const isLow = (l: Level) => l.reorder_level !== null && Number(l.quantity_on_hand) <= Number(l.reorder_level);

  const save = async (approver: string | null = null) => {
    const n = Number(qty);
    if (!open || !Number.isFinite(n) || n === 0) return setMsg({ text: "Enter a quantity.", ok: false });
    if (kind === "adjustment" && !note.trim()) return setMsg({ text: "Say why the count changed.", ok: false });
    setBusy(true); term.touch();
    try {
      const c = await getClient();
      const { error: err } = await c.rpc("record_stock_movement", {
        target_org: orgId, target_item: open.item_id, movement: kind, qty: kind === "adjustment" ? n : Math.abs(n),
        unit_cost: null, moved_on: null, ref: null, note_text: note.trim() || null,
        p_staff_token: term.token, p_approver_token: approver,
      });
      if (err) {
        if (sessionLocked(err.message)) { await term.lock(); return; }
        if (!approver && term.mode && needsApproval(err.message)) { retry.current = (t) => void save(t); setAsking(true); return; }
        throw new Error(err.message);
      }
      setMsg({ text: `${open.name} updated.`, ok: true });
      setOpen(null); setQty(""); setNote(""); reload();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setMsg({ text: /network|fetch/i.test(raw) ? "No connection. Stock changes need to be online." : friendly(raw), ok: false });
    } finally { setBusy(false); }
  };

  const lowCount = (data ?? []).filter(isLow).length;
  return (
    <>
      <ScreenTitle title="Stock" subtitle={`${(data ?? []).length} product${(data ?? []).length === 1 ? "" : "s"} · ${lowCount} low`} />
      <Message text={msg?.text ?? null} ok={msg?.ok ?? false} />
      <Input label="Search name or SKU" value={q} onChange={setQ} />
      <Chips value={lowOnly ? "low" : "all"} onChange={(v) => setLowOnly(v === "low")} options={[{ value: "all", label: "All" }, { value: "low", label: `Low (${lowCount})` }]} />
      {open && (
        <Card title={open.name} subtitle={`${Number(open.quantity_on_hand)} ${open.unit ?? ""} on hand`}>
          <Chips value={kind} onChange={setKind} options={KINDS} />
          <Input label={kind === "adjustment" ? "Change (+ or −)" : "Quantity"} value={qty} onChange={setQty} />
          <Input label={kind === "adjustment" ? "Reason (required)" : "Note (optional)"} value={note} onChange={setNote} />
          <Primary label="Save" busy={busy} onPress={() => void save()} />
          <Ghost label="Cancel" onPress={() => { setOpen(null); setMsg(null); }} />
        </Card>
      )}
      <Card>
        {rows.length === 0 ? <EmptyState title={lowOnly ? "Nothing is low" : "No stock yet"} body={lowOnly ? "Products at or below their alert level appear here." : "Products with stock tracking turned on appear here."} /> : rows.map((l) => (
          <Pressable key={l.item_id} disabled={!canChange} onPress={() => { setOpen(l); setKind("addition"); setQty(""); setNote(""); setMsg(null); }}>
            <Row title={l.name} meta={[l.sku, l.reorder_level !== null ? `Alert at ${Number(l.reorder_level)}` : null].filter(Boolean).join(" · ") || undefined}
                 amount={`${Number(l.quantity_on_hand)} ${l.unit ?? ""}`} amountColor={isLow(l) ? C.danger : undefined} />
          </Pressable>
        ))}
      </Card>
      <Text style={u.footer}>Tap a product to receive, correct or write off stock.</Text>
      <ApprovalSheet visible={asking} title="Manager approval needed" onClose={() => setAsking(false)} onApproved={(t) => { setAsking(false); retry.current?.(t); }} />
    </>
  );
}

void StyleSheet; void View;
