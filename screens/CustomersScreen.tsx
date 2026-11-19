/**
 * Contacts (customers) — balances and payment history.
 *
 * Straight from public.customer_balances, the same RPC the web page uses. The
 * open balance, overdue portion and lifetime paid are all aggregated in
 * Postgres; nothing is summed here.
 */

import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { formatNaira, getClient, isAuthFailure, signOut } from "../lib/supabase";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { useOrgData } from "../lib/org";
import { C } from "../theme";
import { AppHeader, Avatar, ListCard, RoundAddButton, SearchField } from "../components/kit";
import {
  EmptyState, ErrorView, Loading, Screen, u,
} from "../components/ui";

interface CustomerRow {
  id: string; name: string; email: string | null; phone: string | null;
  balance_kobo: number; overdue_kobo: number; open_invoices: number;
  lifetime_kobo: number; last_paid_on: string | null;
}

export default function CustomersScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { loading, refreshing, error, data: raw, reload, onRefresh } =
    useOrgData<CustomerRow[]>(async (supabase, orgId) => {

      const { data, error: err } = await supabase.rpc("customer_balances", { target_org: orgId });
      if (err) throw new Error(err.message);
      return (data ?? []) as CustomerRow[];
    });
  const rows = raw ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  /*
   * Removing a customer, in the two forms the database allows.
   *
   * documents.customer_id is ON DELETE RESTRICT, so a customer who has ever
   * been invoiced cannot be deleted — an invoice with nobody attached to it is
   * not a record anyone can use. The count is read first so that case is
   * explained and offered the archive, instead of surfacing a foreign-key
   * error. Archiving is not a soft delete dressed up: `customer_balances`
   * filters `is_archived = false`, so they genuinely leave every list here and
   * on the web while their documents keep their history.
   *
   * Both confirmations go through Alert rather than an in-row tap. Deletion
   * cannot be undone, and a list row is an easy thing to hit by accident.
   */
  const archive = async (row: CustomerRow) => {
    setBusyId(row.id);
    try {
      const supabase = await getClient();
      const { error: err } = await supabase
        .from("customers").update({ is_archived: true }).eq("id", row.id);
      if (err) throw new Error(err.message);
      reload();
    } catch (e) {
      if (isAuthFailure(e)) { void signOut(); return; }
      Alert.alert("Could not archive", e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const runDelete = async (row: CustomerRow) => {
    setBusyId(row.id);
    try {
      const supabase = await getClient();

      const { count, error: countError } = await supabase
        .from("documents").select("id", { count: "exact", head: true })
        .eq("customer_id", row.id);
      if (countError) throw new Error(countError.message);

      const documents = count ?? 0;
      if (documents > 0) {
        Alert.alert(
          `${row.name} has history`,
          `They are on ${documents} ${documents === 1 ? "invoice or estimate" : "invoices and estimates"}, ` +
            "so deleting them would break those records. Archiving takes them off " +
            "your list and keeps the documents intact.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Archive", onPress: () => void archive(row) },
          ],
        );
        return;
      }

      const { error: err } = await supabase.from("customers").delete().eq("id", row.id);
      if (err) throw new Error(err.message);
      reload();
    } catch (e) {
      if (isAuthFailure(e)) { void signOut(); return; }
      Alert.alert("Could not delete", e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = (row: CustomerRow) => {
    Alert.alert(
      `Delete ${row.name}?`,
      "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void runDelete(row) },
      ],
    );
  };

  if (loading) return <Loading label="Loading customers…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  const owed = rows.reduce((a, r) => a + r.balance_kobo, 0);
  const lifetime = rows.reduce((a, r) => a + r.lifetime_kobo, 0);

  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => q === "" || r.name.toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q) || (r.phone ?? "").includes(q));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <AppHeader title="Contacts" subtitle={`${rows.length} contact${rows.length === 1 ? "" : "s"}`}
               right={<RoundAddButton label="New customer" onPress={() => nav.navigate("AddCustomer")} />} />
    <Screen refreshing={refreshing} onRefresh={onRefresh} topPad={false}>
      <SearchField value={query} onChange={setQuery} placeholder="Search contacts…" />

      <View style={s.summary}>
        <View style={s.sumCell}>
          <Text style={s.sumLabel}>Currently owed</Text>
          <Text style={[s.sumValue, owed > 0 && { color: C.danger }]} numberOfLines={1} adjustsFontSizeToFit>{formatNaira(owed)}</Text>
        </View>
        <View style={s.sumCell}>
          <Text style={s.sumLabel}>Paid all time</Text>
          <Text style={s.sumValue} numberOfLines={1} adjustsFontSizeToFit>{formatNaira(lifetime)}</Text>
        </View>
      </View>

      {shown.length === 0 ? (
        <ListCard>
          <EmptyState title={rows.length === 0 ? "No contacts yet" : "No matching contacts"}
                      body={rows.length === 0 ? "Contacts you add appear here with what they owe and what they have paid." : "Try a different search."} />
        </ListCard>
      ) : (
        shown.map((r) => (
          <ListCard key={r.id}>
            <View style={s.row}>
              <Avatar name={r.name} size={42} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={u.rowTitle} numberOfLines={1}>{r.name}</Text>
                <Text style={u.rowMeta} numberOfLines={1}>
                  {r.open_invoices > 0
                    ? `${r.open_invoices} open invoice${r.open_invoices === 1 ? "" : "s"}`
                    : "Nothing outstanding"}
                  {r.last_paid_on ? ` · last paid ${r.last_paid_on}` : ""}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[u.rowAmount, r.balance_kobo > 0 ? { color: C.danger } : null]}>
                  {formatNaira(r.balance_kobo)}
                </Text>
                {r.overdue_kobo > 0 && (
                  <Text style={[u.rowMeta, { color: C.danger }]}>
                    {formatNaira(r.overdue_kobo)} overdue
                  </Text>
                )}
                <Pressable
                  onPress={() => confirmDelete(r)}
                  disabled={busyId !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${r.name}`}
                  hitSlop={10}
                  style={({ pressed }) => [s.delete, pressed && { opacity: 0.6 }]}
                >
                  <Text style={s.deleteText}>{busyId === r.id ? "…" : "Delete"}</Text>
                </Pressable>
              </View>
            </View>
          </ListCard>
        ))
      )}

      <Text style={u.footer}>© 2026 Revo Space Enterprise Ltd.</Text>
    </Screen>
    </View>
  );
}

const s = StyleSheet.create({
  summary: { flexDirection: "row", gap: 8, marginVertical: 14 },
  sumCell: { flex: 1, backgroundColor: "#fff", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border2 },
  sumLabel: { fontSize: 11.5, color: C.text2 },
  sumValue: { fontSize: 16, fontWeight: "700", color: C.text, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  delete: { paddingTop: 4, justifyContent: "center" },
  deleteText: { fontSize: 12.5, fontWeight: "600", color: C.danger },
});
