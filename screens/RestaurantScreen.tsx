/**
 * Restaurant on the phone: tables, open an order, add menu items with extras,
 * send to the kitchen, follow status, split the bill and take payment.
 * Everything is the same SQL as the web (rest_* functions and, for payment,
 * pos_checkout through rest_settle_bill), so permissions, branch access,
 * manager approval and the audit log behave identically.
 */
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { formatNaira } from "@revopass/core";
import { getClient } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { friendly, newKey } from "../lib/perms";
import { useModules } from "../lib/modules";
import { needsApproval, sessionLocked, useTerminal } from "../lib/terminal";
import { C } from "../theme";
import { Card, EmptyState, ErrorView, Loading, Row, Screen, ScreenTitle, u } from "../components/ui";
import { Chips, Ghost, Message, Primary } from "../components/mini";
import { ApprovalSheet, PinGate, TerminalBar } from "../components/Terminal";

interface Table { id: string; name: string; seats: number; status: string; branch_id: string; waiter_id: string | null }
interface Ord { id: string; number: string; status: string; order_type: string; table_id: string | null; waiter_id: string | null }
interface Line { id: string; order_id: string; item_id: string; name: string; quantity: number; unit_price_kobo: number; modifiers: { id: string; name: string; price_kobo: number }[]; notes: string | null; status: string; bill_no: number; paid: boolean }
interface Menu { id: string; name: string; price: number; category: string | null; bps: number }
interface Mod { id: string; name: string; price_kobo: number; item_id: string | null }

export default function RestaurantScreen() {
  return (
    <Screen>
      <TerminalBar />
      <PinGate><Body /></PinGate>
    </Screen>
  );
}

/** Runs a restaurant function with the acting staff token, asking for a manager PIN when needed. */
function useCall(orgId: string | null, after: () => void) {
  const term = useTerminal();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
  const retryRef = useRef<((tok: string) => void) | null>(null);
  const call = async <T,>(fn: string, args: Record<string, unknown>, ok?: string, approver: string | null = null, wantsApprover = false): Promise<{ ok: boolean; data?: T }> => {
    term.touch();
    try {
      const c = await getClient();
      const payload: Record<string, unknown> = { target_org: orgId, p_staff_token: term.token, ...args };
      if (wantsApprover) payload.p_approver_token = approver;
      const { data, error } = await c.rpc(fn, payload);
      if (error) {
        if (sessionLocked(error.message)) { await term.lock(); return { ok: false }; }
        if (wantsApprover && term.mode && !approver && needsApproval(error.message)) {
          retryRef.current = (tok) => { void call(fn, args, ok, tok, wantsApprover); };
          setAsking(true);
          return { ok: false };
        }
        throw new Error(error.message);
      }
      setMsg(ok ? { text: ok, ok: true } : null);
      after();
      return { ok: true, data: data as T };
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setMsg({ text: /network|fetch/i.test(raw) ? "No connection. Restaurant orders need to be online." : friendly(raw), ok: false });
      return { ok: false };
    }
  };
  const sheet = (
    <ApprovalSheet visible={asking} title="Manager approval needed" onClose={() => setAsking(false)}
      onApproved={(tok) => { setAsking(false); retryRef.current?.(tok); }} />
  );
  return { call, msg, setMsg, sheet };
}

function Body() {
  const { orgId } = useOrg();
  const { has } = useModules();
  const term = useTerminal();
  const [view, setView] = useState<"tables" | "orders">("tables");
  const [openId, setOpenId] = useState<string | null>(null);
  const { loading, error, data, reload } = useOrgData<{ tables: Table[]; orders: Ord[] }>(async (c, org) => {
    const [t, o] = await Promise.all([
      c.from("restaurant_tables").select("id,name,seats,status,branch_id,waiter_id").eq("org_id", org).eq("is_active", true).order("name"),
      c.from("restaurant_orders").select("id,number,status,order_type,table_id,waiter_id").eq("org_id", org).not("status", "in", "(paid,cancelled)").order("created_at"),
    ]);
    if (t.error) throw new Error(t.error.message);
    return { tables: (t.data ?? []) as Table[], orders: (o.data ?? []) as Ord[] };
  });
  const { call, msg, sheet } = useCall(orgId, reload);

  if (loading) return <Loading label="Loading tables…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!has("restaurant")) return <EmptyState title="Restaurant is switched off" body="An owner can turn it on under Settings on the web." />;
  if (openId) return <OrderView id={openId} onBack={() => { setOpenId(null); reload(); }} />;

  const tables = data?.tables ?? []; const orders = data?.orders ?? [];
  const open = async (table: Table | null) => {
    const r = await call<string>("rest_open_order", { p_table: table?.id ?? null, p_type: table ? "dine_in" : "takeaway" });
    if (r.ok && r.data) setOpenId(r.data);
  };
  const tableName = (id: string | null) => tables.find((t) => t.id === id)?.name ?? "Table";

  return (
    <>
      <ScreenTitle title="Restaurant" subtitle={`${orders.length} open order${orders.length === 1 ? "" : "s"}${term.staff ? ` · ${term.staff.name}` : ""}`} />
      <Chips value={view} onChange={setView} options={[{ value: "tables", label: "Tables" }, { value: "orders", label: "Open orders" }]} />
      <Message text={msg?.text ?? null} ok={msg?.ok ?? false} />
      <Primary label="New takeaway order" onPress={() => void open(null)} />
      {view === "tables" ? (
        tables.length === 0 ? <Card><EmptyState title="No tables yet" body="Tables are added on the web under Restaurant, Tables." /></Card> : (
          <View style={s.grid}>
            {tables.map((t) => {
              const ord = orders.find((o) => o.table_id === t.id);
              return (
                <Pressable key={t.id} style={[s.tile, t.status === "occupied" && s.tileOn]} disabled={t.status === "cleaning" && !ord}
                  onPress={() => (ord ? setOpenId(ord.id) : void open(t))}>
                  <Text style={u.rowTitle}>{t.name}</Text>
                  <Text style={u.rowMeta}>{t.seats} seats · {t.status}</Text>
                  <Text style={s.tileAction}>{ord ? `Open ${ord.number}` : t.status === "cleaning" ? "Being cleaned" : "Start order"}</Text>
                </Pressable>
              );
            })}
          </View>
        )
      ) : (
        <Card>
          {orders.length === 0 ? <EmptyState title="No open orders" body="Start one from Tables." /> : orders.map((o) => (
            <Pressable key={o.id} onPress={() => setOpenId(o.id)}>
              <Row title={`${o.number} · ${o.order_type === "takeaway" ? "Takeaway" : tableName(o.table_id)}`} meta={o.status} />
            </Pressable>
          ))}
        </Card>
      )}
      {sheet}
    </>
  );
}

function OrderView({ id, onBack }: { id: string; onBack: () => void }) {
  const { orgId } = useOrg();
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Menu | null>(null);
  const [qty, setQty] = useState("1");
  const [mods, setMods] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [method, setMethod] = useState("cash");
  const [panel, setPanel] = useState<null | "waiter" | "move">(null);
  const { loading, error, data, reload } = useOrgData<{
    order: Ord; lines: Line[]; menu: Menu[]; mods: Mod[]; cats: { id: string; name: string }[];
    tables: Table[]; staff: { id: string; full_name: string }[]; tableName: string;
  }>(async (c, org) => {
    const [o, l, i, m, ct, t, st, tr] = await Promise.all([
      c.from("restaurant_orders").select("id,number,status,order_type,table_id,waiter_id,branch_id").eq("id", id).eq("org_id", org).single(),
      c.from("restaurant_order_lines").select("id,order_id,item_id,name,quantity,unit_price_kobo,modifiers,notes,status,bill_no,paid").eq("order_id", id).order("created_at"),
      c.from("items").select("id,name,unit_price_kobo,menu_category_id,tax_rate_id").eq("org_id", org).eq("is_archived", false).order("name"),
      c.from("menu_modifiers").select("id,name,price_kobo,item_id").eq("org_id", org).eq("is_active", true),
      c.from("menu_categories").select("id,name").eq("org_id", org).order("sort_order").order("name"),
      c.from("restaurant_tables").select("id,name,seats,status,branch_id,waiter_id").eq("org_id", org).eq("is_active", true).order("name"),
      c.from("staff_members").select("id,full_name").eq("org_id", org).eq("status", "active").order("full_name"),
      c.from("tax_rates").select("id,rate_bps").eq("org_id", org),
    ]);
    if (o.error) throw new Error(o.error.message);
    const rate = new Map(((tr.data ?? []) as { id: string; rate_bps: number }[]).map((r) => [r.id, r.rate_bps]));
    const ord = o.data as Ord & { branch_id: string };
    const tbls = (t.data ?? []) as Table[];
    return {
      order: ord, lines: (l.data ?? []) as Line[],
      menu: ((i.data ?? []) as { id: string; name: string; unit_price_kobo: number; menu_category_id: string | null; tax_rate_id: string | null }[])
        .map((x) => ({ id: x.id, name: x.name, price: x.unit_price_kobo, category: x.menu_category_id, bps: x.tax_rate_id ? rate.get(x.tax_rate_id) ?? 0 : 0 })),
      mods: (m.data ?? []) as Mod[], cats: (ct.data ?? []) as { id: string; name: string }[],
      tables: tbls.filter((x) => x.branch_id === ord.branch_id && x.status === "available"),
      staff: (st.data ?? []) as { id: string; full_name: string }[],
      tableName: tbls.find((x) => x.id === ord.table_id)?.name ?? (ord.order_type === "takeaway" ? "Takeaway" : "Table"),
    };
  });
  const { call, msg, sheet } = useCall(orgId, reload);

  if (loading) return <Loading label="Loading order…" />;
  if (error || !data) return <ErrorView message={error ?? "Order not found"} onRetry={reload} />;
  const { order, lines, menu } = data;
  const closed = order.status === "paid" || order.status === "cancelled";
  const live = lines.filter((l) => l.status !== "voided");
  const lineTotal = (l: Line) => Math.round(Number(l.quantity) * (l.unit_price_kobo + l.modifiers.reduce((a, m) => a + m.price_kobo, 0)));
  const bills = [...new Set(live.map((l) => l.bill_no))].sort((a, b) => a - b).map((n) => {
    const ls = live.filter((l) => l.bill_no === n);
    const sub = ls.reduce((a, l) => a + lineTotal(l), 0);
    const vat = ls.reduce((a, l) => a + Math.round(Math.round(Number(l.quantity) * l.unit_price_kobo) * (menu.find((m) => m.id === l.item_id)?.bps ?? 0) / 10000), 0);
    return { n, ls, total: sub + vat, paid: ls.every((l) => l.paid) };
  });
  const shown = menu.filter((m) => (cat === "all" || m.category === cat) && (q === "" || m.name.toLowerCase().includes(q.toLowerCase())));
  const itemMods = (itemId: string) => data.mods.filter((m) => m.item_id === null || m.item_id === itemId);
  const waiter = data.staff.find((x) => x.id === order.waiter_id)?.full_name;

  const send = async () => {
    if (!picked) return;
    const r = await call("rest_add_lines", { p_order: id, p_lines: [{ item_id: picked.id, quantity: Number(qty) || 1, modifier_ids: mods, notes: note || null }], p_send: true }, "Sent to the kitchen.");
    if (r.ok) { setPicked(null); setQty("1"); setMods([]); setNote(""); }
  };
  const pay = (bill: number, approver: string | null = null) =>
    call("rest_settle_bill", { p_order: id, p_bill: bill, p_key: `rest-${id}-${bill}-${newKey()}`, p_payments: [{ method }], p_reservation: null }, "Paid. Receipt recorded.", approver, true);

  return (
    <>
      <ScreenTitle title={`${order.number} · ${data.tableName}`} subtitle={`${order.status}${waiter ? ` · Waiter ${waiter}` : ""}`} />
      <Ghost label="Back to tables" onPress={onBack} />
      <Message text={msg?.text ?? null} ok={msg?.ok ?? false} />

      {!closed && (
        <Card title="Add to order">
          {picked ? (
            <>
              <Text style={u.rowTitle}>{picked.name} · {formatNaira(picked.price)}</Text>
              <Text style={[u.rowMeta, { marginTop: 8 }]}>Quantity</Text>
              <TextInput style={s.input} keyboardType="decimal-pad" value={qty} onChangeText={setQty} />
              {itemMods(picked.id).length > 0 && <Text style={u.rowMeta}>Extras</Text>}
              <View style={s.chips}>
                {itemMods(picked.id).map((m) => (
                  <Pressable key={m.id} style={[s.chip, mods.includes(m.id) && s.chipOn]} onPress={() => setMods((x) => x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id])}>
                    <Text style={[s.chipText, mods.includes(m.id) && { color: "#fff" }]}>{m.name}{m.price_kobo > 0 ? ` +${formatNaira(m.price_kobo)}` : ""}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={s.input} placeholder="Note for the kitchen" placeholderTextColor={C.text3} value={note} onChangeText={setNote} />
              <Primary label="Send to kitchen" onPress={() => void send()} />
              <Ghost label="Cancel" onPress={() => setPicked(null)} />
            </>
          ) : (
            <>
              <TextInput style={s.input} placeholder="Search menu" placeholderTextColor={C.text3} value={q} onChangeText={setQ} />
              <View style={s.chips}>
                {[{ id: "all", name: "All" }, ...data.cats].map((c) => (
                  <Pressable key={c.id} style={[s.chip, cat === c.id && s.chipOn]} onPress={() => setCat(c.id)}><Text style={[s.chipText, cat === c.id && { color: "#fff" }]}>{c.name}</Text></Pressable>
                ))}
              </View>
              {shown.slice(0, 40).map((m) => (
                <Pressable key={m.id} style={s.menuRow} onPress={() => setPicked(m)}>
                  <Text style={[u.rowTitle, { flex: 1 }]}>{m.name}</Text><Text style={s.price}>{formatNaira(m.price)}</Text>
                </Pressable>
              ))}
              {shown.length === 0 && <Text style={u.rowMeta}>No menu items. Add them on the web under Restaurant, Menu.</Text>}
            </>
          )}
        </Card>
      )}

      {bills.length === 0 && <Card><Text style={u.rowMeta}>Nothing ordered yet.</Text></Card>}
      {bills.map((b) => (
        <Card key={b.n} title={bills.length > 1 ? `Bill ${b.n}` : "Bill"} subtitle={b.paid ? "Paid" : formatNaira(b.total)}>
          {b.ls.map((l) => (
            <View key={l.id} style={s.lineWrap}>
              <Pressable disabled={b.paid || closed} onPress={() => setSel((x) => x.includes(l.id) ? x.filter((y) => y !== l.id) : [...x, l.id])} style={{ flex: 1 }}>
                <Text style={u.rowTitle}>{sel.includes(l.id) ? "☑ " : b.paid ? "" : "☐ "}{Number(l.quantity)} × {l.name} · {l.status}</Text>
                {l.modifiers.length > 0 && <Text style={u.rowMeta}>+ {l.modifiers.map((m) => m.name).join(", ")}</Text>}
                {l.notes ? <Text style={u.rowMeta}>“{l.notes}”</Text> : null}
              </Pressable>
              <Text style={s.price}>{formatNaira(lineTotal(l))}</Text>
              {l.status === "ready" && <Ghost label="Served" onPress={() => void call("rest_set_line_status", { p_line: l.id, p_status: "served" })} />}
              {!l.paid && !closed && <Ghost label="Remove" danger onPress={() => void call("rest_set_line_status", { p_line: l.id, p_status: "voided", p_reason: "Removed by staff" }, undefined, null, true)} />}
            </View>
          ))}
          {!b.paid && !closed && (
            <>
              <View style={s.chips}>
                {["cash", "card", "transfer", "pos"].map((m) => (
                  <Pressable key={m} style={[s.chip, method === m && s.chipOn]} onPress={() => setMethod(m)}><Text style={[s.chipText, method === m && { color: "#fff" }]}>{m === "pos" ? "POS machine" : m[0]!.toUpperCase() + m.slice(1)}</Text></Pressable>
                ))}
              </View>
              <Primary label={`Pay ${formatNaira(b.total)}`} onPress={() => void pay(b.n)} />
            </>
          )}
        </Card>
      ))}

      {!closed && live.length > 0 && (
        <Card title="Manage order">
          <Ghost label="Split selected items to a new bill" onPress={async () => { if (sel.length === 0) return; const r = await call("rest_split_bill", { p_order: id, p_lines: sel }, "New bill created."); if (r.ok) setSel([]); }} />
          <Ghost label="Mark all ready as served" onPress={() => void call("rest_serve_ready", { p_order: id })} />
          <Ghost label={panel === "waiter" ? "Hide waiters" : "Change waiter"} onPress={() => setPanel(panel === "waiter" ? null : "waiter")} />
          {panel === "waiter" && <View style={s.chips}>{data.staff.map((x) => (
            <Pressable key={x.id} style={[s.chip, order.waiter_id === x.id && s.chipOn]} onPress={() => void call("rest_assign_waiter", { p_order: id, p_waiter: x.id }, "Waiter changed.")}>
              <Text style={[s.chipText, order.waiter_id === x.id && { color: "#fff" }]}>{x.full_name}</Text></Pressable>))}</View>}
          {order.order_type === "dine_in" && data.tables.length > 0 && <Ghost label={panel === "move" ? "Hide tables" : "Move to another table"} onPress={() => setPanel(panel === "move" ? null : "move")} />}
          {panel === "move" && <View style={s.chips}>{data.tables.map((x) => (
            <Pressable key={x.id} style={s.chip} onPress={async () => { const r = await call("rest_move_table", { p_order: id, p_table: x.id }, "Moved."); if (r.ok) setPanel(null); }}><Text style={s.chipText}>{x.name}</Text></Pressable>))}</View>}
          <Ghost label="Cancel order" danger onPress={() => void call("rest_cancel_order", { p_order: id, p_reason: "Cancelled" }, "Order cancelled.", null, true)} />
        </Card>
      )}
      {sheet}
    </>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12, marginBottom: 14 },
  tile: { width: "48%", flexGrow: 1, backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12, gap: 3, minHeight: 84 },
  tileOn: { borderColor: C.primary },
  tileAction: { fontSize: 12.5, fontWeight: "600", color: C.primary, marginTop: 4 },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: C.text, minHeight: 46, marginVertical: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 8 },
  chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: 13, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff" },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 13, color: C.text2 },
  menuRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border2 },
  price: { fontSize: 13, fontWeight: "600", color: C.primary },
  lineWrap: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border2, flexWrap: "wrap" },
});
