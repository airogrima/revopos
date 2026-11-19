/**
 * Profit & Loss for a chosen period.
 *
 * Every number comes from the profit_and_loss RPC, the same function the web
 * statement reads (net sales, weighted-average cost of goods sold, gross profit,
 * expenses). Nothing is calculated here except display; in particular gross
 * profit and margin are the server's, so phone and web cannot disagree.
 */
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { formatNaira, getClient } from "../lib/supabase";
import { useOrg } from "../lib/org";
import { C } from "../theme";
import { FilterChips } from "../components/kit";
import { RANGE_OPTIONS, rangeDates, type Range } from "../lib/range";
import { Card, ErrorView, Loading, u } from "../components/ui";

interface PL {
  gross_sales_kobo?: number; discounts_kobo?: number; sales_returns_kobo?: number; net_sales_kobo?: number;
  revenue_kobo?: number; cogs_kobo: number; cogs_unpriced_movements: number; gross_profit_kobo: number; gross_margin_pct: number | null;
  invoice_stock_lines_without_cost?: number;
  operating_expenses_kobo: number; net_profit_kobo: number;
  expenses_by_category: { category: string; amount_kobo: number }[];
}
function Line({ label, value, bold, color }: { label: string; value: number; bold?: boolean; color?: string }) {
  return (
    <View style={u.listRow}>
      <Text style={[u.rowTitle, { flex: 1 }, bold && { fontWeight: "700" }]}>{label}</Text>
      <Text style={[u.rowAmount, bold && { fontWeight: "700" }, color ? { color } : null]}>{formatNaira(value)}</Text>
    </View>
  );
}

export default function ProfitLossView() {
  const { orgId } = useOrg();
  const [range, setRange] = useState<Range>("month");
  const [pl, setPl] = useState<PL | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setPl(null); setErr(null);
    (async () => {
      try {
        const c = await getClient();
        const { from, to } = rangeDates(range);
        const { data, error } = await c.rpc("profit_and_loss", { target_org: orgId, from_date: from, to_date: to });
        if (error) throw new Error(error.message);
        if (!cancelled) setPl(data as PL);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load the statement.");
      }
    })();
    return () => { cancelled = true; };
  }, [orgId, range, tick]);

  const { from, to } = rangeDates(range);
  const loss = (pl?.net_profit_kobo ?? 0) < 0;

  return (
    <>
      <FilterChips value={range} onChange={setRange} options={RANGE_OPTIONS} />
      {err ? <ErrorView message={err} onRetry={() => setTick((t) => t + 1)} /> : !pl ? <Loading label="Loading statement…" /> : (
        <>
          <Card title="Profit & Loss" subtitle={`${from} to ${to} · accrual basis`}>
            <Line label="Gross sales (before VAT)" value={pl.gross_sales_kobo ?? pl.revenue_kobo ?? 0} />
            <Line label="Less: discounts" value={pl.discounts_kobo ?? 0} />
            <Line label="Less: sales returns and refunds" value={pl.sales_returns_kobo ?? 0} />
            <Line label="Net sales" value={pl.net_sales_kobo ?? pl.revenue_kobo ?? 0} bold />
            <Line label="Less: cost of goods sold" value={pl.cogs_kobo} />
            <Line label={`Gross profit${pl.gross_margin_pct != null ? ` (${pl.gross_margin_pct}%)` : ""}`} value={pl.gross_profit_kobo} bold />
            {pl.expenses_by_category.map((c) => <Line key={c.category} label={`Less: ${c.category}`} value={c.amount_kobo} />)}
            <Line label="Total operating expenses" value={pl.operating_expenses_kobo} bold />
            <Line label={loss ? "Net loss" : "Net profit"} value={pl.net_profit_kobo} bold color={loss ? C.danger : C.success} />
          </Card>
          {pl.cogs_unpriced_movements > 0 && (
            <Card title="Cost missing">
              <Text style={u.rowMeta}>
                {pl.cogs_unpriced_movements} stock sale{pl.cogs_unpriced_movements === 1 ? " has" : "s have"} no recorded cost, so cost of goods sold is understated and gross profit overstated. Record purchase costs for those items.
              </Text>
            </Card>
          )}
          {(pl.invoice_stock_lines_without_cost ?? 0) > 0 && (
            <Card title="Invoices and stock">
              <Text style={u.rowMeta}>
                {pl.invoice_stock_lines_without_cost} stock-item invoice line{pl.invoice_stock_lines_without_cost === 1 ? "" : "s"} do not move stock, so no cost of goods sold is recorded for them.
              </Text>
            </Card>
          )}
          <Text style={[u.rowMeta, { marginBottom: 12 }]}>
            Cost of goods sold is the weighted-average purchase cost of stock actually sold, less stock returned. Nothing is estimated.
          </Text>
        </>
      )}
    </>
  );
}
