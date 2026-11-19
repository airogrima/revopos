/** Budgets: planned against actual spend taken from recorded expenses. */
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { formatNaira, parseNaira } from "@revopass/core";
import { getClient } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { friendly, usePermissions } from "../lib/perms";
import { C } from "../theme";
import { Card, EmptyState, ErrorView, Loading, Screen, ScreenTitle, u } from "../components/ui";
import { Chips, Ghost, Input, Message, Picker, Primary } from "../components/mini";

interface Line {
  id: string; name: string; period: string; start_date: string; end_date: string; category_name: string | null;
  planned_kobo: number; actual_kobo: number; variance_kobo: number; used_pct: number; state: string; is_current: boolean;
}
const COLOR: Record<string, string> = { ok: C.success, warning: C.amber, over: C.danger };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default function BudgetsScreen() {
  const { orgId } = useOrg();
  const { perms, loading: permLoading } = usePermissions();
  const { loading, refreshing, error, data, reload, onRefresh } = useOrgData<{ lines: Line[]; cats: { value: string; label: string }[] }>(async (supabase, org) => {
    const [o, c] = await Promise.all([
      supabase.rpc("budget_overview", { target_org: org }),
      supabase.from("categories").select("id,name").eq("org_id", org).eq("kind", "expense").eq("is_archived", false).order("name"),
    ]);
    // A role without the budgets permission gets a refusal here; the screen explains it instead of failing.
    if (o.error && !/not allowed|permission/i.test(o.error.message)) throw new Error(o.error.message);
    return { lines: (o.data ?? []) as Line[], cats: ((c.data ?? []) as { id: string; name: string }[]).map((x) => ({ value: x.id, label: x.name })) };
  });

  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [name, setName] = useState(""); const [cat, setCat] = useState(""); const [period, setPeriod] = useState("monthly");
  const [start, setStart] = useState(new Date().toISOString().slice(0, 8) + "01"); const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  if (permLoading || loading) return <Loading label="Loading budgets…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!perms.budgets) {
    return <Screen><ScreenTitle title="Budgets" /><Card><EmptyState title="Not available for your role" body="Budgets are managed by owners, admins and accountants." /></Card></Screen>;
  }
  const all = data?.lines ?? [];
  const lines = showAll ? all : all.filter((l) => l.is_current);
  const planned = lines.reduce((a, l) => a + Number(l.planned_kobo), 0);
  const actual = lines.reduce((a, l) => a + Number(l.actual_kobo), 0);

  const save = async () => {
    const k = parseNaira(amount);
    if (k === null || k <= 0) return setMsg({ text: "Enter the planned amount, e.g. 250,000.00", ok: false });
    if (!ISO.test(start)) return setMsg({ text: "Enter the start date as YYYY-MM-DD.", ok: false });
    setBusy(true); setMsg(null);
    try {
      const supabase = await getClient();
      const { data: u2 } = await supabase.auth.getUser();
      const { error: e } = await supabase.from("budgets").insert({
        org_id: orgId, name: name.trim() || null, category_id: cat || null, period, amount_kobo: k, start_date: start, created_by: u2.user?.id ?? null,
      });
      if (e) throw new Error(/duplicate|unique/i.test(e.message) ? "A budget for that category and start date already exists." : e.message);
      setCreating(false); setName(""); setAmount(""); setCat(""); setMsg({ text: "Budget created.", ok: true }); reload();
    } catch (e) { setMsg({ text: friendly(e instanceof Error ? e.message : String(e)), ok: false }); }
    finally { setBusy(false); }
  };

  const remove = (l: Line) => Alert.alert(`Delete ${l.name}?`, "Your expenses are not affected.", [
    { text: "Keep it", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => { void (async () => {
      const supabase = await getClient();
      const { error: e } = await supabase.from("budgets").delete().eq("id", l.id);
      if (e) setMsg({ text: friendly(e.message), ok: false }); else reload();
    })(); } },
  ]);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Budgets" subtitle={`Planned ${formatNaira(planned)} · Actual ${formatNaira(actual)} · Variance ${formatNaira(planned - actual)}`} />
      <Message text={msg?.text ?? null} ok={msg?.ok ?? false} />
      {!creating ? <Primary label="New budget" onPress={() => { setCreating(true); setMsg(null); }} /> : (
        <Card title="New budget">
          <Input label="Name" value={name} onChange={setName} placeholder="e.g. Marketing" />
          <Text style={[u.rowMeta, { marginTop: 10 }]}>Category</Text>
          <Picker options={data?.cats ?? []} value={cat} onChange={setCat} placeholder="All expenses" />
          <Text style={[u.rowMeta, { marginTop: 10 }]}>Period</Text>
          <Chips options={[{ value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "annual", label: "Yearly" }]} value={period} onChange={setPeriod} />
          <Input label="Starts (YYYY-MM-DD)" value={start} onChange={setStart} />
          <Input label="Planned amount (₦)" value={amount} onChange={setAmount} keyboard="decimal-pad" />
          <Primary label="Create budget" busy={busy} onPress={() => void save()} />
          <Ghost label="Cancel" onPress={() => setCreating(false)} />
        </Card>
      )}
      <View style={{ marginTop: 10 }}><Chips options={[{ value: "current", label: "Current" }, { value: "all", label: "All periods" }]} value={showAll ? "all" : "current"} onChange={(v) => setShowAll(v === "all")} /></View>
      <Card>
        {lines.length === 0 ? (
          <EmptyState title="No budgets yet" body="Set a planned amount for a category and period. Actual spend is taken from your recorded expenses." />
        ) : lines.map((l, i) => (
          <View key={l.id} style={[{ paddingVertical: 12 }, i > 0 && { borderTopWidth: 1, borderTopColor: C.border2 }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={[u.rowTitle, { flex: 1 }]}>{l.name}</Text>
              <Text style={{ color: COLOR[l.state], fontWeight: "700" }}>{l.used_pct}%</Text>
            </View>
            <View style={{ height: 7, borderRadius: 4, backgroundColor: C.border2, marginTop: 6, overflow: "hidden" }}>
              <View style={{ height: 7, width: `${Math.min(Number(l.used_pct), 100)}%`, backgroundColor: COLOR[l.state] }} />
            </View>
            <Text style={u.rowMeta}>{l.period === "annual" ? "Yearly" : l.period} · {l.start_date} to {l.end_date}</Text>
            <Text style={u.rowMeta}>Planned {formatNaira(l.planned_kobo)} · Actual {formatNaira(l.actual_kobo)} · Variance {formatNaira(l.variance_kobo)}</Text>
            <Pressable accessibilityLabel={`Delete ${l.name}`} style={{ minHeight: 44, justifyContent: "center" }} onPress={() => remove(l)}>
              <Text style={{ color: C.danger, fontWeight: "600" }}>Delete</Text></Pressable>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
