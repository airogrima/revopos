/**
 * Payments, Budgets, Items & Services, Bank Accounts and Estimates.
 *
 * Grouped in one file because each is a single list over one table with no
 * screen-specific logic worth isolating. They share the loader below rather
 * than repeating the same loading / error / empty / pull-to-refresh dance five
 * times — that repetition is how screens quietly drift apart.
 *
 * Every one of them is read-only. Creating any of these records is a web-app
 * job today, and each screen says so rather than offering a button that does
 * nothing.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira, getClient, isAuthFailure, signOut } from "../lib/supabase";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { useOrgData, type DataState } from "../lib/org";
import { C } from "../theme";
import { Avatar, FilterChips, Icon, ListCard, RoundAddButton, SearchField } from "../components/kit";
import {
  ActionButton, Card, EmptyState, ErrorView, Loading, Screen, ScreenTitle, Tile, TileGrid, u,
} from "../components/ui";



function ListScreen<T>({
  title, subtitle, state, header, empty, children, note, action, cards,
}: {
  title: string; subtitle?: string;
  state: DataState<T>;
  header?: ReactNode; empty: { title: string; body: string };
  children: (data: T) => ReactNode; note?: string;
  /** Rendered under the title — the one thing this screen is for. */
  action?: ReactNode;
  /** Rows draw their own cards, so no outer white card is wrapped around them. */
  cards?: boolean;
}) {
  if (state.loading) return <Loading label={`Loading ${title.toLowerCase()}…`} />;
  if (state.error) return <ErrorView message={state.error} onRetry={state.reload} />;

  const rows = state.data;
  const isEmpty = !rows || (Array.isArray(rows) && rows.length === 0);

  return (
    <Screen
      refreshing={state.refreshing}
      onRefresh={state.onRefresh}
    >
      <ScreenTitle title={title} subtitle={subtitle} />
      {action}
      {header}
      {cards && !isEmpty ? children(rows as T) : (
        <Card>
          {isEmpty ? <EmptyState title={empty.title} body={empty.body} /> : children(rows as T)}
        </Card>
      )}
      {note ? (
        <Text style={[u.rowMeta, { textAlign: "center", marginBottom: 10, lineHeight: 18 }]}>
          {note}
        </Text>
      ) : null}
      <Text style={u.footer}>© 2026 Revo Space Enterprise Ltd.</Text>
    </Screen>
  );
}

const row = (i: number) => [u.listRow, i === 0 ? { borderTopWidth: 0, marginTop: 0 } : null];

/* ------------------------------------------------------------------ Payments */

interface Payment {
  id: string; paid_on: string; amount_kobo: number; fees_kobo: number;
  method: string | null; direction: string; reference: string | null;
  customers: { name: string } | null;
}

export function PaymentsScreen() {
  const state = useOrgData<Payment[]>(async (supabase, orgId) => {
    const { data, error } = await supabase
      .from("payments")
      .select("id,paid_on,amount_kobo,fees_kobo,method,direction,reference,customers(name)")
      .eq("org_id", orgId)
      .order("paid_on", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Payment[];
  });

  const rows = state.data ?? [];
  const inbound = rows.filter((r) => r.direction === "inbound");
  const received = inbound.reduce((a, r) => a + r.amount_kobo, 0);
  const fees = rows.reduce((a, r) => a + (r.fees_kobo ?? 0), 0);

  return (
    <ListScreen
      title="Payments"
      subtitle={`${rows.length} payment${rows.length === 1 ? "" : "s"}`}
      state={state}
      header={
        <TileGrid>
          <Tile label="Received" value={formatNaira(received)} color={C.success} />
          <Tile label="Fees paid" value={formatNaira(fees)} />
        </TileGrid>
      }
      empty={{
        title: "No payments yet",
        body: "Payments recorded against your invoices appear here, newest first.",
      }}
      note="Record a payment from the invoice itself."
      cards
    >
      {(list) => (list as Payment[]).map((p) => (
        <ListCard key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar name={p.customers?.name ?? p.reference ?? "Payment"} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={u.rowTitle} numberOfLines={1}>
              {p.customers?.name ?? p.reference ?? "Payment"}
            </Text>
            <Text style={u.rowMeta}>
              {p.paid_on}{p.method ? ` · ${p.method}` : ""}
              {p.fees_kobo > 0 ? ` · ${formatNaira(p.fees_kobo)} fees` : ""}
            </Text>
          </View>
          <Text style={[u.rowAmount, {
            color: p.direction === "inbound" ? C.success : C.expense,
          }]}>
            {p.direction === "inbound" ? "+" : "−"}{formatNaira(p.amount_kobo)}
          </Text>
        </ListCard>
      ))}
    </ListScreen>
  );
}

/* ------------------------------------------------------------------- Budgets */

interface Budget {
  id: string; period: string; amount_kobo: number;
  start_date: string; end_date: string | null; is_active: boolean;
  categories: { name: string; color: string } | null;
}

export function BudgetsScreen() {
  const state = useOrgData<Budget[]>(async (supabase, orgId) => {
    const { data, error } = await supabase
      .from("budgets")
      .select("id,period,amount_kobo,start_date,end_date,is_active,categories(name,color)")
      .eq("org_id", orgId)
      .order("amount_kobo", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Budget[];
  });

  const rows = state.data ?? [];
  const active = rows.filter((b) => b.is_active);
  const budgeted = active.reduce((a, b) => a + b.amount_kobo, 0);

  return (
    <ListScreen
      title="Budgets"
      subtitle={`${active.length} active`}
      state={state}
      header={
        <TileGrid>
          <Tile label="Budgeted" value={formatNaira(budgeted)} dark />
          <Tile label="Categories" value={String(active.length)} />
        </TileGrid>
      }
      empty={{
        title: "No budgets set",
        body: "Budgets you set per category appear here with what you planned to spend.",
      }}
      note="Setting a budget is done on the web app. Spend against each budget is not tracked on this screen yet."
    >
      {(list) => (list as Budget[]).map((b, i) => (
        <View key={b.id} style={row(i)}>
          <View style={{ flex: 1 }}>
            <Text style={u.rowTitle}>{b.categories?.name ?? "Uncategorised"}</Text>
            <Text style={u.rowMeta}>
              {b.period}{b.is_active ? "" : " · inactive"} · from {b.start_date}
            </Text>
          </View>
          <Text style={[u.rowAmount, !b.is_active ? { color: C.text3 } : null]}>
            {formatNaira(b.amount_kobo)}
          </Text>
        </View>
      ))}
    </ListScreen>
  );
}

/* --------------------------------------------------------- Items & Services */

interface Item {
  id: string; name: string; sku: string | null; unit: string | null;
  unit_price_kobo: number; is_archived: boolean; description: string | null;
  stock?: { qty: number; reorder: number | null } | null;
}

export function ItemsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "in" | "low" | "out">("all");
  const state = useOrgData<Item[]>(async (supabase, orgId) => {
    const [i, lv] = await Promise.all([
      supabase.from("items")
        .select("id,name,sku,unit,unit_price_kobo,is_archived,description")
        .eq("org_id", orgId).order("name"),
      // Quantities come from the same view the POS and Stock screens read. Fails soft: no stock line is shown.
      supabase.from("item_stock_levels").select("item_id,quantity_on_hand,reorder_level").eq("org_id", orgId),
    ]);
    if (i.error) throw new Error(i.error.message);
    const level = new Map(((lv.data ?? []) as { item_id: string; quantity_on_hand: number; reorder_level: number | null }[])
      .map((r) => [r.item_id, { qty: Number(r.quantity_on_hand), reorder: r.reorder_level == null ? null : Number(r.reorder_level) }]));
    return ((i.data ?? []) as Item[]).map((it) => ({ ...it, stock: level.get(it.id) ?? null }));
  });

  const rows = state.data ?? [];
  const stockState = (it: Item): "none" | "in" | "low" | "out" =>
    !it.stock ? "none" : it.stock.qty <= 0 ? "out" : it.stock.reorder != null && it.stock.qty <= it.stock.reorder ? "low" : "in";
  const q = query.trim().toLowerCase();
  const shown = rows.filter((it) =>
    (filter === "all" || (filter === "in" ? ["in", "low"].includes(stockState(it)) : stockState(it) === filter)) &&
    (q === "" || it.name.toLowerCase().includes(q) || (it.sku ?? "").toLowerCase().includes(q)));

  /*
   * Deleting a catalogue item is safe in a way deleting a customer is not.
   * document_lines.item_id is ON DELETE SET NULL and each line already carries
   * its own description and unit price, so no historical invoice can be altered
   * or broken — the line simply stops pointing at a catalogue entry. Hence no
   * has-history refusal here, unlike CustomersScreen.
   *
   * Archive is the other case: an item still worth keeping on old documents that
   * should stop appearing in the invoice picker, which reads is_archived = false.
   */
  const archive = async (it: Item) => {
    setBusyId(it.id);
    try {
      const supabase = await getClient();
      const { error } = await supabase
        .from("items").update({ is_archived: true }).eq("id", it.id);
      if (error) throw new Error(error.message);
      state.reload();
    } catch (e) {
      if (isAuthFailure(e)) { void signOut(); return; }
      Alert.alert("Could not archive", e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (it: Item) => {
    setBusyId(it.id);
    try {
      const supabase = await getClient();
      const { error } = await supabase.from("items").delete().eq("id", it.id);
      if (error) throw new Error(error.message);
      state.reload();
    } catch (e) {
      if (isAuthFailure(e)) { void signOut(); return; }
      Alert.alert("Could not delete", e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = (it: Item) => {
    Alert.alert(
      `Delete ${it.name}?`,
      "This cannot be undone. Invoices that already use it keep their own "
        + "description and price, so none of them change.",
      [
        { text: "Cancel", style: "cancel" },
        ...(it.is_archived ? [] : [{ text: "Archive instead", onPress: () => void archive(it) }]),
        { text: "Delete", style: "destructive" as const, onPress: () => void remove(it) },
      ],
    );
  };

  if (state.loading) return <Loading label="Loading products…" />;
  if (state.error) return <ErrorView message={state.error} onRetry={state.reload} />;

  return (
    <Screen refreshing={state.refreshing} onRefresh={state.onRefresh}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <View>
          <Text style={u.title}>Products / Services</Text>
          <Text style={u.subtitle}>{rows.length} in your catalogue</Text>
        </View>
        <RoundAddButton label="New item or service" onPress={() => nav.navigate("AddItem")} />
      </View>
      <SearchField value={query} onChange={setQuery} placeholder="Search products…" />
      <FilterChips value={filter} onChange={setFilter} options={[
        { value: "all", label: "All" }, { value: "in", label: "In Stock" },
        { value: "low", label: "Low Stock" }, { value: "out", label: "Out of Stock" },
      ]} />
      {shown.length === 0 ? (
        <ListCard>
          <EmptyState
            title={rows.length === 0 ? "Nothing in your catalogue" : "No matching products"}
            body={rows.length === 0 ? "Items and services you save for reuse on invoices appear here." : "Try a different search or filter."}
          />
        </ListCard>
      ) : shown.map((it) => {
        const st = stockState(it);
        return (
          <ListCard key={it.id}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: C.forestSoft, alignItems: "center", justifyContent: "center" }}>
                <Icon name="box" size={22} color={C.forest} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={u.rowTitle} numberOfLines={1}>{it.name}{it.is_archived ? " · archived" : ""}</Text>
                <Text style={u.rowMeta} numberOfLines={1}>
                  {[it.sku, it.unit, it.description].filter(Boolean).join(" · ") || "No details"}
                </Text>
                {it.stock ? (
                  <View style={{ alignSelf: "flex-start", marginTop: 5, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3,
                                 backgroundColor: st === "out" ? "#FEE4E2" : st === "low" ? "#FEF0C7" : "#DCF5E7" }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: st === "out" ? "#B42318" : st === "low" ? "#B54708" : "#067647" }}>
                      {st === "out" ? "Out of stock" : st === "low" ? `Low · ${it.stock.qty} left` : `Stock: ${it.stock.qty}`}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={{ alignItems: "flex-end", gap: 6 }}>
                <Text style={[u.rowAmount, it.is_archived ? { color: C.text3 } : null]}>{formatNaira(it.unit_price_kobo)}</Text>
                <Pressable
                  onPress={() => confirmDelete(it)}
                  disabled={busyId !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${it.name}`}
                  hitSlop={10}
                  style={({ pressed }) => [itemStyles.delete, pressed && { opacity: 0.6 }]}
                >
                  <Text style={itemStyles.deleteText}>{busyId === it.id ? "…" : "Delete"}</Text>
                </Pressable>
              </View>
            </View>
          </ListCard>
        );
      })}
      <Text style={u.footer}>© 2026 Revo Space Enterprise Ltd.</Text>
    </Screen>
  );
}

/* ------------------------------------------------------------- Bank Accounts */

interface BankAccount {
  id: string; institution: string | null; account_name: string | null;
  account_number_masked: string | null; account_type: string | null;
  balance_kobo: number | null; balance_as_of: string | null;
  is_primary: boolean; is_archived: boolean;
}

export function BankScreen() {
  const state = useOrgData<BankAccount[]>(async (supabase, orgId) => {
    const { data, error } = await supabase
      .from("bank_accounts")
      .select("id,institution,account_name,account_number_masked,account_type,balance_kobo,balance_as_of,is_primary,is_archived")
      .eq("org_id", orgId)
      .order("is_primary", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as BankAccount[];
  });

  const rows = state.data ?? [];
  const total = rows.reduce((a, b) => a + (b.balance_kobo ?? 0), 0);

  return (
    <ListScreen
      title="Bank Accounts"
      subtitle={`${rows.length} account${rows.length === 1 ? "" : "s"}`}
      state={state}
      header={<TileGrid><Tile label="Total balance" value={formatNaira(total)} dark /></TileGrid>}
      empty={{
        title: "No accounts connected",
        body: "Bank accounts you connect appear here with their balances.",
      }}
      note="Automatic transaction imports are not built yet, so no transactions are shown against these accounts."
    >
      {(list) => (list as BankAccount[]).map((b, i) => (
        <View key={b.id} style={row(i)}>
          <View style={{ flex: 1 }}>
            <Text style={u.rowTitle} numberOfLines={1}>
              {b.institution ?? "Bank"}{b.is_primary ? " · primary" : ""}
            </Text>
            <Text style={u.rowMeta} numberOfLines={1}>
              {[b.account_name, b.account_number_masked, b.account_type].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={u.rowAmount}>{formatNaira(b.balance_kobo ?? 0)}</Text>
            {b.balance_as_of && (
              <Text style={u.rowMeta}>as at {String(b.balance_as_of).slice(0, 10)}</Text>
            )}
          </View>
        </View>
      ))}
    </ListScreen>
  );
}

/* ----------------------------------------------------------------- Estimates */

interface Estimate {
  id: string; number: string; status: string;
  issue_date: string; expiry_date: string | null; total_kobo: number;
  customers: { name: string } | null;
}

export function EstimatesScreen() {
  const state = useOrgData<Estimate[]>(async (supabase, orgId) => {
    const { data, error } = await supabase
      .from("documents")
      .select("id,number,status,issue_date,expiry_date,total_kobo,customers(name)")
      .eq("org_id", orgId)
      .eq("doc_type", "estimate")
      .order("issue_date", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Estimate[];
  });

  const rows = state.data ?? [];
  const quoted = rows.reduce((a, r) => a + r.total_kobo, 0);

  return (
    <ListScreen
      title="Quotations / Estimates"
      subtitle={`${rows.length} estimate${rows.length === 1 ? "" : "s"}`}
      state={state}
      header={rows.length > 0
        ? <TileGrid><Tile label="Quoted" value={formatNaira(quoted)} dark /></TileGrid>
        : undefined}
      empty={{
        title: "No estimates yet",
        body: "Quotes you send before work starts appear here. You have not created any — estimates are created on the web app.",
      }}
      note="Creating an estimate is done on the web app."
      cards
    >
      {(list) => (list as Estimate[]).map((e) => (
        <ListCard key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar name={e.customers?.name ?? e.number} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={u.rowTitle}>{e.number}</Text>
            <Text style={u.rowMeta} numberOfLines={1}>
              {e.customers?.name ?? "No customer"} · {e.status}
              {e.expiry_date ? ` · expires ${e.expiry_date}` : ""}
            </Text>
          </View>
          <Text style={u.rowAmount}>{formatNaira(e.total_kobo)}</Text>
        </ListCard>
      ))}
    </ListScreen>
  );
}

export const ms = StyleSheet.create({});

const itemStyles = StyleSheet.create({
  delete: { paddingLeft: 14, justifyContent: "center" },
  deleteText: { fontSize: 12.5, fontWeight: "600", color: C.danger },
});
