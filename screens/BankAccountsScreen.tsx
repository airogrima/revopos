/** Bank accounts: the accounts customers pay into, and what has moved through them. */
import { Text, View } from "react-native";
import { formatNaira } from "@revopass/core";
import { useOrgData } from "../lib/org";
import { C } from "../theme";
import BankAccountsCard from "../components/BankAccountsCard";
import { Card, EmptyState, ErrorView, Loading, Screen, ScreenTitle, u } from "../components/ui";

interface Bal { id: string; label: string | null; bank_name: string; account_number: string; currency: string; opening_balance_kobo: number; balance_kobo: number; received_kobo: number; paid_out_kobo: number; is_active: boolean }

export default function BankAccountsScreen() {
  const { loading, refreshing, error, data, reload, onRefresh } = useOrgData<Bal[]>(async (supabase, org) => {
    const [a, b] = await Promise.all([
      supabase.from("org_bank_accounts").select("id,label,bank_name,account_number,currency,opening_balance_kobo,is_active").eq("org_id", org).order("is_primary", { ascending: false }),
      supabase.from("org_bank_account_balances").select("id,balance_kobo,received_kobo,paid_out_kobo").eq("org_id", org),
    ]);
    if (a.error) throw new Error(a.error.message);
    const bal = new Map(((b.data ?? []) as { id: string; balance_kobo: number; received_kobo: number; paid_out_kobo: number }[]).map((x) => [x.id, x]));
    return ((a.data ?? []) as Omit<Bal, "balance_kobo" | "received_kobo" | "paid_out_kobo">[]).map((x) => ({
      ...x, balance_kobo: Number(bal.get(x.id)?.balance_kobo ?? x.opening_balance_kobo),
      received_kobo: Number(bal.get(x.id)?.received_kobo ?? 0), paid_out_kobo: Number(bal.get(x.id)?.paid_out_kobo ?? 0),
    }));
  });
  if (loading) return <Loading label="Loading bank accounts…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  const rows = data ?? [];

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Bank accounts" subtitle="The accounts your customers pay into." />
      <BankAccountsCard />
      <Card title="Tracked balances" subtitle="Opening balance, plus payments received into the account, less payments paid out.">
        {rows.length === 0 ? (
          <EmptyState title="No bank accounts yet" body="Add the account customers pay into. It is printed on your invoices and can be chosen on payments." />
        ) : rows.map((r, i) => (
          <View key={r.id} style={[{ paddingVertical: 10 }, i > 0 && { borderTopWidth: 1, borderTopColor: C.border2 }]}>
            <Text style={u.rowTitle}>{r.label || r.bank_name} · {r.account_number}</Text>
            <Text style={u.rowMeta}>Received {formatNaira(r.received_kobo)} · Paid out {formatNaira(r.paid_out_kobo)}</Text>
            <Text style={[u.rowTitle, { marginTop: 2 }]}>{formatNaira(r.balance_kobo)} {r.currency !== "NGN" ? r.currency : ""}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
