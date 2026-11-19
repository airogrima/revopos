/** Production: record what was made and the materials it used. */
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { formatNaira } from "@revopass/core";
import { getClient } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { friendly, usePermissions } from "../lib/perms";
import { C } from "../theme";
import { Card, EmptyState, ErrorView, Loading, Screen, ScreenTitle, u } from "../components/ui";
import { Ghost, Input, Message, Picker, Primary } from "../components/mini";

interface Run {
  id: string; number: string; production_date: string; status: string; quantity: number;
  total_cost_kobo: number | null; cost_complete: boolean; items: { name: string; unit: string | null } | null;
}
interface Item { id: string; name: string; track: boolean; onHand: number }

export default function ProductionScreen() {
  const { orgId } = useOrg();
  const { perms } = usePermissions();
  const { loading, refreshing, error, data, reload, onRefresh } = useOrgData<{ runs: Run[]; items: Item[] }>(async (supabase, org) => {
    const [r, i, s] = await Promise.all([
      supabase.from("production_runs").select("id,number,production_date,status,quantity,total_cost_kobo,cost_complete,items(name,unit)")
        .eq("org_id", org).order("production_date", { ascending: false }).limit(100),
      supabase.from("items").select("id,name,track_stock").eq("org_id", org).eq("is_archived", false).order("name"),
      supabase.from("item_stock_levels").select("item_id,quantity_on_hand").eq("org_id", org),
    ]);
    if (r.error) throw new Error(r.error.message);
    const stock = new Map(((s.data ?? []) as { item_id: string; quantity_on_hand: number }[]).map((x) => [x.item_id, Number(x.quantity_on_hand)]));
    return {
      runs: (r.data ?? []) as unknown as Run[],
      items: ((i.data ?? []) as { id: string; name: string; track_stock: boolean }[]).map((x) => ({ id: x.id, name: x.name, track: x.track_stock, onHand: stock.get(x.id) ?? 0 })),
    };
  });

  const [creating, setCreating] = useState(false);
  const [product, setProduct] = useState("");
  const [qty, setQty] = useState("");
  const [mats, setMats] = useState<{ item: string; qty: string }[]>([{ item: "", qty: "" }]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  if (loading) return <Loading label="Loading production…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  const runs = data?.runs ?? [];
  const items = data?.items ?? [];
  const options = items.map((i) => ({ value: i.id, label: i.name }));

  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try {
      const supabase = await getClient();
      const { error: e } = await supabase.rpc(fn, args);
      if (e) throw new Error(e.message);
      setMsg({ text: ok, ok: true }); reload();
      return true;
    } catch (e) { setMsg({ text: friendly(e instanceof Error ? e.message : String(e)), ok: false }); return false; }
    finally { setBusy(false); }
  };

  const save = async () => {
    const q = Number(qty);
    const components = mats.map((x) => ({ item_id: x.item, quantity: Number(x.qty) })).filter((x) => x.item_id !== "" || x.quantity > 0);
    if (product === "") return setMsg({ text: "Choose the finished product.", ok: false });
    if (!(q > 0)) return setMsg({ text: "Enter the quantity produced.", ok: false });
    if (components.length === 0 || components.some((c) => c.item_id === "" || !(c.quantity > 0))) {
      return setMsg({ text: "Each material needs a product and a quantity.", ok: false });
    }
    const ok = await rpc("create_production_run", {
      target_org: orgId, p_product: product, p_quantity: q, p_components: components,
      p_notes: notes.trim() || null, p_complete: perms.manage,
    }, perms.manage ? "Production recorded. Stock updated." : "Saved and waiting for approval.");
    if (ok) { setCreating(false); setProduct(""); setQty(""); setMats([{ item: "", qty: "" }]); setNotes(""); }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Production" subtitle="Turn materials into finished products." />
      <Message text={msg?.text ?? null} ok={msg?.ok ?? false} />

      {perms.production && !creating ? <Primary label="New production" onPress={() => { setCreating(true); setMsg(null); }} /> : null}

      {creating ? (
        <Card title="New production">
          <Text style={u.rowMeta}>Finished product</Text>
          <Picker options={options} value={product} onChange={setProduct} placeholder="Choose" />
          <Input label="Quantity produced" value={qty} onChange={setQty} keyboard="decimal-pad" />
          <Text style={[u.rowMeta, { marginTop: 12 }]}>Materials used</Text>
          {mats.map((mt, i) => (
            <View key={i} style={{ marginTop: 8 }}>
              <Picker options={options.filter((o) => o.value !== product)} value={mt.item}
                      onChange={(v) => setMats((ms) => ms.map((x, j) => (j === i ? { ...x, item: v } : x)))} placeholder="Choose material" />
              <Input label="Quantity" value={mt.qty} keyboard="decimal-pad"
                     onChange={(v) => setMats((ms) => ms.map((x, j) => (j === i ? { ...x, qty: v } : x)))} />
              {mats.length > 1 ? <Ghost label="Remove material" danger onPress={() => setMats((ms) => ms.filter((_, j) => j !== i))} /> : null}
            </View>
          ))}
          <Ghost label="+ Add material" onPress={() => setMats((ms) => [...ms, { item: "", qty: "" }])} />
          <Input label="Notes" value={notes} onChange={setNotes} />
          <Primary label={perms.manage ? "Save production" : "Submit for approval"} busy={busy} onPress={() => void save()} />
          <Ghost label="Cancel" onPress={() => setCreating(false)} />
        </Card>
      ) : null}

      {runs.length === 0 && !creating ? (
        <Card><EmptyState title="No production runs yet"
                          body="Record what you made and the materials it used. Materials come out of stock and the finished product goes in." /></Card>
      ) : (
        <Card>
          {runs.map((r, i) => (
            <View key={r.id} style={[{ paddingVertical: 12 }, i > 0 && { borderTopWidth: 1, borderTopColor: C.border2 }]}>
              <Text style={u.rowTitle}>{r.number} · {r.items?.name}</Text>
              <Text style={u.rowMeta}>
                {r.production_date} · {Number(r.quantity)} {r.items?.unit ?? ""} · {r.status}
                {r.total_cost_kobo === null ? " · no cost data" : ` · ${formatNaira(r.total_cost_kobo)}${r.cost_complete ? "" : " (partial)"}`}
              </Text>
              {r.status === "pending" ? (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  {perms.manage ? (
                    <Pressable style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }} disabled={busy}
                               onPress={() => void rpc("approve_production_run", { target_run: r.id }, "Approved. Stock updated.")}>
                      <Text style={{ color: C.primary, fontWeight: "600" }}>Approve</Text></Pressable>
                  ) : <Text style={u.rowMeta}>Waiting for approval</Text>}
                  <Pressable style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }} disabled={busy}
                             onPress={() => Alert.alert("Cancel this run?", r.number, [{ text: "Keep it", style: "cancel" },
                               { text: "Cancel run", style: "destructive", onPress: () => void rpc("cancel_production_run", { target_run: r.id }, "Run cancelled.") }])}>
                    <Text style={{ color: C.danger, fontWeight: "600" }}>Cancel</Text></Pressable>
                </View>
              ) : null}
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
