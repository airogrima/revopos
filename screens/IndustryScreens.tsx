/**
 * Industry modules on the phone: stock alerts, restaurant orders and kitchen,
 * hotel rooms, pharmacy expiry, fashion orders, warranty lookup and projects.
 * Reads are plain queries under RLS; changes call the same SQL functions as the
 * web app, so permissions, branch access and the audit log apply identically.
 */
import { useState, type ReactElement } from "react";
import { Alert, Text, View } from "react-native";
import { formatNaira } from "@revopass/core";
import { getClient } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { friendly } from "../lib/perms";
import { useModules } from "../lib/modules";
import { useTerminal } from "../lib/terminal";
import { PinGate, TerminalBar } from "../components/Terminal";
import Scanner from "../components/Scanner";
import { enqueue } from "../lib/offlineQueue";
import { C } from "../theme";
import { Card, EmptyState, ErrorView, Loading, Row, Screen, ScreenTitle, u } from "../components/ui";
import { Chips, Ghost, Input, Message, Picker, Primary } from "../components/mini";

type Client = Awaited<ReturnType<typeof getClient>>;

/** On a shared terminal these screens wait for a PIN so every action is attributed to a person. */
function gated(Body: () => ReactElement): () => ReactElement {
  return function Gated() {
    const term = useTerminal();
    if (term.mode && !term.staff) return <Screen><TerminalBar /><PinGate><></></PinGate></Screen>;
    return <Body />;
  };
}

function useRpc(orgId: string | null, reload: () => void) {
  const term = useTerminal();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const call = async (fn: string, args: Record<string, unknown>, ok?: string) => {
    if (!orgId) return false;
    try {
      const client: Client = await getClient();
      const { error } = await client.rpc(fn, { target_org: orgId, p_staff_token: term.token, ...args });
      if (error) throw new Error(error.message);
      setMsg(ok ? { text: ok, ok: true } : null);
      reload();
      return true;
    } catch (e) {
      setMsg({ text: friendly(e instanceof Error ? e.message : String(e)), ok: false });
      return false;
    }
  };
  return { msg, call };
}

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—");

/* ------------------------------------------------------------ Stock alerts */

export function StockAlertsScreen() {
  const { loading, refreshing, error, data, reload, onRefresh } = useOrgData<{
    low_stock: { item_id: string; name: string; reorder_level: number; on_hand: number }[];
    expiring: { batch_id: string; name: string; batch_no: string; expiry_date: string; on_hand: number; expired: boolean }[];
  }>(async (c, org) => {
    const { data: d, error: e } = await c.rpc("stock_alerts", { target_org: org });
    if (e) throw new Error(e.message);
    return d as never;
  });
  if (loading) return <Loading label="Checking stock…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  const low = data?.low_stock ?? []; const exp = data?.expiring ?? [];
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Stock alerts" subtitle={`${low.length} low · ${exp.length} near expiry`} />
      <Card title="Low stock">
        {low.length === 0 ? <EmptyState title="Nothing is running low" body="Set an alert level on a product to be warned here." />
          : low.map((x) => <Row key={x.item_id} title={x.name} meta={`Alert at ${Number(x.reorder_level)}`} amount={`${Number(x.on_hand)} left`} amountColor={Number(x.on_hand) <= 0 ? C.danger : undefined} />)}
      </Card>
      {exp.length > 0 && (
        <Card title="Expiry">
          {exp.map((x) => <Row key={x.batch_id} title={x.name} meta={`Batch ${x.batch_no} · ${day(x.expiry_date)}`} amount={x.expired ? "Expired" : `${Number(x.on_hand)} left`} amountColor={x.expired ? C.danger : undefined} />)}
        </Card>
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------- Hotel */

function HotelBody() {
  const { orgId } = useOrg();
  const { loading, refreshing, error, data, reload, onRefresh } = useOrgData<{
    rooms: { id: string; number: string; status: string }[];
    res: { id: string; number: string; room_id: string; guest_id: string; status: string; check_in: string; check_out: string }[];
    guests: Map<string, string>;
  }>(async (c, org) => {
    const [r, s, g] = await Promise.all([
      c.from("rooms").select("id,number,status").eq("org_id", org).eq("is_active", true).order("number"),
      c.from("reservations").select("id,number,room_id,guest_id,status,check_in,check_out").eq("org_id", org).in("status", ["reserved", "checked_in"]).order("check_in"),
      c.from("guests").select("id,name").eq("org_id", org),
    ]);
    if (r.error) throw new Error(r.error.message);
    return { rooms: (r.data ?? []) as never, res: (s.data ?? []) as never, guests: new Map(((g.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])) };
  });
  const { msg, call } = useRpc(orgId, reload);
  const [filter, setFilter] = useState<"all" | "cleaning" | "available" | "occupied">("all");
  if (loading) return <Loading label="Loading rooms…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  const rooms = (data?.rooms ?? []).filter((r) => filter === "all" || r.status === filter);
  const today = new Date().toISOString().slice(0, 10);
  const arrivals = (data?.res ?? []).filter((x) => x.status === "reserved" && x.check_in <= today);
  const roomNo = (id: string) => data?.rooms.find((r) => r.id === id)?.number ?? "?";
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Hotel" subtitle={`${(data?.rooms ?? []).filter((r) => r.status === "occupied").length} of ${(data?.rooms ?? []).length} rooms occupied`} />
      <Message text={msg?.text ?? null} ok={msg?.ok ?? false} />
      {arrivals.length > 0 && (
        <Card title="Arriving today">
          {arrivals.map((a) => (
            <View key={a.id}><Row title={data?.guests.get(a.guest_id) ?? a.number} meta={`Room ${roomNo(a.room_id)} · until ${day(a.check_out)}`} />
              <Ghost label="Check in" onPress={() => call("hotel_check_in", { p_res: a.id }, "Checked in.")} /></View>
          ))}
        </Card>
      )}
      <Chips value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "cleaning", label: "To clean" }, { value: "available", label: "Available" }, { value: "occupied", label: "Occupied" }]} />
      <Card title="Rooms">
        {rooms.map((r) => (
          <View key={r.id}><Row title={`Room ${r.number}`} meta={r.status} />
            {r.status === "cleaning" && <Ghost label="Mark clean" onPress={() => call("set_room_status", { p_room: r.id, p_status: "available" }, "Room ready.")} />}
            {r.status === "available" && <Ghost label="Needs cleaning" onPress={() => call("set_room_status", { p_room: r.id, p_status: "cleaning" })} />}</View>
        ))}
        {rooms.length === 0 && <EmptyState title="No rooms" body="Rooms are set up on the web under Hotel, Rooms." />}
      </Card>
    </Screen>
  );
}

export const HotelScreen = gated(HotelBody);

/* ---------------------------------------------------------------- Pharmacy */

export function PharmacyScreen() {
  const { loading, refreshing, error, data, reload, onRefresh } = useOrgData<{ batch_no: string; item_name: string; expiry_date: string | null; on_hand: number; expired: boolean }[]>(async (c, org) => {
    const { data: d, error: e } = await c.rpc("list_batches", { target_org: org });
    if (e) throw new Error(e.message);
    return ((d ?? []) as { batch_no: string; item_name: string; expiry_date: string | null; on_hand: number; expired: boolean }[]).filter((b) => Number(b.on_hand) > 0);
  });
  if (loading) return <Loading label="Loading batches…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  const rows = data ?? [];
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Pharmacy batches" subtitle={`${rows.filter((r) => r.expired).length} expired on the shelf`} />
      <Card>
        {rows.length === 0 ? <EmptyState title="No batches in stock" body="Receive batches on the web under Pharmacy." />
          : rows.map((b) => <Row key={b.batch_no + b.item_name} title={b.item_name} meta={`Batch ${b.batch_no} · expires ${day(b.expiry_date)}`} amount={b.expired ? "Expired" : `${Number(b.on_hand)} left`} amountColor={b.expired ? C.danger : undefined} />)}
      </Card>
    </Screen>
  );
}

/* ----------------------------------------------------------------- Fashion */

const FSTEPS = ["new", "cutting", "sewing", "finishing", "ready", "delivered"];

function FashionBody() {
  const { orgId } = useOrg();
  const { loading, refreshing, error, data, reload, onRefresh } = useOrgData<{ id: string; number: string; style: string; status: string; due_date: string | null; customer: string }[]>(async (c, org) => {
    const [o, cu] = await Promise.all([
      c.from("fashion_orders").select("id,number,style,status,due_date,customer_id").eq("org_id", org).not("status", "in", "(delivered,cancelled)").order("due_date", { nullsFirst: false }),
      c.from("customers").select("id,name").eq("org_id", org),
    ]);
    if (o.error) throw new Error(o.error.message);
    const names = new Map(((cu.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
    return ((o.data ?? []) as { id: string; number: string; style: string; status: string; due_date: string | null; customer_id: string }[]).map((x) => ({ ...x, customer: names.get(x.customer_id) ?? "Customer" }));
  });
  const { msg, call } = useRpc(orgId, reload);
  if (loading) return <Loading label="Loading orders…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Fashion orders" subtitle={`${data?.length ?? 0} in progress`} />
      <Message text={msg?.text ?? null} ok={msg?.ok ?? false} />
      {(data ?? []).length === 0 && <EmptyState title="No open orders" body="Create orders and measurements on the web under Fashion." />}
      {(data ?? []).map((o) => {
        const next = FSTEPS[FSTEPS.indexOf(o.status) + 1];
        return (
          <Card key={o.id} title={`${o.number} · ${o.style}`} subtitle={`${o.customer} · due ${day(o.due_date)}`}>
            <Row title={o.status} meta="Status" />
            {next && <Ghost label={`Move to ${next}`} onPress={() => call("set_fashion_order_status", { p_id: o.id, p_status: next })} />}
          </Card>
        );
      })}
    </Screen>
  );
}

export const FashionScreen = gated(FashionBody);

/* ------------------------------------------------------------- Electronics */

type Look = { serial_no: string; imei: string | null; item_name: string; status: string; in_warranty: boolean; warranty_expires: string | null; customer_name: string | null };

function ElectronicsBody() {
  const { orgId } = useOrg();
  const term = useTerminal();
  const [tab, setTab] = useState<"lookup" | "receive" | "units">("lookup");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Look[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<null | "lookup" | "serial" | "imei">(null);
  const [item, setItem] = useState("");
  const [itemQ, setItemQ] = useState("");
  const [serial, setSerial] = useState("");
  const [imei, setImei] = useState("");
  const [batch, setBatch] = useState<{ serial_no: string; imei: string | null }[]>([]);
  const { loading, data, reload } = useOrgData<{ items: { id: string; name: string }[]; units: { id: string; item_id: string; serial_no: string; imei: string | null; status: string; warranty_expires: string | null }[] }>(async (c, org) => {
    const [i, un] = await Promise.all([
      c.from("items").select("id,name").eq("org_id", org).eq("is_archived", false).order("name"),
      c.from("item_serials").select("id,item_id,serial_no,imei,status,warranty_expires").eq("org_id", org).order("created_at", { ascending: false }).limit(100),
    ]);
    return { items: (i.data ?? []) as never, units: (un.data ?? []) as never };
  });

  const look = async (text = q) => {
    setBusy(true); setMsg(null);
    try {
      const c = await getClient();
      const { data: d, error } = await c.rpc("warranty_lookup", { target_org: orgId, p_query: text });
      if (error) throw new Error(error.message);
      setRows((d ?? []) as Look[]);
    } catch (e) { setMsg({ text: friendly(e instanceof Error ? e.message : String(e)), ok: false }); }
    finally { setBusy(false); }
  };

  const addToBatch = async () => {
    const sn = serial.trim(); const im = imei.trim();
    if (sn === "") return setMsg({ text: "Enter or scan the serial number.", ok: false });
    if (batch.some((b) => b.serial_no === sn || (im !== "" && b.imei === im))) return setMsg({ text: "That serial number or IMEI is already in this list.", ok: false });
    // Duplicate check against what is already recorded (needs a connection; the database enforces it either way).
    try {
      const c = await getClient();
      const ors = [`serial_no.eq.${sn}`, `imei.eq.${sn}`, ...(im ? [`serial_no.eq.${im}`, `imei.eq.${im}`] : [])].join(",");
      const { data: dup } = await c.from("item_serials").select("serial_no").eq("org_id", orgId).or(ors).limit(1);
      if (dup && dup.length > 0) return setMsg({ text: "That serial number or IMEI is already recorded.", ok: false });
    } catch { /* offline: checked when it syncs */ }
    setBatch((b) => [...b, { serial_no: sn, imei: im || null }]); setSerial(""); setImei(""); setMsg(null);
  };
  const receive = async () => {
    if (!item) return setMsg({ text: "Choose the product first.", ok: false });
    if (batch.length === 0) return setMsg({ text: "Add at least one serial number.", ok: false });
    setBusy(true);
    const args = { target_org: orgId, p_item: item, p_serials: batch, p_cost_kobo: null, p_branch: null };
    try {
      const c = await getClient();
      const { error } = await c.rpc("receive_serials", { ...args, p_staff_token: term.token });
      if (error) {
        if (/network|fetch|timeout/i.test(error.message)) {
          await enqueue({ kind: "receive_serials", orgId: orgId!, args, staffId: term.staff?.id ?? null, group: `serial:${batch[0]!.serial_no}`, label: `Receive ${batch.length} unit(s)`, totalKobo: 0 });
          setBatch([]); setMsg({ text: "No connection. Saved on this phone and will sync automatically.", ok: true });
          return;
        }
        throw new Error(error.message);
      }
      setMsg({ text: `${batch.length} unit(s) received.`, ok: true }); setBatch([]); reload();
    } catch (e) { setMsg({ text: friendly(e instanceof Error ? e.message : String(e)), ok: false }); }
    finally { setBusy(false); }
  };

  const items = (data?.items ?? []).filter((i) => itemQ === "" || i.name.toLowerCase().includes(itemQ.toLowerCase())).slice(0, 12);
  return (
    <Screen>
      <TerminalBar />
      <ScreenTitle title="Serial numbers" subtitle="Receive units, find a unit, check a warranty" />
      <Chips value={tab} onChange={setTab} options={[{ value: "lookup", label: "Warranty" }, { value: "receive", label: "Receive" }, { value: "units", label: "Units" }]} />
      <Message text={msg?.text ?? null} ok={msg?.ok ?? false} />
      {tab === "lookup" && (
        <>
          <Input label="Serial number or IMEI" value={q} onChange={setQ} />
          <Primary label="Check warranty" onPress={() => void look()} busy={busy} disabled={q.trim().length < 3} />
          <Ghost label="Scan instead" onPress={() => setScan("lookup")} />
          {rows && rows.length === 0 && <EmptyState title="Not found" body="No unit has that serial number or IMEI." />}
          {(rows ?? []).map((r) => (
            <Card key={r.serial_no} title={r.item_name} subtitle={r.serial_no}>
              <Row title={r.status === "sold" ? (r.in_warranty ? "In warranty" : "Out of warranty") : r.status.replace("_", " ")}
                   meta={r.status === "sold" ? `Until ${day(r.warranty_expires)}${r.customer_name ? ` · ${r.customer_name}` : ""}` : "Not sold yet"} />
            </Card>
          ))}
        </>
      )}
      {tab === "receive" && (
        loading ? <Loading /> : (
          <Card title="Receive units" subtitle="Pick the product, then scan or type each serial number and IMEI.">
            <Input label="Find product" value={itemQ} onChange={setItemQ} />
            <Picker options={items.map((i) => ({ value: i.id, label: i.name }))} value={item} onChange={setItem} placeholder="Choose" />
            <Input label="Serial number" value={serial} onChange={setSerial} />
            <Ghost label="Scan serial number" onPress={() => setScan("serial")} />
            <Input label="IMEI (optional)" value={imei} onChange={setImei} />
            <Ghost label="Scan IMEI" onPress={() => setScan("imei")} />
            <Primary label="Add to list" onPress={() => void addToBatch()} />
            {batch.map((b) => <Row key={b.serial_no} title={b.serial_no} meta={b.imei ? `IMEI ${b.imei}` : undefined} />)}
            {batch.length > 0 && <Primary label={`Receive ${batch.length} unit${batch.length === 1 ? "" : "s"}`} onPress={() => void receive()} busy={busy} />}
          </Card>
        )
      )}
      {tab === "units" && (
        <Card title="Recent units">
          {(data?.units ?? []).length === 0 ? <EmptyState title="No units yet" body="Receive serialised stock first." />
            : (data?.units ?? []).map((x) => <Row key={x.id} title={x.serial_no} meta={`${data?.items.find((i) => i.id === x.item_id)?.name ?? ""}${x.imei ? ` · IMEI ${x.imei}` : ""}`} amount={x.status.replace("_", " ")} amountColor={x.status === "sold" ? C.text2 : undefined} />)}
        </Card>
      )}
      <Scanner visible={scan !== null} title="Point the camera at the barcode" onClose={() => setScan(null)}
        onScan={(t) => { const w = scan; setScan(null); if (w === "serial") setSerial(t); else if (w === "imei") setImei(t); else { setQ(t); void look(t); } }} />
    </Screen>
  );
}
export const ElectronicsScreen = gated(ElectronicsBody);

/* ------------------------------------------------------------ Construction */

export function ConstructionScreen() {
  const { loading, refreshing, error, data, reload, onRefresh } = useOrgData<{ project_id: string; name: string; status: string; contract_value_kobo: number; cost_kobo: number; income_kobo: number; profit_kobo: number; margin_pct: number | null }[]>(async (c, org) => {
    const { data: d, error: e } = await c.rpc("project_summary", { target_org: org });
    if (e) throw new Error(e.message);
    return (d ?? []) as never;
  });
  if (loading) return <Loading label="Loading projects…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  const rows = data ?? [];
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Projects" subtitle={`${rows.filter((r) => r.status === "active").length} active`} />
      {rows.length === 0 && <EmptyState title="No projects" body="Create projects and record costs on the web under Construction." />}
      {rows.map((p) => (
        <Card key={p.project_id} title={p.name} subtitle={p.status}>
          <Row title="Contract value" amount={formatNaira(p.contract_value_kobo)} />
          <Row title="Actual cost" amount={formatNaira(p.cost_kobo)} />
          <Row title="Income" amount={formatNaira(p.income_kobo)} />
          <Row title="Profit" meta={p.margin_pct === null ? undefined : `${p.margin_pct}% margin`} amount={formatNaira(p.profit_kobo)} amountColor={p.profit_kobo < 0 ? C.danger : undefined} />
        </Card>
      ))}
    </Screen>
  );
}

// Alert is imported for parity with other screens that confirm destructive actions.
void Alert;
