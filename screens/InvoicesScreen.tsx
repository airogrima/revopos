/**
 * Invoices — who owes what.
 *
 * Reads `documents` directly rather than through an RPC because there is no
 * invoice-list RPC; the web page queries the table the same way. Totals are
 * summed from the rows it already has, which is fine for a list this size, but
 * anything that needs aggregation across ALL invoices belongs in Postgres.
 *
 * "Overdue" is derived, not stored: an invoice is overdue when it still has a
 * balance AND its due date has passed AND it is not a draft. The `status`
 * column alone will happily say "sent" three months after the due date.
 */

import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatNaira, getClient } from "../lib/supabase";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { useOrgData } from "../lib/org";
import { shareDocumentPdf } from "../lib/pdf";
import DocumentPreview from "../components/DocumentPreview";
import { takeFlash } from "../lib/flash";
import RecordPaymentSheet from "../components/RecordPaymentSheet";
import { C } from "../theme";
import { EmptyState, ErrorView, Loading, Screen, u } from "../components/ui";
import { AppHeader, Avatar, FilterChips, Icon, ListCard, RoundAddButton, SearchField, StatusBadge } from "../components/kit";

interface Row {
  id: string; number: string; status: string;
  issue_date: string; due_date: string | null;
  total_kobo: number; balance_kobo: number; amount_paid_kobo: number;
  /** Needed to build the PDF — it is the share page the PDF is rendered from. */
  public_token: string | null;
  customers: { name: string } | null;
}

const TODAY = () => new Date().toISOString().slice(0, 10);

function isOverdue(r: Row, today: string) {
  return r.balance_kobo > 0 && !!r.due_date && r.due_date < today && r.status !== "draft";
}

function statusOf(r: Row, today: string) {
  return isOverdue(r, today) ? "overdue" : r.status;
}

const STATUS_COLOR: Record<string, string> = {
  paid: C.success, overdue: C.danger, sent: C.primary,
  draft: C.text3, viewed: C.primary, void: C.text3,
};

export default function InvoicesScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { loading, refreshing, error, data: raw, reload, onRefresh } =
    useOrgData<Row[]>(async (supabase, orgId) => {

      const { data, error: err } = await supabase
        .from("documents")
        .select("id,number,status,issue_date,due_date,total_kobo,balance_kobo,amount_paid_kobo,public_token,customers(name)")
        .eq("org_id", orgId)
        .eq("doc_type", "invoice")
        .order("issue_date", { ascending: false });

      if (err) throw new Error(err.message);
      return (data ?? []) as unknown as Row[];
    });
  const rows = raw ?? [];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "paid" | "pending" | "overdue">("all");
  // The filter icon cycles the order: newest first, oldest first, largest first.
  const [sort, setSort] = useState<"new" | "old" | "big">("new");

  /*
   * Which invoice is being paid, and the confirmation after. Held here rather
   * than in the sheet so the list can refetch on success — the totals above
   * are derived from these rows and would otherwise still show the old balance.
   */
  const [paying, setPaying] = useState<Row | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { const m = takeFlash(); if (m) { setFlash(m); reload(); } }, []));   // eslint-disable-line react-hooks/exhaustive-deps
  /* Which row is building a PDF. Per-row rather than a page-wide flag, so the
     spinner appears on the invoice actually being exported. */
  const [pdfFor, setPdfFor] = useState<string | null>(null);
  const [previewRow, setPreviewRow] = useState<Row | null>(null);
  const [receipt, setReceipt] = useState<{ number: string; token: string } | null>(null);
  const [receiptFor, setReceiptFor] = useState<string | null>(null);

  /**
   * Issue (or reopen) the receipt for an invoice's latest confirmed payment, exactly as the web does:
   * generate_receipt is idempotent (one receipt per payment), numbers it on the server, links it to
   * the payment and its invoice, and refuses anything but money actually received. An invoice with
   * no payment gets no receipt, and nothing here changes an invoice's status or balance.
   */
  const makeReceipt = async (r: Row) => {
    if (receiptFor) return;
    setReceiptFor(r.id);
    try {
      const c = await getClient();
      const { data: pays, error: pe } = await c.from("payments").select("id").eq("document_id", r.id).eq("direction", "inbound")
        .order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(1);
      if (pe) throw new Error(pe.message);
      const paymentId = (pays as { id: string }[] | null)?.[0]?.id;
      if (!paymentId) { setFlash("No payment has been recorded against this invoice yet. Record the payment first: a receipt has to acknowledge money that actually arrived."); return; }
      const { data, error: re } = await c.rpc("generate_receipt", { p_payment_id: paymentId });
      if (re) throw new Error(re.message);
      const g = data as { ok: boolean; reason: string; id?: string; number?: string };
      if (!g.ok || !g.id) { setFlash(g.reason === "not_money_received" ? "That payment is not money received, so it has no receipt." : `Could not issue a receipt: ${g.reason}`); return; }
      const { data: doc, error: de } = await c.from("documents").select("number,public_token").eq("id", g.id).maybeSingle();
      if (de || !doc) throw new Error(de?.message ?? "The receipt could not be opened.");
      setFlash(g.reason === "already_exists" ? `Receipt ${g.number} already exists for this payment.` : `Receipt ${g.number} issued.`);
      setReceipt({ number: (doc as { number: string }).number, token: (doc as { public_token: string }).public_token });
      reload();
    } catch (e) { setFlash(e instanceof Error ? e.message : "Could not issue the receipt."); }
    finally { setReceiptFor(null); }
  };

  const sharePdf = async (r: Row) => {
    if (!r.public_token) {
      setFlash("This invoice has no share link yet, so it cannot be exported.");
      return;
    }
    setPdfFor(r.id);
    try {
      await shareDocumentPdf(r.public_token);
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "Could not build the PDF.");
    } finally {
      setPdfFor(null);
    }
  };

  if (loading) return <Loading label="Loading invoices…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  const today = TODAY();
  const invoiced = rows.reduce((a, r) => a + r.total_kobo, 0);
  const outstanding = rows.reduce((a, r) => a + r.balance_kobo, 0);
  const overdue = rows.reduce((a, r) => a + (isOverdue(r, today) ? r.balance_kobo : 0), 0);

  /*
   * The chips are views over the same rows, not new queries. "Pending" is an
   * invoice that is out but not yet paid and not late (sent, viewed or draft
   * with a balance), so Paid + Pending + Overdue together cover every invoice.
   */
  const bucket = (r: Row): "paid" | "pending" | "overdue" | "void" =>
    r.status === "void" ? "void" : isOverdue(r, today) ? "overdue" : r.balance_kobo <= 0 && r.status !== "draft" ? "paid" : "pending";
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (filter === "all" || bucket(r) === filter) &&
    (q === "" || r.number.toLowerCase().includes(q) || (r.customers?.name ?? "").toLowerCase().includes(q)))
    .sort((a, b) => sort === "big" ? b.total_kobo - a.total_kobo : sort === "old" ? a.issue_date.localeCompare(b.issue_date) : b.issue_date.localeCompare(a.issue_date));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <AppHeader title="Invoices" subtitle={`${rows.length} invoice${rows.length === 1 ? "" : "s"}`}
                 right={<RoundAddButton label="New invoice" onPress={() => nav.navigate("CreateInvoice")} />} />
      <Screen refreshing={refreshing} onRefresh={onRefresh} topPad={false}>
      {flash && (
        <Pressable onPress={() => setFlash(null)} style={s.flash}>
          <Text style={s.flashText}>{flash}</Text>
        </Pressable>
      )}

      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ flex: 1 }}><SearchField value={query} onChange={setQuery} placeholder="Search invoices, customers…" /></View>
        <Pressable onPress={() => setSort((x) => x === "new" ? "old" : x === "old" ? "big" : "new")} style={s.filterBtn}
                   accessibilityRole="button" accessibilityLabel={`Sort: ${sort === "new" ? "newest" : sort === "old" ? "oldest" : "largest"} first. Tap to change`}>
          <Icon name="sliders" size={20} color={C.forest} />
        </Pressable>
      </View>
      <Text style={s.sortNote}>{sort === "new" ? "Newest first" : sort === "old" ? "Oldest first" : "Largest first"}</Text>
      <FilterChips value={filter} onChange={setFilter} options={[
        { value: "all", label: "All" }, { value: "paid", label: "Paid" },
        { value: "pending", label: "Pending" }, { value: "overdue", label: "Overdue" },
      ]} />

      <View style={s.summary}>
        <View style={s.sumCell}><Text style={s.sumLabel}>Invoiced</Text><Text style={s.sumValue} numberOfLines={1} adjustsFontSizeToFit>{formatNaira(invoiced)}</Text></View>
        <View style={s.sumCell}><Text style={s.sumLabel}>Outstanding</Text><Text style={s.sumValue} numberOfLines={1} adjustsFontSizeToFit>{formatNaira(outstanding)}</Text></View>
        <View style={s.sumCell}><Text style={s.sumLabel}>Overdue</Text><Text style={[s.sumValue, overdue > 0 && { color: C.danger }]} numberOfLines={1} adjustsFontSizeToFit>{formatNaira(overdue)}</Text></View>
      </View>

      {shown.length === 0 ? (
        <ListCard>
          <EmptyState
            title={rows.length === 0 ? "No invoices yet" : "No matching invoices"}
            body={rows.length === 0
              ? "Invoices you create appear here with their status, due date and outstanding balance."
              : "Try a different search or filter."}
          />
        </ListCard>
      ) : (
        shown.map((r) => {
          const st = statusOf(r, today);
          const b = bucket(r);
          const payable = r.balance_kobo > 0 && r.status !== "void";
          return (
            <ListCard key={r.id} onPress={payable ? () => setPaying(r) : undefined}>
              <View style={s.cardRow}>
                <Avatar name={r.customers?.name ?? "?"} size={42} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.name} numberOfLines={1}>{r.customers?.name ?? "No customer"}</Text>
                  <Text style={u.rowMeta} numberOfLines={1}>{r.number}</Text>
                  <Text style={s.date} numberOfLines={1}>{r.issue_date}{r.due_date ? ` · due ${r.due_date}` : ""}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 5 }}>
                  <Text style={s.amount}>{formatNaira(r.total_kobo)}</Text>
                  <StatusBadge status={b === "pending" && st === "draft" ? "draft" : b} label={b === "pending" && st === "draft" ? "draft" : b} />
                </View>
                <Icon name="right" size={16} color={C.text3} />
              </View>
              {(r.balance_kobo > 0 || r.status === "draft" || (r.status !== "void" && r.public_token)) && (
                <View style={s.cardFoot}>
                  <Text style={[u.rowMeta, { color: b === "overdue" ? C.danger : C.text2 }]}>
                    {r.balance_kobo > 0 ? `${formatNaira(r.balance_kobo)} due` : ""}
                  </Text>
                  {/*
                    Drafts are excluded because the PDF is rendered from the
                    public share page, and that page refuses drafts. Its own
                    Pressable inside the card: tapping the card records a
                    payment, so the export needs its own target.
                  */}
                  {r.status !== "void" && (
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 1 }}>
                      {r.status === "draft" && (
                        <Pressable onPress={() => nav.navigate("CreateInvoice", { mode: "edit", documentId: r.id })} hitSlop={8} style={s.pdfBtn}
                          accessibilityRole="button" accessibilityLabel={`Edit draft ${r.number}`}>
                          <Text style={s.pdfText}>EDIT</Text>
                        </Pressable>
                      )}
                      {r.amount_paid_kobo > 0 && r.status !== "draft" && (
                        <Pressable onPress={() => void makeReceipt(r)} disabled={receiptFor === r.id} hitSlop={8} style={s.pdfBtn}
                          accessibilityRole="button" accessibilityLabel={`Generate receipt for invoice ${r.number}`}>
                          <Text style={s.pdfText}>{receiptFor === r.id ? "Issuing…" : "RECEIPT"}</Text>
                        </Pressable>
                      )}
                      <Pressable onPress={() => nav.navigate("CreateInvoice", { mode: "duplicate", documentId: r.id })} hitSlop={8} style={s.pdfBtn}
                        accessibilityRole="button" accessibilityLabel={`Duplicate invoice ${r.number}`}>
                        <Text style={s.pdfText}>DUPLICATE</Text>
                      </Pressable>
                      {r.status !== "draft" && r.public_token && (<>
                      <Pressable onPress={() => setPreviewRow(r)} hitSlop={8} style={s.pdfBtn} accessibilityRole="button" accessibilityLabel={`Preview invoice ${r.number}`}>
                        <Text style={s.pdfText}>PREVIEW</Text>
                      </Pressable>
                      <Pressable onPress={() => void sharePdf(r)} disabled={pdfFor === r.id} hitSlop={8} style={s.pdfBtn}>
                        <Text style={s.pdfText}>{pdfFor === r.id ? "Preparing…" : "PDF"}</Text>
                      </Pressable></>)}
                    </View>
                  )}
                </View>
              )}
            </ListCard>
          );
        })
      )}

      <Text style={u.footer}>© 2026 Revo Space Enterprise Ltd.</Text>

      <DocumentPreview visible={!!receipt} title={receipt ? `Receipt ${receipt.number}` : ""} status="paid"
        source={receipt ? { kind: "public", token: receipt.token } : null} onClose={() => setReceipt(null)} />
      <DocumentPreview visible={!!previewRow} title={previewRow ? `Invoice ${previewRow.number}` : ""} status={previewRow?.status}
        source={previewRow?.public_token ? { kind: "public", token: previewRow.public_token } : null} onClose={() => setPreviewRow(null)} />

      <RecordPaymentSheet
        invoice={paying ? {
          id: paying.id,
          number: paying.number,
          balance_kobo: paying.balance_kobo,
          customerName: paying.customers?.name ?? "No customer",
        } : null}
        onClose={() => setPaying(null)}
        onRecorded={(message) => { setFlash(message); reload(); }}
      />
      </Screen>
    </View>
  );
}

const s = StyleSheet.create({
  filterBtn: { width: 46, height: 46, borderRadius: 14, backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  sortNote: { fontSize: 11.5, color: C.text3, marginTop: 6, marginLeft: 4 },
  summary: { flexDirection: "row", gap: 8, marginBottom: 14 },
  sumCell: { flex: 1, backgroundColor: "#fff", borderRadius: 14, padding: 10, borderWidth: 1, borderColor: C.border2 },
  sumLabel: { fontSize: 11, color: C.text2 },
  sumValue: { fontSize: 14.5, fontWeight: "700", color: C.text, marginTop: 2 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { fontSize: 15, fontWeight: "600", color: C.text },
  date: { fontSize: 11, color: C.text3, marginTop: 1 },
  amount: { fontSize: 15, fontWeight: "700", color: C.text },
  cardFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border2 },
  flash: {
    backgroundColor: "#E7F5EF", borderRadius: 12, padding: 12, marginBottom: 12,
  },
  flashText: { color: C.text, fontSize: 13, lineHeight: 19 },
  pdfBtn: { marginTop: 6, paddingVertical: 3, paddingHorizontal: 9,
            borderRadius: 8, backgroundColor: C.border2 },
  pdfText: { fontSize: 11, fontWeight: "700", color: C.primary, letterSpacing: 0.3 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: { borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 },
  chipText: { fontSize: 10, fontWeight: "600", textTransform: "capitalize" },
});
