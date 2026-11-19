/**
 * Reports — the three that answer questions away from a desk.
 *
 * Every figure comes from a Postgres RPC. Nothing is aggregated here: the same
 * functions back the web reports, so the phone and the desktop cannot disagree
 * about what the business earned.
 *
 * Net VAT is output minus input, so a NEGATIVE net means the business is owed
 * money, not that it owes it. The label follows the sign — telling someone to
 * pay FIRS money they are actually owed would be worse than showing nothing.
 */

import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatCompact, formatNaira, getClient } from "../lib/supabase";
import { useOrgData } from "../lib/org";
import { C } from "../theme";
import { FilterChips, StatCard } from "../components/kit";
import ProfitLossView from "./ProfitLossView";
import RangeReport from "./RangeReports";
import { useModules } from "../lib/modules";
import {
  Card, EmptyState, ErrorView, Loading, Screen, ScreenTitle, Tile, TileGrid, u,
} from "../components/ui";

interface Tax {
  from_month: string; to_month: string;
  output_vat_kobo: number; input_vat_kobo: number; net_vat_kobo: number;
  output_wht_kobo: number;
}
interface Aging {
  as_of: string; total_kobo: number;
  current_kobo: number; d1_30_kobo: number; d31_60_kobo: number;
  d61_90_kobo: number; d90_plus_kobo: number;
  customers: { customer_id: string | null; name: string; total_kobo: number; oldest_days: number }[];
}
interface Sales {
  from_month: string; total_kobo: number;
  items: { item_id: string | null; name: string; quantity: number | string;
           revenue_kobo: number; share_pct: number }[];
}

export default function ReportsScreen() {
  /*
   * Three reports in one screen, fetched together.
   *
   * Promise.all rather than three sequential awaits: on a phone connection the
   * difference between one round trip and three is the difference between a
   * screen that appears and one that feels broken.
   */
  const { loading, refreshing, error, data, reload, onRefresh } =
    useOrgData<{ tax: Tax | null; aging: Aging | null; sales: Sales | null }>(
      async (supabase, orgId) => {
        const [t, a, s] = await Promise.all([
          supabase.rpc("tax_summary", { target_org: orgId, months: 12 }),
          supabase.rpc("receivables_aging", { target_org: orgId }),
          supabase.rpc("sales_by_item", { target_org: orgId, months: 12 }),
        ]);
        // Surface a failure rather than rendering three empty reports as if the
        // business genuinely had no tax, no debtors and no sales.
        const failed = [t.error, a.error, s.error].find(Boolean);
        if (failed) throw new Error(failed.message);
        return {
          tax: t.data as Tax | null,
          aging: a.data as Aging | null,
          sales: s.data as Sales | null,
        };
      },
    );

  const { has } = useModules();
  const [view, setView] = useState<"sales" | "tax" | "receivables" | "pl" | "stock" | "purchases" | "expenses" | "contacts">("sales");
  const tax = data?.tax ?? null;
  const aging = data?.aging ?? null;
  const sales = data?.sales ?? null;

  if (loading) return <Loading label="Loading reports…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  const buckets = aging ? [
    { label: "Current", value: aging.current_kobo, color: C.text },
    { label: "1–30 days", value: aging.d1_30_kobo, color: C.text },
    { label: "31–60", value: aging.d31_60_kobo, color: C.warning },
    { label: "61–90", value: aging.d61_90_kobo, color: C.warning },
    { label: "90+", value: aging.d90_plus_kobo, color: C.danger },
  ] : [];

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Reports" subtitle={view === "sales" || view === "tax" || view === "receivables" ? "Trailing 12 months" : "Choose a period"} />
      <FilterChips value={view} onChange={setView} options={[
        { value: "sales", label: "Sales" }, { value: "pl", label: "Profit & Loss" }, { value: "tax", label: "Tax (VAT)" }, { value: "receivables", label: "Receivables" },
        ...(has("inventory") ? [{ value: "stock" as const, label: "Stock" }] : []),
        ...(has("purchases") ? [{ value: "purchases" as const, label: "Purchases" }] : []),
        { value: "expenses", label: "Expenses" }, { value: "contacts", label: "Contacts" },
      ]} />

      {view === "pl" ? <ProfitLossView /> : (view === "stock" || view === "purchases" || view === "expenses" || view === "contacts") ? <RangeReport kind={view} /> : (
      <>
      <View style={s.kpis}>
        {sales && <StatCard icon="chart" tint="#16A34A" label="Total sales" value={formatNaira(sales.total_kobo)} note="before tax" />}
        {aging && <StatCard icon="invoice" tint="#2563EB" label="Total owed" value={formatNaira(aging.total_kobo)} />}
        {tax && <StatCard icon="card" tint="#F59E0B" label="Output VAT" value={formatNaira(tax.output_vat_kobo)} />}
        {tax && <StatCard icon="card" tint="#7C3AED" label="Input VAT" value={formatNaira(tax.input_vat_kobo)} />}
      </View>

      {view === "receivables" && aging && aging.total_kobo > 0 && (
        <Card title="Receivables overview" subtitle={`Unpaid as at ${aging.as_of}`}>
          <View style={s.chart}>
            {buckets.map((b) => {
              const max = Math.max(...buckets.map((x) => x.value), 1);
              return (
                <View key={b.label} style={s.chartCol}>
                  <Text style={s.chartVal} numberOfLines={1}>{b.value > 0 ? formatCompact(b.value) : ""}</Text>
                  <View style={s.chartTrack}>
                    <View style={[s.chartBar, { height: `${Math.max(b.value > 0 ? 6 : 0, (b.value / max) * 100)}%`, backgroundColor: b.color === C.text ? C.forest : b.color }]} />
                  </View>
                  <Text style={s.chartLabel}>{b.label}</Text>
                </View>
              );
            })}
          </View>
        </Card>
      )}

      {view === "tax" && tax && (
        <>
          <Card
            title={tax.net_vat_kobo >= 0 ? "Net VAT payable" : "Net VAT reclaimable"}
            subtitle={`${tax.from_month} – ${tax.to_month}`}
          >
            <Text style={[s.big, {
              color: tax.net_vat_kobo >= 0 ? C.warning : C.success,
            }]}>
              {formatNaira(Math.abs(tax.net_vat_kobo))}
            </Text>
            <Text style={u.rowMeta}>
              {tax.net_vat_kobo >= 0
                ? "Owed to FIRS. VAT is filed monthly, by the 21st of the following month."
                : "Owed to you. VAT is filed monthly, by the 21st of the following month."}
            </Text>
            {tax.output_wht_kobo > 0 && (
              <View style={u.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={u.rowTitle}>WHT withheld by customers</Text>
                  <Text style={u.rowMeta}>A credit against income tax, not VAT</Text>
                </View>
                <Text style={u.rowAmount}>{formatNaira(tax.output_wht_kobo)}</Text>
              </View>
            )}
          </Card>
        </>
      )}

      {view === "receivables" && aging && (
        <Card title="Receivables aging" subtitle={`Unpaid as at ${aging.as_of}`}>
          {aging.total_kobo === 0 ? (
            <EmptyState title="Nothing outstanding"
                        body="Every invoice you have sent has been paid in full." />
          ) : (
            <>
              {buckets.map((b, i) => (
                <View key={b.label} style={[u.listRow, i === 0 ? { borderTopWidth: 0, marginTop: 4 } : null]}>
                  <Text style={[u.rowTitle, { flex: 1 }]}>{b.label}</Text>
                  <Text style={[u.rowAmount, b.value > 0 ? { color: b.color } : { color: C.text3 }]}>
                    {formatNaira(b.value)}
                  </Text>
                </View>
              ))}
              <View style={[u.listRow, { borderTopColor: C.text3 }]}>
                <Text style={[u.rowTitle, { flex: 1, fontWeight: "700" }]}>Total owed</Text>
                <Text style={[u.rowAmount, { fontWeight: "700" }]}>{formatNaira(aging.total_kobo)}</Text>
              </View>
              {aging.customers.slice(0, 5).map((c) => (
                <View key={c.customer_id ?? c.name} style={u.listRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={u.rowTitle} numberOfLines={1}>{c.name}</Text>
                    <Text style={u.rowMeta}>
                      {c.oldest_days > 0 ? `oldest ${c.oldest_days} days past due` : "nothing past due"}
                    </Text>
                  </View>
                  <Text style={u.rowAmount}>{formatNaira(c.total_kobo)}</Text>
                </View>
              ))}
            </>
          )}
        </Card>
      )}

      {view === "sales" && sales && (
        <Card title="Top products" subtitle={`Revenue before tax · since ${sales.from_month}`}>
          {sales.items.length === 0 ? (
            <EmptyState
              title="No line items yet"
              body="This ranks what you sell by revenue. Your invoices have no line items recorded against them yet, so there is nothing to rank."
            />
          ) : (
            sales.items.map((it, i) => (
              <View key={it.item_id ?? it.name} style={[u.listRow, i === 0 ? { borderTopWidth: 0, marginTop: 4 } : null]}>
                <View style={{ flex: 1 }}>
                  <Text style={u.rowTitle} numberOfLines={1}>{it.name}</Text>
                  <Text style={u.rowMeta}>
                    {Number(it.quantity).toLocaleString("en-NG", { maximumFractionDigits: 2 })} sold · {it.share_pct}%
                  </Text>
                  <View style={s.track}><View style={[s.fill, { width: `${Math.max(2, Math.min(100, Number(it.share_pct)))}%` }]} /></View>
                </View>
                <Text style={u.rowAmount}>{formatNaira(it.revenue_kobo)}</Text>
              </View>
            ))
          )}
        </Card>
      )}

      <Text style={u.footer}>© 2026 Revo Space Enterprise Ltd.</Text>
      </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  chart: { flexDirection: "row", gap: 8, height: 150, marginTop: 12, alignItems: "flex-end" },
  chartCol: { flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end" },
  chartTrack: { flex: 1, width: "100%", justifyContent: "flex-end", alignItems: "center", marginVertical: 4 },
  chartBar: { width: "62%", borderRadius: 8 },
  chartVal: { fontSize: 10.5, color: C.text2, fontWeight: "600" },
  chartLabel: { fontSize: 10.5, color: C.text2 },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  track: { height: 6, borderRadius: 3, backgroundColor: C.border2, overflow: "hidden", marginTop: 6 },
  fill: { height: 6, borderRadius: 3, backgroundColor: C.forest },
  big: { fontSize: 27, fontWeight: "700", letterSpacing: -0.8, marginTop: 8, marginBottom: 4 },
});
