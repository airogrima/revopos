import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation";
import MoveButtons, { moveItem } from "../components/MoveButtons";
import { setFlash } from "../lib/flash";
import { formatNaira, parseNaira } from "@revopass/core";
import { getClient, isAuthFailure, signOut } from "../lib/supabase";
import { useOrg } from "../lib/org";
import {
  DateField, Field, MoneyField, toISODate, useFormState,
} from "../components/form";
import { AppHeader, Icon, PrimaryButton } from "../components/kit";
import CustomerPicker from "../components/CustomerPicker";
import { C } from "../theme";

/**
 * Create an invoice from the phone.
 *
 * The largest of the write screens, and the reason the others came first: it
 * needs a customer to bill and benefits from items to pick from.
 *
 * Calls public.create_document — the same RPC the web form uses. Numbering,
 * per-line money and the header totals are all computed by database triggers,
 * so nothing here adds anything up. A phone that disagreed with the web about
 * an invoice total would be worse than a phone that could not create one.
 */

interface Customer { id: string; name: string }
interface Line { description: string; qty: string; price: string; /** carried unchanged from a saved/duplicated line */ discount?: string; item?: string | null }

const BLANK: Line = { description: "", qty: "1", price: "" };

/** Payment terms most invoices here use, as a starting point for the picker. */
const DEFAULT_TERM_DAYS = 30;

/** Keeps the picker in the order the query returned, once a name is added to it. */
const byName = (a: Customer, b: Customer) => a.name.localeCompare(b.name);

function daysFromToday(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * The chosen date restated as payment terms — "in 30 days".
 *
 * The old field asked for a number of days, and that framing is worth keeping
 * even though the input is now a calendar: "Net 30" is how the terms get agreed
 * out loud, so showing both means the picker never hides the thing people
 * negotiate. Counted off whole local days, so it cannot read "in 29 days"
 * because of the hour the invoice happens to be written.
 */
function dueHint(due: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(due) - startOfDay(new Date())) / 86_400_000);
  if (days === 0) return "Due today.";
  if (days === 1) return "Due tomorrow.";
  return `In ${days} days.`;
}

export default function CreateInvoiceScreen() {
  const nav = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, "CreateInvoice">>();
  const mode = route.params?.mode;            // "edit" a draft, "duplicate" into a new one, or undefined = new
  const sourceId = route.params?.documentId;
  const [loadedStamp, setLoadedStamp] = useState<string | null>(null);   // updated_at of the draft we opened
  const [number, setNumber] = useState<string | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(!!mode);
  const { orgId } = useOrg();
  const { busy, setBusy, error, setError, fieldErrors, setFieldErrors, applyResult } = useFormState();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [vatRate, setVatRate] = useState("7.5");
  const insets = useSafeAreaInsets();
  // The invoice date can now be chosen (create_document already accepts it); it defaults to today.
  const [issueDate, setIssueDate] = useState(() => new Date());
  const [dueDate, setDueDate] = useState(() => daysFromToday(DEFAULT_TERM_DAYS));
  const [lines, setLines] = useState<Line[]>([{ ...BLANK }]);
  const [dupNumber, setDupNumber] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = await getClient();
        const [{ data: cust }, { data: org }] = await Promise.all([
          supabase.from("customers").select("id,name")
            .eq("org_id", orgId).eq("is_archived", false).order("name"),
          supabase.from("organizations").select("vat_rate_bps").eq("id", orgId).maybeSingle(),
        ]);
        if (cancelled) return;
        setCustomers((cust ?? []) as Customer[]);
        // The business's own default rate, not a hardcoded 7.5 — a
        // zero-rated business should not have to clear the field every time.
        if (org?.vat_rate_bps != null) setVatRate((org.vat_rate_bps / 100).toString());
      } catch { /* the form still works; the picker is just empty */ }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  // Load the saved document when editing a draft or duplicating an invoice.
  useEffect(() => {
    if (!mode || !sourceId) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = await getClient();
        const { data: d, error: e } = await supabase.from("documents")
          .select("number,status,doc_type,customer_id,issue_date,due_date,updated_at,document_lines(description,quantity,unit_price_kobo,discount_kobo,tax_rate_bps,item_id,position)")
          .eq("id", sourceId).maybeSingle();
        if (e) throw new Error(e.message);
        if (!d) throw new Error("That invoice could not be found.");
        const doc = d as unknown as { number: string; status: string; customer_id: string | null; issue_date: string; due_date: string | null; updated_at: string;
          document_lines: { description: string; quantity: number | string; unit_price_kobo: number; discount_kobo: number; tax_rate_bps: number; item_id: string | null; position: number }[] };
        if (mode === "edit" && doc.status !== "draft") throw new Error("Only a draft can be edited. This invoice has already been issued.");
        const ls = [...doc.document_lines].sort((a, b) => a.position - b.position);
        if (cancelled) return;
        setCustomerId(doc.customer_id);
        setLines(ls.map((l) => ({ description: l.description, qty: String(Number(l.quantity)), price: (l.unit_price_kobo / 100).toFixed(2),
          discount: l.discount_kobo ? (l.discount_kobo / 100).toFixed(2) : "", item: l.item_id })));
        if (ls[0]) setVatRate(String(ls[0].tax_rate_bps / 100));
        if (mode === "edit") {
          setNumber(doc.number); setLoadedStamp(doc.updated_at);
          setIssueDate(new Date(doc.issue_date + "T00:00:00"));
          setDueDate(doc.due_date ? new Date(doc.due_date + "T00:00:00") : daysFromToday(DEFAULT_TERM_DAYS));
        } // a duplicate keeps today's dates and the standard terms: current rules, not the old document's
        setDupNumber(mode === "duplicate" ? doc.number : null);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!cancelled) setLoadingDoc(false); }
    })();
    return () => { cancelled = true; };
  }, [mode, sourceId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  /*
   * Running total, computed for DISPLAY only and never sent.
   *
   * The database is the authority — create_document ignores anything a client
   * might send as a total. This exists so somebody can see the figure before
   * they commit to it, which is worth having on a screen where the invoice is
   * being typed in front of the customer.
   */
  const preview = lines.reduce((sum, l) => {
    const price = parseNaira(l.price || "0") ?? 0;
    const qty = Number(l.qty || "0");
    const disc = l.discount ? (parseNaira(l.discount) ?? 0) : 0;
    return sum + (Number.isFinite(qty) && qty > 0 ? Math.round(price * qty) - disc : 0);
  }, 0);
  const vatBps = Math.round((Number(vatRate) || 0) * 100);
  const vatAmount = Math.round((preview * vatBps) / 10_000);

  const submit = async () => {
    setError(null);
    setFieldErrors({});

    if (!customerId) { setFieldErrors({ customer: "Choose who this invoice is for." }); return; }

    // Blank rows are skipped rather than rejected — the editor starts with one
    // empty row, and an extra untouched row is not a mistake worth refusing.
    const payload: { description: string; quantity: number; unit_price_kobo: number; tax_rate_bps: number; discount_kobo: number; item_id: string | null }[] = [];
    for (const [i, l] of lines.entries()) {
      const blank = !l.description.trim() && !l.price.trim();
      if (blank) continue;

      if (!l.description.trim()) {
        setFieldErrors({ [`line${i}`]: "Say what this line is for." });
        return;
      }
      const qty = Number(l.qty || "1");
      if (!Number.isFinite(qty) || qty <= 0) {
        setFieldErrors({ [`line${i}`]: "Quantity must be more than zero." });
        return;
      }
      const kobo = parseNaira(l.price);
      if (kobo === null || kobo < 0) {
        setFieldErrors({ [`line${i}`]: "Enter a price like 25,000." });
        return;
      }
      payload.push({ description: l.description.trim(), quantity: qty, unit_price_kobo: kobo, tax_rate_bps: vatBps,
        discount_kobo: l.discount ? (parseNaira(l.discount) ?? 0) : 0, item_id: l.item ?? null });
    }

    if (payload.length === 0) { setError("Add at least one line before saving."); return; }

    setBusy(true);
    try {
      const supabase = await getClient();
      if (mode === "edit" && sourceId) {
        // Same document, same number. The server refuses a non-draft, a non-admin, or a draft
        // that changed since it was opened (so we never overwrite a newer edit).
        const { data, error: upErr } = await supabase.rpc("update_draft_document", {
          p_id: sourceId, p_expected_updated_at: loadedStamp, p_customer_id: customerId,
          p_issue_date: toISODate(issueDate), p_due_date: toISODate(dueDate), p_notes: null, p_lines: payload,
        });
        if (upErr) {
          if (/changed by someone else/i.test(upErr.message)) throw new Error("This draft was changed since you opened it. Go back and reopen it to see the latest version.");
          throw new Error(upErr.message);
        }
        if (data) { setFlash(`Draft ${number ?? ""} saved`.replace("  ", " ")); nav.goBack(); return; }
        applyResult(null);
        return;
      }
      const { data, error: rpcError } = await supabase.rpc("create_document", {
        target_org: orgId,
        p_doc_type: "invoice",
        p_customer_id: customerId,
        p_issue_date: toISODate(issueDate),
        p_due_date: toISODate(dueDate),
        p_notes: null,
        p_lines: payload,
      });
      if (rpcError) throw new Error(rpcError.message);

      // create_document returns the document itself rather than {ok:...}, so a
      // row coming back IS the success signal. The number is drawn atomically by
      // the server at this moment, so a duplicate can never reuse the original's.
      if (data) {
        const n = (data as { number?: string }).number;
        setFlash(mode === "duplicate" ? `Duplicate saved as draft ${n ?? ""}`.trim() : `Draft ${n ?? ""} created`.trim());
        nav.goBack(); return;
      }
      applyResult(null);
    } catch (e) {
      if (isAuthFailure(e)) { void signOut(); return; }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stepQty = (i: number, delta: number) => {
    const cur = Number(lines[i]!.qty || "0");
    const next = Math.max(1, (Number.isFinite(cur) ? cur : 0) + delta);
    setLine(i, { qty: String(next) });
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      // Without this the keyboard covers the save button on smaller phones.
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <AppHeader title={mode === "edit" ? "Edit Draft" : mode === "duplicate" ? "Duplicate Invoice" : "Create Invoice"} onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 6, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        {error ? <View style={s.banner}><Text style={s.bannerText}>{error}</Text></View> : null}
        <Text style={s.hint}>
          {mode === "edit" ? `Editing draft ${number ?? ""}. The number stays the same.`
            : mode === "duplicate" ? `Duplicate of ${dupNumber ?? "an invoice"}. It saves as a new draft with a new number; the original is not changed.`
            : "It saves as a draft — you can send it afterwards."}
        </Text>
        {loadingDoc ? <Text style={s.hint}>Loading…</Text> : null}

        <CustomerPicker
          customers={customers}
          value={customerId}
          onChange={setCustomerId}
          onCreated={(c) => setCustomers((cs) => [...cs, c].sort(byName))}
          error={fieldErrors.customer}
          disabled={busy}
        />

        <DateField label="Invoice date" value={issueDate} onChange={setIssueDate} editable={!busy} />
        {/* Picked from a calendar rather than typed as a number of days; the
            default is still 30 days out, so the common case is one glance. */}
        <DateField label="Due date" value={dueDate} onChange={setDueDate}
                   minimumDate={issueDate} hint={dueHint(dueDate)} editable={!busy} />

        <Text style={s.section}>Products / Services</Text>
        {lines.map((l, i) => (
          <View key={i} style={s.lineCard}>
            <View style={s.lineHead}>
              <Text style={s.lineTitle}>Item {i + 1}</Text>
              <View style={{ flex: 1 }} />
              {lines.length > 1 && <MoveButtons index={i} count={lines.length} onMove={(a, b) => setLines((ls) => moveItem(ls, a, b))} disabled={busy} />}
              {lines.length > 1 && (
                <Pressable onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={busy} hitSlop={8}>
                  <Text style={s.remove}>Remove</Text>
                </Pressable>
              )}
            </View>
            <Field label="What are you charging for?" value={l.description}
                   onChange={(v) => setLine(i, { description: v })}
                   placeholder="e.g. Site survey" editable={!busy}
                   error={fieldErrors[`line${i}`]} />
            <View style={s.lineRow}>
              <View style={{ flex: 1.1 }}>
                <Text style={s.miniLabel}>Qty</Text>
                <View style={s.stepper}>
                  <Pressable onPress={() => stepQty(i, -1)} disabled={busy} style={s.stepBtn} accessibilityLabel="Decrease quantity" hitSlop={6}>
                    <Icon name="minus" size={16} color={C.text} />
                  </Pressable>
                  <Text style={s.stepVal}>{l.qty || "1"}</Text>
                  <Pressable onPress={() => stepQty(i, 1)} disabled={busy} style={s.stepBtn} accessibilityLabel="Increase quantity" hitSlop={6}>
                    <Icon name="plus" size={16} color={C.text} />
                  </Pressable>
                </View>
              </View>
              <View style={{ flex: 1.6 }}>
                <MoneyField label="Unit price" value={l.price} onChange={(v) => setLine(i, { price: v })}
                            placeholder="e.g. 25,000" editable={!busy} />
              </View>
            </View>
          </View>
        ))}

        <Pressable style={s.addLine} onPress={() => setLines((ls) => [...ls, { ...BLANK }])} disabled={busy}>
          <Icon name="plus" size={18} color={C.forest} />
          <Text style={s.addLineText}>Add Item</Text>
        </Pressable>

        <Field label="VAT %" value={vatRate} onChange={setVatRate}
               keyboardType="decimal-pad" editable={!busy} />

        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Subtotal</Text>
            <Text style={s.totalValue}>{formatNaira(preview)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Tax (VAT {vatRate || 0}%)</Text>
            <Text style={s.totalValue}>{formatNaira(vatAmount)}</Text>
          </View>
          <View style={[s.totalRow, s.totalRowFinal]}>
            <Text style={s.totalLabelStrong}>Total</Text>
            <Text style={s.totalValueStrong}>{formatNaira(preview + vatAmount)}</Text>
          </View>
          <Text style={s.totalNote}>
            Confirmed when it saves — the final figures are worked out on the server.
          </Text>
        </View>

        <PrimaryButton label={mode === "edit" ? "Save Draft" : mode === "duplicate" ? "Save as New Draft" : "Create Invoice"} onPress={submit} busy={busy || loadingDoc} />
        {mode === "edit" ? <Pressable onPress={() => nav.goBack()} disabled={busy} style={s.cancel} accessibilityRole="button"><Text style={s.cancelText}>Cancel</Text></Pressable> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  banner: { backgroundColor: "#FEE4E2", borderRadius: 12, padding: 12, marginBottom: 14 },
  bannerText: { fontSize: 13, color: C.text, lineHeight: 19 },
  hint: { fontSize: 12.5, color: C.text2, marginBottom: 14 },
  section: { fontSize: 16, fontWeight: "700", color: C.text, marginTop: 6, marginBottom: 10 },
  lineCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: C.border2,
  },
  lineHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  lineTitle: { fontSize: 12, fontWeight: "700", color: C.text2, letterSpacing: 0.4 },
  cancel: { alignItems: "center", paddingVertical: 14 },
  cancelText: { color: C.text2, fontSize: 14.5, fontWeight: "600" },
  remove: { color: C.danger, fontSize: 13, fontWeight: "600" },
  lineRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  miniLabel: { fontSize: 12.5, fontWeight: "600", color: C.text2, marginBottom: 6 },
  stepper: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderColor: C.border, borderRadius: 12, minHeight: 48, paddingHorizontal: 6, backgroundColor: "#fff",
  },
  stepBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.border2, alignItems: "center", justifyContent: "center" },
  stepVal: { fontSize: 15, fontWeight: "600", color: C.text },
  addLine: {
    minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: C.border, borderStyle: "dashed",
    flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", marginBottom: 16,
  },
  addLineText: { color: C.forest, fontSize: 14.5, fontWeight: "700" },
  totals: { backgroundColor: "#fff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border2, marginBottom: 16 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  totalRowFinal: { borderTopWidth: 1, borderTopColor: C.border2, marginTop: 6, paddingTop: 10 },
  totalLabel: { color: C.text2, fontSize: 13.5 },
  totalValue: { color: C.text, fontSize: 13.5 },
  totalLabelStrong: { color: C.text, fontSize: 16, fontWeight: "700" },
  totalValueStrong: { color: C.forest, fontSize: 19, fontWeight: "800" },
  totalNote: { color: C.text3, fontSize: 11.5, marginTop: 8, lineHeight: 16 },
});
