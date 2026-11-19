/**
 * "More" — the overflow for everything the tab bar cannot hold.
 *
 * The web sidebar has fourteen destinations. A phone tab bar holds four before
 * the labels start truncating, so the rest live here as a list.
 *
 * Entries that are not built are marked and still navigable, landing on a
 * placeholder that explains itself. The alternative — hiding them until they
 * exist — makes the app look like it does less than it does, and makes the
 * roadmap invisible. What it must never do is present them as working.
 */

import { Alert, Pressable, Text, View, StyleSheet } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { C } from "../theme";
import { Screen, u } from "../components/ui";
import { Icon, ListCard } from "../components/kit";
import { useOrg } from "../lib/org";
import { usePermissions } from "../lib/perms";
import type { MoreStackParamList } from "../navigation";
import { useModules } from "../lib/modules";

interface Entry {
  /** A More-stack route, a bottom tab, or null for a module that is not built. */
  route?: keyof MoreStackParamList;
  tab?: "Home" | "Invoices" | "Contacts";
  label: string;
  meta: string;
  ready: boolean;
  /** Shown only when this module is on for the business. */
  module?: string;
  /** Shown only to people holding at least one of these permissions. */
  perms?: string[];
  icon: string;
  tint: string;
}

interface Section { title: string; entries: Entry[] }

/**
 * The same grouping as the web sidebar. Invoices, Contacts and Create live in
 * the tab bar, so here they are shortcuts rather than duplicates of a screen.
 */
const SECTIONS: Section[] = [
  {
    title: "Sales & Inventory",
    entries: [
      { route: "Pos", label: "POS Sales", meta: "Sell items at the counter", ready: true, module: "pos", icon: "cart", tint: "#16A34A" },
      { tab: "Invoices", label: "Invoices", meta: "Create and manage invoices", ready: true, icon: "invoice", tint: "#2563EB" },
      { route: "Items", label: "Products / Services", meta: "Manage your items", ready: true, icon: "box", tint: "#16A34A" },
      { route: "Stock", label: "Stock Manager", meta: "Branch stock and movements", ready: true, module: "inventory", perms: ["stock.view"], icon: "layers", tint: "#2563EB" },
      { route: "Purchases", label: "Purchases", meta: "Supplier bills and what you owe", ready: true, module: "purchases", icon: "invoice", tint: "#0EA5E9" },
      { route: "Production", label: "Production", meta: "Track production", ready: true, module: "production", icon: "clipboard", tint: "#6366F1" },
      { route: "Estimates", label: "Quotations / Estimates", meta: "Quotes sent before work starts", ready: true, module: "invoices", icon: "tag", tint: "#F59E0B" },
    ],
  },
  {
    title: "Accounting",
    entries: [
      { route: "Expenses", label: "Expenses", meta: "Track business expenses", ready: true, module: "accounting", icon: "card", tint: "#F97316" },
      { route: "Receipts", label: "Receipts", meta: "Review scanned receipts", ready: true, module: "accounting", icon: "invoice", tint: "#0EA5E9" },
      { route: "Reports", label: "Reports", meta: "View business reports", ready: true, module: "reports", icon: "chart", tint: "#7C3AED" },
      { route: "Payments", label: "Payments", meta: "Money received", ready: true, module: "invoices", icon: "dollar", tint: "#16A34A" },
      { route: "BankAccounts", label: "Bank Accounts", meta: "Accounts customers pay into", ready: true, module: "accounting", icon: "bank", tint: "#2563EB" },
      { route: "Budgets", label: "Budgets", meta: "Planned against actual spend", ready: true, module: "accounting", icon: "trend", tint: "#EC4899" },
    ],
  },
  {
    title: "CRM & Marketing",
    entries: [
      { tab: "Contacts", label: "Contacts", meta: "Who owes you, and what they have paid", ready: true, icon: "users", tint: "#7C3AED" },
    ],
  },
  {
    title: "Operations",
    entries: [
      { route: "Hrm", label: "HRM", meta: "Staff, attendance and leave", ready: true, module: "hrm", icon: "briefcase", tint: "#0EA5E9" },
      { route: "Tasks", label: "To-Do List", meta: "Your tasks", ready: true, module: "tasks", icon: "check", tint: "#16A34A" },
      { route: "Restaurant", label: "Restaurant", meta: "Open orders and kitchen status", ready: true, module: "restaurant", perms: ["orders.create", "kitchen.view", "orders.close_bill"], icon: "cart", tint: "#F97316" },
      { route: "Hotel", label: "Hotel", meta: "Rooms, arrivals and housekeeping", ready: true, module: "hotel", perms: ["hotel.reservations", "hotel.checkin", "hotel.housekeeping", "hotel.view"], icon: "home", tint: "#2563EB" },
      { route: "Pharmacy", label: "Pharmacy", meta: "Batches and expiry dates", ready: true, module: "pharmacy", perms: ["pharmacy.view_batch", "pharmacy.sell", "stock.view"], icon: "box", tint: "#16A34A" },
      { route: "Fashion", label: "Fashion orders", meta: "Order and production status", ready: true, module: "fashion", perms: ["fashion.manage", "pos.view"], icon: "tag", tint: "#EC4899" },
      { route: "Electronics", label: "Warranty lookup", meta: "Serial number or IMEI", ready: true, module: "electronics", perms: ["stock.view", "pos.view", "serials.manage"], icon: "search", tint: "#6366F1" },
      { route: "Construction", label: "Projects", meta: "Job costing and profit", ready: true, module: "construction", perms: ["projects.manage"], icon: "layers", tint: "#F59E0B" },
      { route: "StockAlerts", label: "Stock alerts", meta: "Low stock and expiring batches", ready: true, module: "inventory", perms: ["stock.view"], icon: "bell", tint: "#EF4444" },
    ],
  },
  {
    title: "System",
    entries: [
      { route: "Settings", label: "Settings", meta: "Business profile, tax and bank accounts", ready: true, icon: "sliders", tint: "#475467" },
      { route: "Modules", label: "Industry & Modules", meta: "Switch modules on or off, and pay for add-ons", ready: true, icon: "layers", tint: "#7C3AED" },
      { route: "Pricing", label: "Your plan", meta: "Your subscription", ready: true, icon: "gift", tint: "#16A34A" },
      { route: "Help", label: "Help & Support", meta: "Contact us, and app details", ready: true, icon: "help", tint: "#2563EB" },
    ],
  },
];

export default function MoreScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const { has, can, loading, mods } = useModules();
  const lockedKeys = new Set(mods.locked.map((l) => l.key));
  // Until the module list arrives, show the general menu rather than a blank screen.
  const INDUSTRY = ["restaurant", "hotel", "pharmacy", "fashion", "electronics", "construction"];
  const visible = (e: Entry) => (loading ? !(e.module && INDUSTRY.includes(e.module)) : ((!e.module || has(e.module) || lockedKeys.has(e.module)) && (!e.perms || can(...e.perms))));
  const isLocked = (e: Entry) => !!e.module && lockedKeys.has(e.module);

  const open = (e: Entry) => {
    if (isLocked(e)) {
      Alert.alert("Not in your plan", `${e.label} is not included in your current subscription. Your data is kept.`, [
        { text: "OK", style: "cancel" },
        { text: "Your plan", onPress: () => nav.navigate("Pricing") },
      ]);
      return;
    }
    if (e.route) (nav.navigate as unknown as (r: string) => void)(e.route);
    // The tabs are siblings of this stack's parent, so go up one level.
    else if (e.tab) (nav.getParent() as { navigate: (n: string) => void } | undefined)?.navigate(e.tab);
  };

  const { orgName } = useOrg();
  const { perms } = usePermissions();
  const roleLabel = perms.role ? perms.role.charAt(0).toUpperCase() + perms.role.slice(1).replace(/_/g, " ") : null;

  return (
    <Screen>
      <Text style={m.pageTitle}>More</Text>

      <ListCard style={m.bizCard} onPress={() => nav.navigate("Settings")}>
        <View style={m.bizIcon}><Icon name="home" size={26} color={C.forest} /></View>
        <View style={{ flex: 1 }}>
          <Text style={m.bizName} numberOfLines={1}>{orgName}</Text>
          {roleLabel ? <Text style={m.bizMeta}>{roleLabel}</Text> : null}
        </View>
        <Icon name="right" size={18} color={C.text3} />
      </ListCard>

      {SECTIONS.map((sec) => ({ ...sec, entries: sec.entries.filter(visible) })).filter((sec) => sec.entries.length > 0).map((sec) => (
        <View key={sec.title}>
          <Text style={m.section}>{sec.title}</Text>
          {sec.entries.map((e) => (
            /*
             * `ready: false` is a real lock, not decoration: disabled, and the
             * module has no route registered, so it cannot be reached by
             * navigate() either. Locked-by-plan entries stay visible, show
             * "Upgrade required" and a lock, and open the explanation instead.
             */
            <Pressable
              key={e.label}
              disabled={!e.ready}
              accessibilityState={{ disabled: !e.ready }}
              onPress={() => open(e)}
              style={({ pressed }) => [m.row, pressed && e.ready ? { opacity: 0.6 } : null, !e.ready || isLocked(e) ? { opacity: 0.6 } : null]}
            >
              <View style={[m.rowIcon, { backgroundColor: e.tint + "22" }]}><Icon name={e.icon} size={20} color={e.tint} /></View>
              <View style={{ flex: 1 }}>
                <View style={m.labelRow}>
                  <Text style={m.rowLabel}>{e.label}</Text>
                  {!e.ready && <View style={m.chip}><Text style={m.chipText}>Coming soon</Text></View>}
                </View>
                <Text style={m.rowMeta} numberOfLines={1}>{isLocked(e) ? "Not in your plan" : e.meta}</Text>
              </View>
              {e.ready && !isLocked(e) ? <Icon name="right" size={18} color={C.text3} /> : <Icon name="lock" size={16} color={C.text3} />}
            </Pressable>
          ))}
        </View>
      ))}
      <Text style={u.footer}>© 2026 Revo Space Enterprise Ltd.</Text>
    </Screen>
  );
}

const m = StyleSheet.create({
  pageTitle: { fontSize: 24, fontWeight: "700", color: C.text, letterSpacing: -0.5, marginBottom: 14 },
  bizCard: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 6 },
  bizIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: C.forestSoft, alignItems: "center", justifyContent: "center" },
  bizName: { fontSize: 16.5, fontWeight: "700", color: C.text },
  bizMeta: { fontSize: 12.5, color: C.text2, marginTop: 2 },
  section: { fontSize: 15, fontWeight: "700", color: C.text, marginTop: 16, marginBottom: 8, marginLeft: 2 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60,
    backgroundColor: "#fff", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 8, borderWidth: 1, borderColor: C.border2,
  },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 15, fontWeight: "600", color: C.text },
  rowMeta: { fontSize: 12, color: C.text2, marginTop: 2 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: { backgroundColor: C.border2, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 10, fontWeight: "600", color: C.text2 },
});
