/**
 * Stock, purchases, expenses and contacts reports for a chosen period.
 *
 * Each reads the RPC the matching web report reads (stock_report,
 * purchases_report, expense_report, contact_report); nothing is totalled by
 * hand except summing the rows the server returned for display.
 */
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { formatNaira, getClient } from "../lib/supabase";
import { useOrg } from "../lib/org";
import { RANGE_OPTIONS, rangeDates, type Range } from "../lib/range";
import { FilterChips } from "../components/kit";
import { Card, EmptyState, ErrorView, Loading, u } from "../components/ui";

type Kind = "stock" | "purchases" | "expenses" | "contacts";

function useReport<T>(kind: Kind, range: Range) {
  const { orgId } = useOrg();
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!orgId) return;
    let off = false;
    setData(null); setErr(null);
    (async () => {
      try {
        const c = await getClient();
        const { from, to } = rangeDates(range);
        const fn = { stock: "stock_report", purchases: "purchases_report", expenses: "expense_report", contacts: "contact_report" }[kind];
        const { data: d, error } = await c.rpc(fn, { target_org: orgId, from_date: from, to_date: to });
        if (error) throw new Error(error.message);
        if (!off) setData(d as T);
      } catch (e) { if (!off) setErr(e instanceof Error ? e.message : "Could not load the report."); }
    })();
    return () => { off = true; };
  }, [orgId, kind, range, tick]);
  return { data, err, retry: () => setTick((t) => t + 1) };
}

function Row({ title, meta, amount, strong }: { title: string; meta?: string; amount: string; strong?: boolean }) {
  return (
    <View style={u.listRow}>
      <View style={{ flex: 1 }}>
        <Text style={[u.rowTitle, strong && { fontWeight: "700" }]} numberOfLines={1}>{title}</Text>
        {meta ? <Text style={u.rowMeta}>{meta}</Text> : null}
      </View>
      <Text style={[u.rowAmount, strong && { fontWeight: "700" }]}>{amount}</Text>
    </View>
  );
}

interface StockRow {
  item_id: string; name: string; unit: string | null; opening_qty: number; sold_qty: number; added_qty: number;
  closing_qty: number; closing_value_kobo: number | null; cost_basis?: string | null;
}
interface PurchRep { purchase_count: number; purchased_kobo: number; paid_kobo: number; payable_kobo: number;
  rows: { id: string; number: string; date: string; vendor: string | null; total_kobo: number; balance_kobo: number; status: string }[] }
interface ExpRep { total_kobo: number; vat_kobo: number; by_category: { category: string; amount_kobo: number; count: number }[] }
interface ContactRow { customer_id: string; name: string; invoice_count: number; invoiced_kobo: number; paid_kobo: number; outstanding_kobo: number; last_invoice_date: string | null }

export default function RangeReport({ kind }: { kind: Kind }) {
  const [range, setRange] = useState<Range>("month");
  const { data, err, retry } = useReport<unknown>(kind, range);
  const { from, to } = rangeDates(range);
  const sub = `${from} to ${to}`;

  let body: React.ReactNode;
  if (err) body = <ErrorView message={err} onRetry={retry} />;
  else if (data == null) body = <Loading label="Loading report…" />;
  else if (kind === "stock") {
    const rows = data as StockRow[];
    const value = rows.reduce((a, r) => a + (r.closing_value_kobo ?? 0), 0);
    const unvalued = rows.filter((r) => r.closing_value_kobo === null && Number(r.closing_qty) !== 0).length;
    body = (
      <>
        <Card title="Stock value" subtitle={`As at ${to}, at average purchase cost`}>
          <Row title="Closing stock value" amount={formatNaira(value)} strong />
          {unvalued > 0 ? <Text style={[u.rowMeta, { marginTop: 8 }]}>{unvalued} item{unvalued === 1 ? " has" : "s have"} stock but no recorded cost, so they are not valued. Record a purchase with a cost to value them.</Text> : null}
        </Card>
        <Card title="Stock movement" subtitle={sub}>
          {rows.length === 0 ? <EmptyState title="No tracked products" body="Products you track will appear here with opening, movement and closing quantities." /> :
            rows.map((r) => (
              <Row key={r.item_id} title={r.name}
                meta={`Open ${Number(r.opening_qty)} · +${Number(r.added_qty)} · sold ${Number(r.sold_qty)} · close ${Number(r.closing_qty)}${r.unit ? " " + r.unit : ""}`}
                amount={r.closing_value_kobo === null ? "No cost" : formatNaira(r.closing_value_kobo)} />
            ))}
        </Card>
      </>
    );
  } else if (kind === "purchases") {
    const r = data as PurchRep;
    body = (
      <>
        <Card title="Purchases" subtitle={sub}>
          <Row title="Bills recorded" amount={String(r.purchase_count)} />
          <Row title="Purchased" amount={formatNaira(r.purchased_kobo)} />
          <Row title="Paid" amount={formatNaira(r.paid_kobo)} />
          <Row title="Owed to suppliers today" amount={formatNaira(r.payable_kobo)} strong />
        </Card>
        <Card title="Bills">
          {r.rows.length === 0 ? <EmptyState title="No purchases in this period" body="Supplier bills you record are listed here." /> :
            r.rows.map((p) => <Row key={p.id} title={`${p.number} · ${p.vendor ?? "Supplier"}`} meta={`${p.date} · ${p.status}`} amount={formatNaira(p.total_kobo)} />)}
        </Card>
      </>
    );
  } else if (kind === "expenses") {
    const r = data as ExpRep;
    body = (
      <Card title="Expenses" subtitle={sub}>
        <Row title="Total spent" amount={formatNaira(r.total_kobo)} strong />
        <Row title="Of which VAT" amount={formatNaira(r.vat_kobo)} />
        {r.by_category.length === 0 ? <EmptyState title="No expenses in this period" body="Expenses you record are grouped by category here." /> :
          r.by_category.map((c) => <Row key={c.category} title={c.category} meta={`${c.count} expense${c.count === 1 ? "" : "s"}`} amount={formatNaira(c.amount_kobo)} />)}
      </Card>
    );
  } else {
    const rows = data as ContactRow[];
    const invoiced = rows.reduce((a, r) => a + Number(r.invoiced_kobo), 0);
    const outstanding = rows.reduce((a, r) => a + Number(r.outstanding_kobo), 0);
    body = (
      <>
        <Card title="Contacts" subtitle={sub}>
          <Row title="Contacts" amount={String(rows.length)} />
          <Row title="Invoiced" amount={formatNaira(invoiced)} />
          <Row title="Outstanding" amount={formatNaira(outstanding)} strong />
        </Card>
        <Card title="Contacts by value">
          {rows.length === 0 ? <EmptyState title="No contacts yet" body="Add a contact to see what they have been invoiced and have paid." /> :
            rows.map((r) => <Row key={r.customer_id} title={r.name}
              meta={`${r.invoice_count} invoice${r.invoice_count === 1 ? "" : "s"} · paid ${formatNaira(r.paid_kobo)}${r.last_invoice_date ? " · last " + r.last_invoice_date : ""}`}
              amount={formatNaira(r.outstanding_kobo)} />)}
        </Card>
      </>
    );
  }

  return (
    <>
      <FilterChips value={range} onChange={setRange} options={RANGE_OPTIONS} />
      {body}
    </>
  );
}
