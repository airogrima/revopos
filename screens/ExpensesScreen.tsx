/**
 * Expenses — where the money went, this month.
 *
 * public.category_breakdown does the aggregation, including the month-on-month
 * delta, so this screen only renders. It is the same RPC the dashboard's
 * spending card and the web report both use.
 *
 * Recording an expense is not built in either app yet, so this is read-only.
 * Said plainly at the bottom rather than left for someone to discover by
 * hunting for a button that does not exist.
 */

import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatNaira, formatCompact, getClient } from "../lib/supabase";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { useOrgData } from "../lib/org";
import { C } from "../theme";
import {
  ActionButton, Card, EmptyState, ErrorView, Loading, Screen, ScreenTitle, u,
} from "../components/ui";

interface Breakdown {
  month_label: string; prev_label: string;
  total_kobo: number; prev_total_kobo: number; delta_pct: number | null;
  transaction_count: number;
  categories: {
    category_id: string; name: string; color: string; color_bg: string;
    amount_kobo: number; transaction_count: number;
    share_pct: number; delta_pct: number | null;
  }[];
}

export default function ExpensesScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { loading, refreshing, error, data: raw, reload, onRefresh } =
    useOrgData<Breakdown | null>(async (supabase, orgId) => {

      const { data: d, error: err } = await supabase.rpc("category_breakdown", {
        target_org: orgId,
        month: new Date().toISOString().slice(0, 10),
      });
      if (err) throw new Error(err.message);
      return d as Breakdown;
    });
  const data = raw;

  if (loading) return <Loading label="Loading expenses…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Expenses" subtitle={data?.month_label ?? ""} />

      <ActionButton label="Record an expense" onPress={() => nav.navigate("AddExpense")} />

      {data && (
        <Card>
          <Text style={s.big}>{formatNaira(data.total_kobo)}</Text>
          <Text style={u.rowMeta}>
            {data.transaction_count} transaction{data.transaction_count === 1 ? "" : "s"}
            {data.delta_pct != null && (
              ` · ${data.delta_pct > 0 ? "+" : ""}${data.delta_pct}% vs ${data.prev_label}`
            )}
          </Text>
        </Card>
      )}

      <Card title="By category">
        {!data || data.categories.length === 0 ? (
          <EmptyState
            title="No expenses this month"
            body="Categorised spending appears here as soon as expenses are recorded."
          />
        ) : (
          data.categories.map((c) => (
            <View key={c.category_id} style={{ marginTop: 14 }}>
              <View style={s.rowBetween}>
                <Text style={u.rowTitle}>{c.name}</Text>
                <Text style={u.rowAmount}>{formatNaira(c.amount_kobo)}</Text>
              </View>
              <Text style={u.rowMeta}>
                {c.share_pct}% of total · {c.transaction_count} transaction
                {c.transaction_count === 1 ? "" : "s"}
                {c.delta_pct != null ? ` · ${c.delta_pct > 0 ? "+" : ""}${c.delta_pct}%` : ""}
              </Text>
              <View style={s.barTrack}>
                <View style={[s.barFill, { width: `${c.share_pct}%`, backgroundColor: c.color }]} />
              </View>
            </View>
          ))
        )}
      </Card>

      <Text style={u.footer}>© 2026 Revo Space Enterprise Ltd.</Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  big: { fontSize: 27, fontWeight: "700", color: C.text, letterSpacing: -0.8, marginBottom: 4 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  barTrack: { height: 7, borderRadius: 99, backgroundColor: C.border2, overflow: "hidden", marginTop: 7 },
  barFill: { height: "100%", borderRadius: 99 },
});
