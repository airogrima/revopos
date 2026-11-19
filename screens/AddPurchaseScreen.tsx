import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation";
import MoveButtons, { moveItem } from "../components/MoveButtons";
import { setFlash } from "../lib/flash";
import { formatNaira, parseNaira } from "@revopass/core";
import { getClient, isAuthFailure, signOut } from "../lib/supabase";
import { useOrg } from "../lib/org";
import { DateField, Field, MoneyField, toISODate, useFormState } from "../components/form";
import { AppHeader, Icon, PrimaryButton } from "../components/kit";
import { C } from "../theme";

/**
 * Record a supplier's bill (public.create_purchase_invoice, same RPC as the web).
 *
 * The database totals the invoice, numbers it and — for a line that names a
 * stock product — records the stock coming in once, at the unit cost entered
 * here. That cost is what later sales are costed from, so it is required.
 * The preview below is display only and never sent.
 */
interface Vendor { id: string; name: string }
interface Item { id: string; name: string }
interface Line { description: string; qty: string; cost: string; itemId: string | null }
const BLANK: Line = { description: "", qty: "1", cost: "", itemId: null };

export default function AddPurchaseScreen() {
  const nav = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, "AddPurchase">>();
  const draftId = route.params?.draftId;
  const [stamp, setStamp] = useState<string | null>(null);     // updated_at of the draft we opened (concurrency check)
  const [loadingDraft, setLoadingDraft] = useState(!!draftId);
  const { orgId } = useOrg();
  const insets = useSafeAreaInsets();
  const { busy, setBusy, error, setError, fieldErrors, setFieldErrors } = useFormState();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [reference, setReference] = useState("");
  const [issueDate, setIssueDate] = useState(() => new Date());
  const [vatRate, setVatRate] = useState("0");
  const [paid, setPaid] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...BLANK }]);

  useEffect(() => {
    if (!orgId) return;
    let off = false;
    (async () => {
      try {
        const c = await getClient();
        const [v, i, o] = await Promise.all([
          c.from("vendors").select("id,name").eq("org_id", orgId).order("name"),
          c.from("items").select("id,name").eq("org_id", orgId).eq("track_stock", true).eq("is_archived", false).order("name").limit(60),
          c.from("organizations").select("vat_registered,vat_rate_bps").eq("id", orgId).maybeSingle(),
        ]);
        if (off) return;
        setVendors((v.data ?? []) as Vendor[]);
        setItems((i.data ?? []) as Item[]);
        if (o.data?.vat_registered && o.data.vat_rate_bps != null) setVatRate(String(o.data.vat_rate_bps / 100));
      } catch { /* the form still works with a typed supplier name */ }
    })();
    return () => { off = true; };
  }, [orgId]);

  // Reopen a draft. Drafts are stored apart from posted purchases (purchase_drafts), so opening one reads
  // nothing that affects stock, payables or reports.
  useEffect(() => {
    if (!draftId) return;
    let off = false;
    (async () => {
      try {
        const c = await getClient();
        const { data: d, error: e } = await c.from("purchase_drafts")
          .select("vendor_id,vendor_name,reference,purchase_date,due_date,vat_bps,notes,lines,status,updated_at").eq("id", draftId).maybeSingle();
        if (e) throw new Error(e.message);
        if (!d) throw new Error("That draft could not be found. It may have been confirmed or deleted.");
        if (off) return;
        const dr = d as unknown as { vendor_id: string | null; vendor_name: string | null; reference: string | null; purchase_date: string; due_date: string | null;
          vat_bps: number; notes: string | null; status: string; updated_at: string;
          lines: { description?: string; quantity?: number | string | null; unit_cost_kobo?: number | null; item_id?: string | null }[] };
        if (dr.status !== "draft") throw new Error("This draft has already been confirmed.");
        setVendorId(dr.vendor_id); setVendorName(dr.vendor_name ?? ""); setReference(dr.reference ?? "");
        setIssueDate(new Date(dr.purchase_date + "T00:00:00")); setVatRate(String(dr.vat_bps / 100)); setNotes(dr.notes ?? ""); setStamp(dr.updated_at);
        if (dr.lines.length) setLines(dr.lines.map((l) => ({ description: l.description ?? "", qty: l.quantity == null ? "" : String(Number(l.quantity)),
          cost: l.unit_cost_kobo == null ? "" : (l.unit_cost_kobo / 100).toFixed(2), itemId: l.item_id ?? null })));
      } catch (e) { if (!off) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!off) setLoadingDraft(false); }
    })();
    return () => { off = true; };
  }, [draftId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setLine = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const subtotal = lines.reduce((s, l) => {
    const c = parseNaira(l.cost || "0") ?? 0; const q = Number(l.qty || "0");
    return s + (Number.isFinite(q) && q > 0 ? Math.round(c * q) : 0);
  }, 0);
  const vatBps = Math.round((Number(vatRate) || 0) * 100);
  const vat = Math.round((subtotal * vatBps) / 10_000);

  /** Strict lines for posting (the existing create_purchase_invoice rules). */
  const postPayload = () => {
    if (!vendorId && !vendorName.trim()) { setFieldErrors({ vendor: "Choose a supplier or type a new one." }); return null; }
    const payload: { description: string; quantity: number; unit_cost_kobo: number; item_id: string | null }[] = [];
    for (const [i, l] of lines.entries()) {
      if (!l.description.trim() && !l.cost.trim() && !l.itemId) continue;
      if (!l.description.trim()) { setFieldErrors({ [`line${i}`]: "Say what you bought." }); return null; }
      const q = Number(l.qty || "1");
      if (!Number.isFinite(q) || q <= 0) { setFieldErrors({ [`line${i}`]: "Quantity must be more than zero." }); return null; }
      const cost = parseNaira(l.cost);
      if (cost === null || cost < 0) { setFieldErrors({ [`line${i}`]: "Enter the unit cost, like 12,500." }); return null; }
      payload.push({ description: l.description.trim(), quantity: q, unit_cost_kobo: cost, item_id: l.itemId });
    }
    if (payload.length === 0) { setError("Add at least one line before saving."); return null; }
    return payload;
  };

  /** Lenient lines for a draft: it may be unfinished, but a typed quantity or cost must still be valid. */
  const draftPayload = () => {
    const out: { description: string; quantity: number | null; unit_cost_kobo: number | null; item_id: string | null }[] = [];
    for (const [i, l] of lines.entries()) {
      if (!l.description.trim() && !l.cost.trim() && !l.itemId) continue;
      const q = l.qty.trim() === "" ? null : Number(l.qty);
      if (q !== null && (!Number.isFinite(q) || q <= 0)) { setFieldErrors({ [`line${i}`]: "Quantity must be more than zero." }); return null; }
      const cost = l.cost.trim() === "" ? null : parseNaira(l.cost);
      if (l.cost.trim() !== "" && (cost === null || cost < 0)) { setFieldErrors({ [`line${i}`]: "Enter the unit cost, like 12,500." }); return null; }
      out.push({ description: l.description.trim(), quantity: q, unit_cost_kobo: cost, item_id: l.itemId });
    }
    return out;
  };

  const fail = (e: unknown) => {
    if (isAuthFailure(e)) { void signOut(); return; }
    const m = e instanceof Error ? e.message : String(e);
    setError(/changed by someone else/i.test(m) ? "This draft was changed since you opened it. Go back and reopen it to see the latest version." : m);
  };

  /** Store (create or update) the draft. Nothing is posted: no stock, payable or number. */
  const persistDraft = async (): Promise<{ id: string } | null> => {
    const payload = draftPayload(); if (!payload) return null;
    const c = await getClient();
    const { data, error: err } = await c.rpc("save_purchase_draft", {
      target_org: orgId, p_id: draftId ?? null, p_expected_updated_at: draftId ? stamp : null,
      p_vendor: vendorId, p_vendor_name: vendorId ? null : (vendorName.trim() || null), p_reference: reference.trim() || null,
      p_purchase_date: toISODate(issueDate), p_due_date: null, p_notes: notes.trim() || null, p_vat_bps: vatBps, p_lines: payload,
    });
    if (err) throw new Error(err.message);
    return { id: (data as { id: string }).id };
  };

  const saveDraft = async () => {
    setError(null); setFieldErrors({}); setBusy(true);
    try { const r = await persistDraft(); if (r) { setFlash("Draft saved"); nav.goBack(); } }
    catch (e) { fail(e); } finally { setBusy(false); }
  };

  /** Confirm Purchase: save what is on screen, then post it once through create_purchase_invoice. */
  const confirmDraft = async () => {
    setError(null); setFieldErrors({});
    if (!postPayload()) return;                       // same strict checks as posting
    const paidKobo = paid.trim() === "" ? 0 : parseNaira(paid);
    if (paidKobo === null || paidKobo < 0) { setFieldErrors({ paid: "Enter an amount like 5,000." }); return; }
    setBusy(true);
    try {
      const saved = await persistDraft(); if (!saved) return;
      const c = await getClient();
      const { data, error: err } = await c.rpc("confirm_purchase_draft", { p_id: saved.id, p_amount_paid_kobo: paidKobo });
      if (err) {
        // The save above moved updated_at on; send them back to reopen it rather than leave a stale form.
        setFlash(`Not confirmed: ${err.message}`); nav.goBack(); return;
      }
      const n = (data as { number?: string }).number;
      setFlash(`Purchase ${n ?? ""} confirmed`.replace("  ", " ")); nav.goBack();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const deleteDraft = () => {
    Alert.alert("Delete this draft?", "This cannot be undone. Nothing has been recorded for it.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        setBusy(true);
        try {
          const c = await getClient();
          const { error: err } = await c.from("purchase_drafts").delete().eq("id", draftId!);
          if (err) throw new Error(err.message);
          setFlash("Draft deleted"); nav.goBack();
        } catch (e) { fail(e); } finally { setBusy(false); }
      } },
    ]);
  };

  /** Post a brand-new purchase directly (the original flow). */
  const submit = async () => {
    setError(null); setFieldErrors({});
    const payload = postPayload(); if (!payload) return;
    const paidKobo = paid.trim() === "" ? 0 : parseNaira(paid);
    if (paidKobo === null || paidKobo < 0) { setFieldErrors({ paid: "Enter an amount like 5,000." }); return; }
    setBusy(true);
    try {
      const c = await getClient();
      const { data, error: err } = await c.rpc("create_purchase_invoice", {
        target_org: orgId, p_vendor: vendorId, p_vendor_name: vendorId ? null : vendorName.trim(),
        p_reference: reference.trim() || null, p_issue_date: toISODate(issueDate), p_due_date: null,
        p_notes: notes.trim() || null, p_lines: payload, p_vat_bps: vatBps, p_amount_paid_kobo: paidKobo,
      });
      if (err) throw new Error(err.message);
      if ((data as { ok?: boolean } | null)?.ok) {
        const n = (data as { number?: string }).number;
        setFlash(`Purchase ${n ?? ""} recorded`.replace("  ", " "));
        nav.goBack(); return;
      }
      setError("The purchase could not be saved.");
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AppHeader title={draftId ? "Purchase Draft" : "Record Purchase"} onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 6, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        {error ? <View style={s.banner}><Text style={s.bannerText}>{error}</Text></View> : null}
        <Text style={s.hint}>{draftId ? "Draft: not recorded yet. No stock, no amount owed and no purchase number until you confirm it." : "Stock-item lines add to your stock at this cost."}</Text>
        {loadingDraft ? <Text style={s.hint}>Loading…</Text> : null}

        <Text style={s.label}>Supplier</Text>
        <View style={s.wrap}>
          {vendors.map((v) => (
            <Pressable key={v.id} onPress={() => { setVendorId(vendorId === v.id ? null : v.id); setVendorName(""); }} disabled={busy}
              style={[s.pill, vendorId === v.id && s.pillOn]}><Text style={[s.pillText, vendorId === v.id && { color: "#fff" }]}>{v.name}</Text></Pressable>
          ))}
        </View>
        {!vendorId ? <Field label={vendors.length ? "Or a new supplier" : "Supplier name"} value={vendorName} onChange={setVendorName}
          editable={!busy} placeholder="e.g. Lagos Wholesale Ltd" error={fieldErrors.vendor} /> : null}
        <Field label="Supplier's invoice number (optional)" value={reference} onChange={setReference} editable={!busy} />
        <DateField label="Purchase date" value={issueDate} onChange={setIssueDate} editable={!busy} />

        <Text style={s.section}>What you bought</Text>
        {lines.map((l, i) => (
          <View key={i} style={s.lineCard}>
            <View style={s.lineHead}>
              <Text style={s.lineTitle}>Line {i + 1}</Text>
              <View style={{ flex: 1 }} />
              {lines.length > 1 && <MoveButtons index={i} count={lines.length} onMove={(a, b) => setLines((ls) => moveItem(ls, a, b))} disabled={busy} />}
              {lines.length > 1 && <Pressable onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={busy} hitSlop={8}><Text style={s.remove}>Remove</Text></Pressable>}
            </View>
            {items.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {items.map((it) => (
                  <Pressable key={it.id} disabled={busy}
                    onPress={() => setLine(i, l.itemId === it.id ? { itemId: null } : { itemId: it.id, description: l.description.trim() ? l.description : it.name })}
                    style={[s.pill, { marginRight: 8 }, l.itemId === it.id && s.pillOn]}>
                    <Text style={[s.pillText, l.itemId === it.id && { color: "#fff" }]}>{it.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            <Field label="Description" value={l.description} onChange={(v) => setLine(i, { description: v })} editable={!busy} error={fieldErrors[`line${i}`]} />
            <View style={s.lineRow}>
              <View style={{ flex: 1 }}><Field label="Qty" value={l.qty} onChange={(v) => setLine(i, { qty: v })} keyboardType="decimal-pad" editable={!busy} /></View>
              <View style={{ flex: 1.6 }}><MoneyField label="Unit cost" value={l.cost} onChange={(v) => setLine(i, { cost: v })} placeholder="e.g. 12,500" editable={!busy} /></View>
            </View>
          </View>
        ))}
        <Pressable style={s.addLine} onPress={() => setLines((ls) => [...ls, { ...BLANK }])} disabled={busy}>
          <Icon name="plus" size={18} color={C.forest} /><Text style={s.addLineText}>Add line</Text>
        </Pressable>

        <Field label="VAT % on this bill" value={vatRate} onChange={setVatRate} keyboardType="decimal-pad" editable={!busy} />
        <Field label="Notes (optional)" value={notes} onChange={setNotes} editable={!busy} />
        <MoneyField label="Amount already paid (optional)" value={paid} onChange={setPaid} placeholder="0" editable={!busy} error={fieldErrors.paid} />

        <View style={s.totals}>
          <View style={s.totalRow}><Text style={s.totalLabel}>Subtotal</Text><Text style={s.totalValue}>{formatNaira(subtotal)}</Text></View>
          <View style={s.totalRow}><Text style={s.totalLabel}>VAT</Text><Text style={s.totalValue}>{formatNaira(vat)}</Text></View>
          <View style={[s.totalRow, s.final]}><Text style={s.strong}>Total</Text><Text style={s.strongV}>{formatNaira(subtotal + vat)}</Text></View>
          <Text style={s.note}>Confirmed when it saves — the server works out the final figures.</Text>
        </View>
        {draftId ? (
          <>
            <PrimaryButton label="Confirm Purchase" onPress={confirmDraft} busy={busy || loadingDraft} />
            <Pressable onPress={saveDraft} disabled={busy || loadingDraft} style={s.secondary} accessibilityRole="button"><Text style={s.secondaryText}>Save Draft</Text></Pressable>
            <Pressable onPress={deleteDraft} disabled={busy} style={s.secondary} accessibilityRole="button"><Text style={[s.secondaryText, { color: C.danger }]}>Delete Draft</Text></Pressable>
          </>
        ) : (
          <>
            <PrimaryButton label="Save Purchase" onPress={submit} busy={busy} />
            <Pressable onPress={saveDraft} disabled={busy} style={s.secondary} accessibilityRole="button"><Text style={s.secondaryText}>Save as Draft</Text></Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  banner: { backgroundColor: "#FEE4E2", borderRadius: 12, padding: 12, marginBottom: 14 },
  bannerText: { fontSize: 13, color: C.text, lineHeight: 19 },
  hint: { fontSize: 12.5, color: C.text2, marginBottom: 14 },
  label: { fontSize: 12.5, fontWeight: "600", color: C.text2, marginBottom: 6 },
  section: { fontSize: 16, fontWeight: "700", color: C.text, marginTop: 6, marginBottom: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pill: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.border },
  pillOn: { backgroundColor: C.primary, borderColor: C.primary },
  pillText: { fontSize: 12.5, fontWeight: "600", color: C.text2 },
  lineCard: { backgroundColor: "#fff", borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: C.border2 },
  lineHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  lineTitle: { fontSize: 12, fontWeight: "700", color: C.text2, letterSpacing: 0.4 },
  remove: { color: C.danger, fontSize: 13, fontWeight: "600" },
  lineRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  addLine: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: C.border, borderStyle: "dashed", flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", marginBottom: 16 },
  addLineText: { color: C.forest, fontSize: 14.5, fontWeight: "700" },
  totals: { backgroundColor: "#fff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border2, marginBottom: 16 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  final: { borderTopWidth: 1, borderTopColor: C.border2, marginTop: 6, paddingTop: 10 },
  totalLabel: { color: C.text2, fontSize: 13.5 }, totalValue: { color: C.text, fontSize: 13.5 },
  strong: { color: C.text, fontSize: 16, fontWeight: "700" }, strongV: { color: C.forest, fontSize: 19, fontWeight: "800" },
  secondary: { alignItems: "center", paddingVertical: 14 },
  secondaryText: { color: C.forest, fontSize: 14.5, fontWeight: "700" },
  note: { color: C.text3, fontSize: 11.5, marginTop: 8, lineHeight: 16 },
});
