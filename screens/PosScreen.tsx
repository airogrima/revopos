/**
 * POS — ring up a sale on the phone.
 *
 * The sale is sent to public.pos_checkout, which checks the role, takes the
 * stock down, records payments and the ledger entry, and issues the receipt in
 * one transaction. The cart's key is reused on every retry, so a dropped
 * connection can be retried without ringing the sale up twice.
 */
import DocumentPreview from "../components/DocumentPreview";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { computeCart, formatNaira, parseNaira } from "@revopass/core";
import { getClient } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { friendly, newKey, usePermissions } from "../lib/perms";
import { printDocument, shareDocumentPdf } from "../lib/pdf";
import { C } from "../theme";
import { Card, EmptyState, ErrorView, Loading, Screen, ScreenTitle, u } from "../components/ui";
import { Ghost } from "../components/mini";
import { Icon, SectionHeader } from "../components/kit";
import Scanner from "../components/Scanner";
import { ApprovalSheet, PinGate, TerminalBar } from "../components/Terminal";
import { needsApproval, sessionLocked, useTerminal } from "../lib/terminal";
import { enqueue, discard, retry, useOfflineQueue } from "../lib/offlineQueue";
import { Modal, ScrollView } from "react-native";

interface Item { id: string; name: string; unit: string | null; unitKobo: number; taxBps: number; track: boolean; onHand: number; barcode: string | null; sku: string | null; serial: boolean }
interface Line { uid: string; item: Item; qty: number; serial: string | null }
interface Done { documentId: string; number: string; token: string | null; total: number }
interface SerialRow { id: string; serial_no: string; imei: string | null }

const METHODS: { value: string; label: string }[] = [
  { value: "cash", label: "Cash" }, { value: "card", label: "Card" }, { value: "transfer", label: "Transfer" },
];

export default function PosScreen() {
  const ref = useRef<ScrollView>(null);
  // The cart summary lives in PosBody's state; it hands the numbers up so the
  // bar can stay pinned below the scrolling product grid.
  const [bar, setBar] = useState<{ count: number; total: number } | null>(null);
  return (
    <View style={{ flex: 1 }}>
      <Screen scrollRef={ref} bottomPad={bar ? 120 : 32}>
        <TerminalBar offer />
        <PinGate><PosBody onCart={setBar} /></PinGate>
      </Screen>
      {bar && (
        <View style={s.cartBar}>
          <View style={s.cartBadge}><Icon name="cart" size={20} color={C.forest} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.cartCount}>{bar.count} item{bar.count === 1 ? "" : "s"}</Text>
            <Text style={s.cartTotal}>{formatNaira(bar.total)}</Text>
          </View>
          <Pressable style={s.cartBtn} onPress={() => ref.current?.scrollToEnd({ animated: true })} accessibilityRole="button">
            <Text style={s.cartBtnText}>View Cart</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function PosBody({ onCart }: { onCart: (b: { count: number; total: number } | null) => void }) {
  const { orgId } = useOrg();
  const term = useTerminal();
  const { perms, loading: permLoading } = usePermissions();
  const queue = useOfflineQueue(term.staff?.id ?? null, term.token);
  const { loading, error, data, reload } = useOrgData<{ items: Item[]; banks: { id: string; is_primary: boolean }[] }>(async (supabase, org) => {
    const [i, s, b] = await Promise.all([
      supabase.from("items").select("id,name,unit,unit_price_kobo,track_stock,barcode,sku,track_serial,tax_rates(rate_bps)").eq("org_id", org).eq("is_archived", false).order("name"),
      supabase.from("item_stock_levels").select("item_id,quantity_on_hand").eq("org_id", org),
      supabase.from("org_bank_accounts").select("id,is_primary").eq("org_id", org).eq("is_active", true),
    ]);
    if (i.error) throw new Error(i.error.message);
    const stock = new Map(((s.data ?? []) as { item_id: string; quantity_on_hand: number }[]).map((x) => [x.item_id, Number(x.quantity_on_hand)]));
    const items = ((i.data ?? []) as unknown as { id: string; name: string; unit: string | null; unit_price_kobo: number; track_stock: boolean; barcode: string | null; sku: string | null; track_serial: boolean; tax_rates: { rate_bps: number } | null }[])
      .map((x) => ({ id: x.id, name: x.name, unit: x.unit, unitKobo: Number(x.unit_price_kobo), taxBps: x.tax_rates?.rate_bps ?? 0, track: x.track_stock, onHand: stock.get(x.id) ?? 0, barcode: x.barcode, sku: x.sku, serial: x.track_serial }));
    return { items, banks: (b.data ?? []) as { id: string; is_primary: boolean }[] };
  });

  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [discountText, setDiscountText] = useState("");
  const [method, setMethod] = useState("cash");
  const [split, setSplit] = useState(false);
  const [cashText, setCashText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [scanning, setScanning] = useState<null | "product" | "serial">(null);
  const [serialFor, setSerialFor] = useState<Item | null>(null);
  const [serialRows, setSerialRows] = useState<SerialRow[]>([]);
  const [serialQ, setSerialQ] = useState("");
  const [approval, setApproval] = useState(false);
  const key = useRef(newKey());
  const pendingApproval = useRef<(() => void) | null>(null);
  const approver = useRef<string | null>(null);

  const can = (k: string, legacy: boolean) => (term.mode ? term.staffCan(k) : legacy);
  const canSell = can("pos.sell", perms.pos);
  const canDiscount = can("pos.discount", perms.pos_discount) || (term.mode && !!term.staff); // staff without it get an approval prompt

  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => q === "" || i.name.toLowerCase().includes(q) || (i.barcode ?? "").toLowerCase() === q || (i.sku ?? "").toLowerCase() === q).slice(0, 40);
  }, [items, search]);

  const discount = canDiscount && discountText.trim() !== "" ? (parseNaira(discountText) ?? 0) : 0;
  const totals = useMemo(
    () => computeCart(lines.map((l) => ({ quantity: l.qty, unitPriceKobo: l.item.unitKobo, taxRateBps: l.item.taxBps })), discount),
    [lines, discount],
  );

  const cartCount = lines.reduce((a, l) => a + l.qty, 0);
  const cartTotal = totals.totalKobo;
  useEffect(() => { onCart(cartCount > 0 ? { count: cartCount, total: cartTotal } : null); }, [cartCount, cartTotal, onCart]);

  if (permLoading || loading) return <Loading label="Loading till…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!canSell) {
    return <Card><EmptyState title="POS is not available for your role" body="Ask the owner or an admin to give you the cashier role." /></Card>;
  }

  const addPlain = (item: Item) => setLines((ls) => {
    const at = ls.findIndex((l) => l.item.id === item.id);
    return at >= 0 ? ls.map((l, i) => (i === at ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { uid: newKey(), item, qty: 1, serial: null }];
  });
  const add = async (item: Item) => {
    term.touch();
    if (!item.serial) return addPlain(item);
    // Serialised: pick the exact unit being sold.
    setSerialFor(item); setSerialQ(""); setSerialRows([]);
    try {
      const c = await getClient();
      const { data: rows } = await c.from("item_serials").select("id,serial_no,imei").eq("org_id", orgId).eq("item_id", item.id).eq("status", "in_stock").order("created_at").limit(200);
      setSerialRows((rows ?? []) as SerialRow[]);
    } catch { setMessage("Could not load serial numbers. Check your connection."); }
  };
  const chooseSerial = (row: SerialRow) => {
    if (!serialFor) return;
    if (lines.some((l) => l.serial === row.serial_no)) { setMessage(`${row.serial_no} is already in this sale.`); return; }
    setLines((ls) => [...ls, { uid: newKey(), item: serialFor, qty: 1, serial: row.serial_no }]);
    setSerialFor(null);
  };
  const onScan = (text: string) => {
    const which = scanning; setScanning(null);
    if (which === "serial") {
      const row = serialRows.find((r) => r.serial_no === text || r.imei === text);
      if (row) chooseSerial(row); else setMessage(`${text} is not an in-stock unit of ${serialFor?.name ?? "this product"}.`);
    } else {
      const hit = items.find((i) => i.barcode === text || i.sku === text);
      if (hit && !(hit.track && hit.onHand <= 0)) void add(hit); else setMessage(hit ? `${hit.name} is out of stock.` : `No product has the code ${text}.`);
    }
  };
  const bump = (uid: string, by: number) =>
    setLines((ls) => ls.flatMap((l) => (l.uid !== uid ? [l] : l.item.serial ? (by < 0 ? [] : [l]) : l.qty + by <= 0 ? [] : [{ ...l, qty: l.qty + by }])));

  const reset = () => { setLines([]); setDiscountText(""); setCashText(""); setMessage(null); key.current = newKey(); approver.current = null; };

  const checkout = async () => {
    setMessage(null); term.touch();
    if (lines.length === 0) return setMessage("Add at least one item.");
    const total = totals.totalKobo;
    const primary = data?.banks.find((b) => b.is_primary)?.id ?? null;
    let payments: { method: string; amount_kobo: number; bank_account_id: string | null }[];
    if (split) {
      const cash = parseNaira(cashText) ?? 0;
      if (cash <= 0 || cash >= total) return setMessage("Enter a cash amount that is less than the total. The rest is paid by the other method.");
      const other = method === "cash" ? "card" : method;
      payments = [{ method: "cash", amount_kobo: cash, bank_account_id: null }, { method: other, amount_kobo: total - cash, bank_account_id: primary }];
    } else {
      payments = [{ method, amount_kobo: total, bank_account_id: method === "cash" ? null : primary }];
    }
    const args = {
      target_org: orgId, p_key: key.current,
      p_lines: lines.map((l, i) => ({
        item_id: l.item.id, description: l.item.name, quantity: l.qty, unit_price_kobo: l.item.unitKobo,
        discount_kobo: totals.lines[i]?.discountKobo ?? 0, tax_rate_bps: l.item.taxBps,
        ...(l.serial ? { serial_no: l.serial } : {}),
      })),
      p_payments: payments,
    };

    setBusy(true);
    try {
      const supabase = await getClient();
      const { data: res, error: err } = await supabase.rpc("pos_checkout", { ...args, p_staff_token: term.token, p_approver_token: approver.current });
      if (err) {
        if (/network|fetch|timeout/i.test(err.message)) {
          // Saved to the device first, then reported as saved. Same key, so a retry cannot double-post.
          await enqueue({ id: key.current, kind: "pos_checkout", orgId: orgId!, args, staffId: term.staff?.id ?? null,
            group: lines.find((l) => l.serial)?.serial ? `serial:${lines.find((l) => l.serial)!.serial}` : `sale:${key.current}`,
            label: `Sale ${formatNaira(total)}`, totalKobo: total });
          reset();
          setMessage("No connection. The sale is saved on this phone and will sync automatically.");
          return;
        }
        if (sessionLocked(err.message)) { await term.lock(); return; }
        if (needsApproval(err.message) && term.mode && !approver.current) {
          pendingApproval.current = () => void checkout();
          setApproval(true);
          return;
        }
        throw new Error(err.message);
      }
      const r = res as { document_id: string; number?: string; public_token?: string; total_kobo: number };
      setDone({ documentId: r.document_id, number: r.number ?? "", token: r.public_token ?? null, total: r.total_kobo });
      reset();
      reload();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setMessage(friendly(raw));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <>
        <ScreenTitle title="Sale complete" subtitle={`Receipt ${done.number} · ${formatNaira(done.total)}`} />
        <Card>
          {done.token ? (
            <>
              <Pressable style={s.ghost} onPress={() => setPreviewOpen(true)} accessibilityRole="button"><Text style={s.ghostText}>Preview receipt</Text></Pressable>
              <Pressable style={s.primary} onPress={() => { void shareDocumentPdf(done.token!).catch((e) => Alert.alert("Could not share", String(e.message ?? e))); }}>
                <Text style={s.primaryText}>Share receipt</Text></Pressable>
              <Pressable style={s.ghost} onPress={() => { void printDocument(done.token!).catch((e) => Alert.alert("Could not print", String(e.message ?? e))); }}>
                <Text style={s.ghostText}>Print</Text></Pressable>
            </>
          ) : null}
          <Pressable style={s.ghost} onPress={() => setDone(null)}><Text style={s.ghostText}>New sale</Text></Pressable>
        </Card>
        <DocumentPreview visible={previewOpen} title={`Receipt ${done.number}`} source={done.token ? { kind: "public", token: done.token } : null} onClose={() => setPreviewOpen(false)} />
      </>
    );
  }

  const failed = queue.failed;
  const shownSerials = serialRows.filter((r) => serialQ === "" || r.serial_no.toLowerCase().includes(serialQ.toLowerCase()) || (r.imei ?? "").includes(serialQ));

  return (
    <>
      <ScreenTitle title="POS Sales" subtitle="Ring up a sale, take payment, issue a receipt." />
      <Text style={{ fontSize: 12, fontWeight: "600", color: queue.state === "synced" ? C.primary : queue.state === "failed" ? C.danger : C.text2, marginBottom: 6 }}>
        {queue.state === "synced" ? "Synced" : queue.state === "failed" ? `Failed to sync: ${failed.length}` : `Waiting to sync: ${queue.waiting}`}
      </Text>
      {queue.state === "waiting" && <Ghost label="Sync now" onPress={() => void queue.syncNow()} />}
      {failed.map((q) => (
        <View key={q.id} style={{ marginBottom: 6 }}>
          <Text style={{ color: C.danger, fontSize: 12.5 }}>{q.label}: {q.error}</Text>
          <View style={{ flexDirection: "row" }}><Ghost label="Retry" onPress={() => void retry(q.id)} /><Ghost label="Discard" danger onPress={() => Alert.alert("Discard this sale?", "It will not be recorded.", [{ text: "Keep" }, { text: "Discard", style: "destructive", onPress: () => void discard(q.id) }])} /></View>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput style={[s.input, s.search, { flex: 1 }]} placeholder="Search products…" placeholderTextColor={C.text3} value={search} onChangeText={setSearch}
                   onSubmitEditing={() => { const hit = items.find((i) => i.barcode === search.trim() || i.sku === search.trim()); if (hit) { void add(hit); setSearch(""); } }} />
        <Pressable style={[s.step, { height: 46, width: 56 }]} onPress={() => setScanning("product")} accessibilityLabel="Scan barcode"><Icon name="search" size={20} color={C.forest} /></Pressable>
      </View>
      {items.length === 0 ? (
        <Card><EmptyState title="No products yet" body="Add products from More, then come back to sell them." /></Card>
      ) : (
        <View style={s.grid}>
          {filtered.map((i) => {
            const out = i.track && i.onHand <= 0;
            return (
              <Pressable key={i.id} disabled={out} onPress={() => void add(i)} style={[s.tile, out && { opacity: 0.45 }]}>
                <View style={s.tileIcon}><Icon name="box" size={22} color={C.forest} /></View>
                <Text style={s.tileName} numberOfLines={2}>{i.name}</Text>
                <Text style={s.price}>{formatNaira(i.unitKobo)}</Text>
                {i.track ? <Text style={[u.rowMeta, out && { color: C.danger }]}>{out ? "Out of stock" : `Stock: ${i.onHand}`}</Text> : null}
                {i.serial ? <Text style={u.rowMeta}>Serial number sold</Text> : null}
              </Pressable>
            );
          })}
        </View>
      )}

      <SectionHeader title={`Cart${lines.length ? ` · ${lines.reduce((a, l) => a + l.qty, 0)} item${lines.reduce((a, l) => a + l.qty, 0) === 1 ? "" : "s"}` : ""}`} />
      <Card>
        {lines.length === 0 ? <Text style={u.rowMeta}>Tap a product to add it.</Text> : lines.map((l, i) => (
          <View key={l.uid} style={s.line}>
            <View style={{ flex: 1 }}>
              <Text style={u.rowTitle}>{l.item.name}</Text>
              <Text style={u.rowMeta}>{l.serial ? `S/N ${l.serial}` : `${formatNaira(l.item.unitKobo)} each`}</Text>
            </View>
            {l.serial ? <Pressable style={s.step} onPress={() => bump(l.uid, -1)} accessibilityLabel={`Remove ${l.item.name}`}><Text style={s.stepText}>×</Text></Pressable> : (
              <>
                <Pressable accessibilityLabel={`Less ${l.item.name}`} style={s.step} onPress={() => bump(l.uid, -1)}><Text style={s.stepText}>−</Text></Pressable>
                <Text style={s.qty}>{l.qty}</Text>
                <Pressable accessibilityLabel={`More ${l.item.name}`} style={s.step} onPress={() => bump(l.uid, 1)}><Text style={s.stepText}>+</Text></Pressable>
              </>
            )}
            <Text style={s.lineTotal}>{formatNaira(totals.lines[i]?.totalKobo ?? 0)}</Text>
          </View>
        ))}

        {canDiscount && lines.length > 0 ? (
          <TextInput style={[s.input, { marginTop: 10 }]} placeholder="Discount (₦)" placeholderTextColor={C.text3}
                     keyboardType="decimal-pad" value={discountText} onChangeText={setDiscountText} />
        ) : null}

        <View style={s.totals}>
          <Row2 k="Subtotal" v={formatNaira(totals.grossKobo)} />
          {totals.discountKobo > 0 ? <Row2 k="Discount" v={`−${formatNaira(totals.discountKobo)}`} /> : null}
          <Row2 k="Tax" v={formatNaira(totals.taxKobo)} />
          <Row2 k="Total" v={formatNaira(totals.totalKobo)} bold />
        </View>

        <Text style={[u.rowMeta, { marginTop: 12 }]}>Payment</Text>
        <View style={s.chips}>
          {METHODS.map((m) => (
            <Pressable key={m.value} style={[s.chip, method === m.value && s.chipOn]} onPress={() => setMethod(m.value)}>
              <Text style={[s.chipText, method === m.value && s.chipTextOn]}>{m.label}</Text></Pressable>
          ))}
          <Pressable style={[s.chip, split && s.chipOn]} onPress={() => setSplit((v) => !v)}>
            <Text style={[s.chipText, split && s.chipTextOn]}>Split</Text></Pressable>
        </View>
        {split ? (
          <TextInput style={s.input} placeholder="Cash amount (₦). The rest is paid by the method above" placeholderTextColor={C.text3}
                     keyboardType="decimal-pad" value={cashText} onChangeText={setCashText} />
        ) : null}

        {message ? <Text style={s.err}>{message}</Text> : null}
        <Pressable style={[s.primary, (busy || lines.length === 0) && { opacity: 0.55 }]} disabled={busy || lines.length === 0} onPress={() => void checkout()}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>Charge {formatNaira(totals.totalKobo)}</Text>}
        </Pressable>
        {lines.length > 0 ? <Pressable style={s.ghost} onPress={reset}><Text style={s.ghostText}>Clear cart</Text></Pressable> : null}
      </Card>

      <Scanner visible={scanning !== null} title={scanning === "serial" ? "Scan the serial number or IMEI" : "Scan a product barcode"} onClose={() => setScanning(null)} onScan={onScan} />
      <ApprovalSheet visible={approval} title="Manager approval needed" onClose={() => setApproval(false)}
        onApproved={(tok) => { setApproval(false); approver.current = tok; pendingApproval.current?.(); }} />
      <Modal visible={serialFor !== null} animationType="slide" onRequestClose={() => setSerialFor(null)}>
        <View style={{ flex: 1, backgroundColor: C.bg ?? "#fff", padding: 16, paddingTop: 54 }}>
          <Text style={u.cardTitle}>{serialFor?.name}: choose the unit</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <TextInput style={[s.input, { flex: 1 }]} placeholder="Type serial number or IMEI" placeholderTextColor={C.text3} value={serialQ} onChangeText={setSerialQ} autoCapitalize="characters" />
            <Pressable style={[s.step, { height: 46, width: 56 }]} onPress={() => setScanning("serial")}><Text style={s.stepText}>Scan</Text></Pressable>
          </View>
          <ScrollView>
            {shownSerials.length === 0 && <Text style={u.rowMeta}>No matching in-stock unit.</Text>}
            {shownSerials.map((r) => (
              <Pressable key={r.id} style={s.line} onPress={() => chooseSerial(r)}>
                <View style={{ flex: 1 }}><Text style={u.rowTitle}>{r.serial_no}</Text>{r.imei ? <Text style={u.rowMeta}>IMEI {r.imei}</Text> : null}</View>
                <Text style={s.price}>Select</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Ghost label="Cancel" onPress={() => setSerialFor(null)} />
        </View>
      </Modal>
    </>
  );
}

function Row2({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <View style={s.kv}>
      <Text style={[u.rowMeta, bold && { color: C.text, fontWeight: "700", fontSize: 15 }]}>{k}</Text>
      <Text style={[u.rowTitle, bold && { fontWeight: "700", fontSize: 15 }]}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: C.text, minHeight: 48, marginBottom: 10 },
  search: { borderRadius: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  tile: { width: "48%", flexGrow: 1, backgroundColor: "#fff", borderWidth: 1, borderColor: C.border2, borderRadius: 16, padding: 12, gap: 4, minHeight: 120, shadowColor: "#0F172A", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  tileIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.forestSoft, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  tileName: { fontSize: 14, fontWeight: "600", color: C.text },
  price: { fontSize: 14, fontWeight: "700", color: C.forest },
  line: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border2 },
  step: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 18, fontWeight: "600", color: C.text },
  qty: { minWidth: 22, textAlign: "center", fontSize: 15, fontWeight: "600", color: C.text },
  lineTotal: { minWidth: 84, textAlign: "right", fontSize: 13, fontWeight: "700", color: C.text },
  totals: { marginTop: 10, gap: 6 },
  kv: { flexDirection: "row", justifyContent: "space-between" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 8 },
  chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: 16, borderRadius: 99, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff" },
  chipOn: { backgroundColor: C.forest, borderColor: C.forest },
  chipText: { fontSize: 13.5, color: C.text2, fontWeight: "600" },
  chipTextOn: { color: "#fff", fontWeight: "700" },
  cartBar: {
    position: "absolute", left: 14, right: 14, bottom: 12, flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", borderRadius: 20, padding: 12, borderWidth: 1.5, borderColor: C.forestSoft,
    shadowColor: "#0F172A", shadowOpacity: 0.14, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  cartBadge: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.forestSoft, alignItems: "center", justifyContent: "center" },
  cartCount: { fontSize: 12, color: C.text2 },
  cartTotal: { fontSize: 18, fontWeight: "800", color: C.text, letterSpacing: -0.3 },
  cartBtn: { backgroundColor: C.forest, borderRadius: 14, minHeight: 48, paddingHorizontal: 22, alignItems: "center", justifyContent: "center" },
  cartBtnText: { color: "#fff", fontSize: 15.5, fontWeight: "700" },
  err: { color: C.danger, fontSize: 12.5, marginTop: 6, lineHeight: 18 },
  primary: { backgroundColor: C.forest, borderRadius: 14, minHeight: 54, alignItems: "center", justifyContent: "center", marginTop: 12 },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  ghost: { minHeight: 46, alignItems: "center", justifyContent: "center", marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff" },
  ghostText: { color: C.text, fontSize: 14.5, fontWeight: "600" },
});
