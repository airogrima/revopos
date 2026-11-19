/**
 * Purchases — supplier bills, what is still owed, and paying a supplier.
 *
 * Reads the same purchases table and purchases_report the web reads; paying a
 * supplier calls pay_purchase_invoice (the web's action). Recording a bill is a
 * separate full-screen form so the keyboard never covers it.
 */
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { takeFlash } from "../lib/flash";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { formatNaira, parseNaira } from "@revopass/core";
import { getClient } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { C } from "../theme";
import { ActionButton, Card, EmptyState, ErrorView, Loading, Screen, ScreenTitle, u } from "../components/ui";
import { MoneyField } from "../components/form";
import { StatusBadge } from "../components/kit";
import DocumentPreview, { type PreviewSource } from "../components/DocumentPreview";
import { purchaseHtml, type PurchaseDoc } from "../lib/purchaseHtml";

interface P {
  id: string; number: string; purchase_date: string; due_date: string | null; status: string;
  total_kobo: number; amount_paid_kobo: number; balance_kobo: number; vendors: { name: string } | null;
}

export default function PurchasesScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { loading, refreshing, error, data, reload, onRefresh } = useOrgData<P[]>(async (supabase, orgId) => {
    const { data: rows, error: err } = await supabase.from("purchases")
      .select("id,number,purchase_date,due_date,status,total_kobo,amount_paid_kobo,balance_kobo,vendors(name)")
      .eq("org_id", orgId).neq("status", "void").order("purchase_date", { ascending: false }).limit(100);
    if (err) throw new Error(err.message);
    return (rows ?? []) as unknown as P[];
  });
  // Drafts are a separate table: they never appear in `purchases`, stock, payables or reports.
  const drafts = useOrgData<{ id: string; vendor_name: string | null; purchase_date: string; lines: unknown; vendors: { name: string } | null }[]>(async (supabase, orgId) => {
    const { data: rows, error: err } = await supabase.from("purchase_drafts")
      .select("id,vendor_name,purchase_date,lines,vendors(name)").eq("org_id", orgId).eq("status", "draft").order("updated_at", { ascending: false }).limit(50);
    if (err) throw new Error(err.message);
    return (rows ?? []) as never;
  });
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const duplicate = async (p: P) => {
    try {
      const c = await getClient();
      const { data, error: err } = await c.rpc("duplicate_purchase_to_draft", { p_purchase: p.id });
      if (err) throw new Error(err.message);
      nav.navigate("AddPurchase", { draftId: (data as { id: string }).id });
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not duplicate."); }
  };
  const [pv, setPv] = useState<{ title: string; status: string; source: PreviewSource | null } | null>(null);
  const { orgId } = useOrg();
  useFocusEffect(useCallback(() => { const m = takeFlash(); if (m) { setMsg(m); reload(); drafts.reload(); } }, []));   // eslint-disable-line react-hooks/exhaustive-deps

  /** Builds the print-ready page from the same stored rows; nothing is recalculated. */
  const preview = async (p: P) => {
    setPv({ title: `Purchase ${p.number}`, status: p.status, source: null });
    try {
      const c = await getClient();
      const [full, lines, biz] = await Promise.all([
        c.from("purchases").select("number,reference,purchase_date,due_date,status,subtotal_kobo,vat_kobo,total_kobo,amount_paid_kobo,balance_kobo,notes,vendors(name,email,phone,address,tin)").eq("id", p.id).single(),
        c.from("purchase_lines").select("description,quantity,unit_cost_kobo,line_total_kobo").eq("purchase_id", p.id).order("position").order("id"),
        c.from("organizations").select("name,logo_url,address,email,phone,tin,document_footer").eq("id", orgId ?? "").single(),
      ]);
      if (full.error) throw new Error(full.error.message);
      if (lines.error) throw new Error(lines.error.message);
      if (biz.error) throw new Error(biz.error.message);
      const d = { ...(full.data as object), vendor: (full.data as unknown as { vendors: PurchaseDoc["vendor"] }).vendors, lines: lines.data, business: biz.data } as unknown as PurchaseDoc;
      setPv({ title: `Purchase ${p.number}`, status: p.status, source: { kind: "html", html: purchaseHtml(d) } });
    } catch (e) {
      setPv({ title: `Purchase ${p.number}`, status: p.status, source: { kind: "html", html: `<p style="font-family:sans-serif;padding:20px">${(e instanceof Error ? e.message : "Could not load").replace(/</g, "&lt;")}</p>` } });
    }
  };

  if (loading) return <Loading label="Loading purchases…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  const rows = data ?? [];
  const owed = rows.reduce((s, p) => s + (p.balance_kobo > 0 ? p.balance_kobo : 0), 0);

  const pay = async (p: P) => {
    const kobo = parseNaira(amount);
    if (kobo === null || kobo <= 0) { Alert.alert("Enter an amount", "For example 5,000."); return; }
    if (kobo > p.balance_kobo) { Alert.alert("Too much", `The balance on ${p.number} is ${formatNaira(p.balance_kobo)}.`); return; }
    setBusy(true); setMsg(null);
    try {
      const c = await getClient();
      const { data: r, error: err } = await c.rpc("pay_purchase_invoice", { p_purchase: p.id, p_amount_kobo: kobo });
      if (err) throw new Error(err.message);
      if (!(r as { ok?: boolean } | null)?.ok) throw new Error("The payment could not be recorded.");
      setOpen(null); setAmount(""); setMsg(`Recorded ${formatNaira(kobo)} paid on ${p.number}.`); reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : "The payment could not be recorded."); }
    finally { setBusy(false); }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Purchases" subtitle={`${formatNaira(owed)} owed to suppliers`} />
      <ActionButton label="Record a purchase" onPress={() => (nav as unknown as { navigate: (n: string) => void }).navigate("AddPurchase")} />
      {msg ? <Card title="Status"><Text style={u.rowMeta}>{msg}</Text></Card> : null}
      {(drafts.data ?? []).length > 0 ? (
        <Card title="Drafts" subtitle="Not recorded: no stock, no amount owed, no number yet">
          {(drafts.data ?? []).map((d) => (
            <Pressable key={d.id} onPress={() => nav.navigate("AddPurchase", { draftId: d.id })} style={u.listRow} accessibilityRole="button"
              accessibilityLabel={`Open purchase draft ${d.vendors?.name ?? d.vendor_name ?? ""}`}>
              <View style={{ flex: 1 }}>
                <Text style={u.rowTitle}>{d.vendors?.name ?? d.vendor_name ?? "No supplier yet"}</Text>
                <Text style={u.rowMeta}>{Array.isArray(d.lines) ? d.lines.length : 0} line(s) · {d.purchase_date}</Text>
              </View>
              <StatusBadge status="draft" label="Draft" />
            </Pressable>
          ))}
        </Card>
      ) : null}
      <Card title="Supplier bills" subtitle={`${rows.length} recorded`}>
        {rows.length === 0 ? (
          <EmptyState title="No purchases yet" body="Record a supplier's bill to add stock at its real cost and track what you owe." />
        ) : rows.map((p) => (
          <View key={p.id}>
            <Pressable onPress={() => { setOpen(open === p.id ? null : p.id); setAmount(""); }} style={u.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={u.rowTitle}>{p.number} · {p.vendors?.name ?? "Supplier"}</Text>
                <Text style={u.rowMeta}>{p.purchase_date}{p.due_date ? ` · due ${p.due_date}` : ""}</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Text style={u.rowAmount}>{formatNaira(p.total_kobo)}</Text>
                <StatusBadge status={p.balance_kobo > 0 ? "pending" : "paid"} label={p.balance_kobo > 0 ? `Owe ${formatNaira(p.balance_kobo)}` : "Paid"} />
              </View>
            </Pressable>
            {open === p.id ? (
              <Pressable onPress={() => void duplicate(p)} style={s.prev} accessibilityRole="button" accessibilityLabel={`Duplicate purchase ${p.number}`}><Text style={s.prevText}>Duplicate as draft</Text></Pressable>
            ) : null}
            {open === p.id ? (
              <Pressable onPress={() => void preview(p)} style={s.prev} accessibilityRole="button" accessibilityLabel={`Preview purchase invoice ${p.number}`}><Text style={s.prevText}>Preview purchase invoice</Text></Pressable>
            ) : null}
            {open === p.id && p.balance_kobo > 0 ? (
              <View style={s.payBox}>
                <MoneyField label="Pay supplier" value={amount} onChange={setAmount} placeholder={formatNaira(p.balance_kobo)} editable={!busy} />
                <Pressable disabled={busy} onPress={() => void pay(p)} style={s.cta}><Text style={s.ctaText}>{busy ? "Saving…" : "Record payment"}</Text></Pressable>
              </View>
            ) : null}
          </View>
        ))}
      </Card>
      <DocumentPreview visible={!!pv} title={pv?.title ?? ""} status={pv?.status} source={pv?.source ?? null} onClose={() => setPv(null)} />
    </Screen>
  );
}

const s = StyleSheet.create({
  prev: { alignSelf: "flex-start", marginTop: 6, marginBottom: 4, backgroundColor: C.forestSoft, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  prevText: { color: C.forest, fontWeight: "700", fontSize: 13.5 },
  payBox: { paddingVertical: 8 },
  cta: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
