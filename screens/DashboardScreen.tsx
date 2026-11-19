/**
 * The dashboard — previously the entire app, now one tab of several.
 *
 * Content is unchanged from the single-screen version. The only differences are
 * that it renders inside the shared <Screen> (so its top padding comes from the
 * device's safe-area inset instead of a hardcoded 64, and its bottom padding
 * clears the tab bar) and that the palette now comes from ../theme.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import Svg, { Circle } from "react-native-svg";
import { formatNaira, formatCompact, getClient, supabase as liveClient } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { C } from "../theme";
import { useModules } from "../lib/modules";
import { Avatar, FilterChips, Icon, QuickAction, SectionHeader, StatCard } from "../components/kit";
import { useCreateMenu, useLongPressAnchor } from "../components/CreateMenu";
import { Card, ErrorView, Loading, Logo, Screen, Tile, TileGrid, u } from "../components/ui";

interface Dash {
  overdue_kobo: number;
  due_within_30_days_kobo: number;
  avg_days_to_get_paid: number | null;
  upcoming_payout_kobo: number;
  activity: { icon: string; title: string; meta: string; amount_kobo: number; positive: boolean | null }[];
}
interface Health {
  available: boolean; score?: number; delta?: number | null; band?: string; headline?: string;
  /** Why there is no score yet, from the server. */
  message?: string; coverage?: number;
  /* `weight` was missing here, so mobile could not show how much each factor
     counts for — the one piece of context that makes the number actionable. */
  factors?: { key: string; label: string; score: number; weight: number; grade: string; detail: string }[];
}
interface Breakdown {
  month_label: string; total_kobo: number; transaction_count: number;
  categories: { category_id: string; name: string; color: string;
                amount_kobo: number; share_pct: number }[];
}
interface Tasks {
  total_count: number;
  overdue_invoices: { id: string; number: string; customer: string; days_late: number; balance_kobo: number }[];
  receipts_awaiting_review: { id: string; merchant: string; total_kobo: number | null; primary_flag: string | null }[];
}

function HealthRing({ score }: { score: number }) {
  const size = 150, r = 64, c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.16)" strokeWidth={13} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.accent} strokeWidth={13} fill="none"
                strokeLinecap="round" strokeDasharray={`${c * (score / 100)} ${c}`} />
      </Svg>
      <Text style={s.ringScore}>{score}</Text>
      <Text style={s.ringOutOf}>OUT OF 100</Text>
    </View>
  );
}

/**
 * "Good morning, Ogrima 👋" — from the DEVICE clock, which on a phone is
 * always the user's own local time, so there is no timezone problem to solve
 * here the way there is on the server-rendered web dashboard. The thresholds
 * (12:00, 17:00) match apps/web/lib/greeting.ts so the two
 * surfaces never disagree about what time of day it is.
 *
 * No name renders as "Good morning 👋" rather than a dangling comma.
 */
function greeting(name: string | null): string {
  const h = new Date().getHours();
  const phrase = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return name ? `${phrase}, ${name} 👋` : `${phrase} 👋`;
}

/** First name only — "Ogrima", not "Ogrima Musa Jnr". Mirrors the web helper. */
function firstNameOf(p: { full_name?: string | null; email?: string | null } | null): string | null {
  const full = p?.full_name?.trim();
  if (full) return full.split(/\s+/)[0] ?? null;

  const local = p?.email?.split("@")[0]?.trim();
  // "info" or "a" makes a poor greeting; better to greet with no name at all.
  if (local && local.length > 1 && /[a-z]/i.test(local)) {
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return null;
}

const RANGES = [
  { v: "today", label: "Today" }, { v: "week", label: "This week" }, { v: "month", label: "This month" },
] as const;

/**
 * The green summary card: money received (inbound payments) for the chosen
 * period, with the last seven days as bars. Real payments only; there is no
 * percentage change because no previous-period figure is loaded.
 */
function Hero({ received, range, setRange }: {
  received: { amount_kobo: number; paid_on: string }[];
  range: "today" | "week" | "month"; setRange: (r: "today" | "week" | "month") => void;
}) {
  const { total, bars, label } = useMemo(() => {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(now.getDate() - (6 - i)); return day(d); });
    const sumOn = (iso: string) => received.filter((r) => r.paid_on === iso).reduce((a, r) => a + r.amount_kobo, 0);
    const from = range === "today" ? day(now) : range === "week" ? days[0]! : day(new Date(now.getFullYear(), now.getMonth(), 1));
    return {
      total: received.filter((r) => r.paid_on >= from).reduce((a, r) => a + r.amount_kobo, 0),
      bars: days.map(sumOn),
      label: RANGES.find((r) => r.v === range)!.label,
    };
  }, [received, range]);
  const max = Math.max(...bars, 1);
  const next = () => setRange(range === "today" ? "week" : range === "week" ? "month" : "today");
  return (
    <View style={s.hero}>
      <View style={s.heroTop}>
        <Text style={s.heroLabel}>Money received</Text>
        <Pressable onPress={next} hitSlop={8} style={s.heroPick} accessibilityRole="button" accessibilityLabel={`Period: ${label}. Tap to change`}>
          <Text style={s.heroPickText}>{label}</Text><Icon name="down" size={14} color="#fff" />
        </Pressable>
      </View>
      <View style={s.heroBody}>
        <Text style={s.heroValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatNaira(total)}</Text>
        <View style={s.heroBars}>
          {bars.map((b, i) => <View key={i} style={[s.heroBar, { height: 6 + (b / max) * 38, opacity: b > 0 ? 1 : 0.35 }]} />)}
        </View>
      </View>
    </View>
  );
}

export default function DashboardScreen() {
  /*
   * Everything the dashboard needs, in one pass against the shared org.
   *
   * The org name and id used to be fetched here as well; they now come from
   * OrgProvider, which resolves them once for the whole app instead of once per
   * tab.
   */
  const { orgName } = useOrg();
  const { loading, refreshing, error, data, reload, onRefresh } =
    useOrgData<{
      firstName: string | null;
      dash: Dash | null;
      breakdown: Breakdown | null; tasks: Tasks | null;
      received: { amount_kobo: number; paid_on: string }[] | null;
      invoiceCount: number | null; customerCount: number | null; lowStock: number | null;
      gross: { gp: number; margin: number | null } | null;
    }>(async (supabase, orgId) => {
      /*
       * Who is signed in, for the greeting. Read from `profiles`, not
       * hardcoded — the header used to say "Janet" to everyone, which was
       * wrong for every user but one. RLS returns only the caller's own row.
       *
       * Its failure is swallowed deliberately: a missing or unreadable profile
       * should cost the greeting its name, not the whole dashboard.
       */
      const { data: profiles } = await supabase
        .from("profiles").select("full_name,email").limit(1);

      const today = new Date().toISOString().slice(0, 10);
      const [d, b, t] = await Promise.all([
        supabase.rpc("dashboard_summary", { target_org: orgId }),
        supabase.rpc("category_breakdown", { target_org: orgId, month: today }),
        supabase.rpc("my_tasks", { target_org: orgId }),
      ]);

      // A failed RPC must not render as a business with no money in it.
      const failed = [d.error, b.error, t.error].find(Boolean);
      if (failed) throw new Error(failed.message);

      /*
       * The figures behind the hero card and the four stat cards. All are plain
       * reads of tables the other screens already read (payments, documents,
       * customers, item_stock_levels). Each one fails soft to null, and a null
       * card is simply not drawn, so a missing module never breaks the page.
       */
      const monthStart = new Date(); monthStart.setDate(1);
      const since = monthStart.toISOString().slice(0, 10);
      const monthEnd = new Date(); // month to date, same figures as Reports → Profit & Loss
      const [pay, inv, cus, stock, pl] = await Promise.all([
        supabase.from("payments").select("amount_kobo,paid_on").eq("org_id", orgId)
          .eq("direction", "inbound").gte("paid_on", since),
        supabase.from("documents").select("id", { count: "exact", head: true })
          .eq("org_id", orgId).eq("doc_type", "invoice").neq("status", "void"),
        supabase.from("customers").select("id", { count: "exact", head: true })
          .eq("org_id", orgId).eq("is_archived", false),
        supabase.from("item_stock_levels").select("quantity_on_hand,reorder_level").eq("org_id", orgId),
        // Gross profit is never calculated here: it is profit_and_loss, the one server calculation.
        supabase.rpc("profit_and_loss", { target_org: orgId, from_date: since, to_date: monthEnd.toISOString().slice(0, 10) }),
      ]);
      const plData = pl.error ? null : (pl.data as { gross_profit_kobo?: number; gross_margin_pct?: number | null } | null);

      return {
        received: pay.error ? null : (pay.data ?? []).map((r) => ({ amount_kobo: Number(r.amount_kobo), paid_on: String(r.paid_on) })),
        gross: plData && typeof plData.gross_profit_kobo === "number"
          ? { gp: plData.gross_profit_kobo, margin: plData.gross_margin_pct ?? null } : null,
        invoiceCount: inv.error ? null : (inv.count ?? 0),
        customerCount: cus.error ? null : (cus.count ?? 0),
        lowStock: stock.error ? null : (stock.data ?? []).filter((r) =>
          r.reorder_level != null && Number(r.quantity_on_hand) <= Number(r.reorder_level)).length,
        firstName: firstNameOf(profiles?.[0] ?? null),
        dash: d.data as Dash | null,
        breakdown: b.data as Breakdown | null,
        tasks: t.data as Tasks | null,
      };
    });

  const firstName = data?.firstName ?? null;
  const dash = data?.dash ?? null;
  const breakdown = data?.breakdown ?? null;
  const tasks = data?.tasks ?? null;

  const nav = useNavigation<{ navigate: (n: string, p?: object) => void }>();
  // Long-press "Create Invoice": the same two-option popover as the tab-bar + button.
  const createMenu = useCreateMenu(() => nav.navigate("CreateInvoice"), () => nav.navigate("AddPurchase"));
  const invoiceHold = useLongPressAnchor(createMenu.open);

  /*
   * Financial health is read live, never from a stored snapshot: the same
   * financial_health RPC the web calls, for the chosen branch. It is fetched
   * again whenever this screen gains focus, the app returns to the foreground,
   * every 30 seconds while the screen is showing, and on pull-to-refresh, so a
   * new sale, payment or expense moves the score without reopening the app.
   */
  const { orgId } = useOrg();
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const loadHealth = useCallback(async () => {
    if (!orgId) return;
    try {
      const c = await getClient();
      const { data: h, error: he } = await c.rpc("financial_health", { target_org: orgId, target_branch: branchId });
      if (!he) setHealth(h as Health);
    } catch { /* keep the last figures; the next refresh retries */ }
  }, [orgId, branchId]);
  useFocusEffect(useCallback(() => {
    void loadHealth();
    const t = setInterval(() => void loadHealth(), 30000);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void loadHealth(); });
    // Instant updates: any change to this business's money records re-reads the
    // same financial_health RPC (events coalesced). The 30 s poll stays as a fallback.
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const coalesced = () => { if (debounce) clearTimeout(debounce); debounce = setTimeout(() => void loadHealth(), 800); };
    let channel = orgId ? liveClient.channel(`health-${orgId}`) : null;
    if (channel && orgId) {
      for (const table of ["payments", "expenses", "documents", "purchases", "budgets"]) {
        channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `org_id=eq.${orgId}` }, coalesced);
      }
      channel.subscribe();
    }
    return () => { clearInterval(t); sub.remove(); if (debounce) clearTimeout(debounce); if (channel) void liveClient.removeChannel(channel); };
  }, [loadHealth, orgId]));
  useEffect(() => {
    if (!orgId) return;
    let off = false;
    (async () => {
      try {
        const c = await getClient();
        const { data: b } = await c.from("branches").select("id,name").eq("org_id", orgId).eq("is_active", true).order("name");
        if (!off) setBranches((b ?? []) as { id: string; name: string }[]);
      } catch { /* one branch, or unreadable: no switcher */ }
    })();
    return () => { off = true; };
  }, [orgId]);
  const { has } = useModules();
  const [range, setRange] = useState<"today" | "week" | "month">("week");

  const factorRows = health?.factors?.map((f) => {
                  // An indicator with nothing to measure is grey, never green or red.
                  const grade = f.grade === "Strong" ? C.accent
                              : f.grade === "Watch" ? C.amber
                              : f.grade === "Weak" ? "#FDA29B" : "rgba(255,255,255,0.55)";
                  return (
                    <View key={f.key} style={s.factorRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.factorLabel}>{f.label}</Text>
                        <Text style={s.factorDetail}>{f.detail}</Text>
                        {/* Weight and bar, both of which web shows and mobile
                            did not. Without the weight a factor scoring badly
                            looks equally urgent whether it counts for 30% of
                            the score or 20%. */}
                        <View style={s.factorBarTrack}>
                          <View style={[s.factorBarFill, { width: `${Math.max(0, Math.min(100, f.score))}%`, backgroundColor: grade }]} />
                        </View>
                        <Text style={s.factorWeight}>{Math.round((f.weight ?? 0) * 100)}% weight</Text>
                      </View>
                      <Text style={[s.factorGrade, { color: grade }]}>{f.grade}</Text>
                    </View>
                  );
                });
  if (loading) return <Loading label="Loading your business…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  return (
    <>
      <StatusBar style="dark" />
      <Screen refreshing={refreshing} onRefresh={() => { onRefresh(); void loadHealth(); }}>
        <View style={s.topRow}>
          <Avatar name={firstName ?? orgName} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={s.greeting} numberOfLines={1}>{firstName ? `Hello, ${firstName} 👋` : "Hello 👋"}</Text>
            <Text style={s.orgName} numberOfLines={1}>{orgName}</Text>
          </View>
          {/* The bell shows what needs attention (overdue invoices, receipts to review) and opens Invoices. */}
          <Pressable onPress={() => nav.navigate("Invoices")} hitSlop={8} style={s.bell}
                     accessibilityRole="button" accessibilityLabel="Needs attention">
            <Icon name="bell" size={22} color={C.text} />
            {tasks && tasks.total_count > 0 && <View style={s.bellDot}><Text style={s.bellDotText}>{tasks.total_count > 9 ? "9+" : tasks.total_count}</Text></View>}
          </Pressable>
        </View>

        {data?.received && <Hero received={data.received} range={range} setRange={setRange} />}

        <View style={s.statGrid}>
          {data?.gross && has("reports") && <StatCard icon="chart" tint="#16A34A" label="Gross profit" value={formatCompact(data.gross.gp)} note={data.gross.margin != null ? `${data.gross.margin}% margin · this month` : "this month"} />}
          {data?.invoiceCount != null && <StatCard icon="invoice" tint="#2563EB" label="Invoices" value={String(data.invoiceCount)} />}
          {breakdown && <StatCard icon="card" tint="#F59E0B" label="Expenses" value={formatCompact(breakdown.total_kobo)} note={breakdown.month_label} />}
          {data?.customerCount != null && <StatCard icon="users" tint="#7C3AED" label="Customers" value={String(data.customerCount)} />}
          {data?.lowStock != null && has("inventory") && <StatCard icon="box" tint="#EF4444" label="Low stock" value={String(data.lowStock)} />}
        </View>

        {createMenu.node}
        <SectionHeader title="Quick actions" />
        <View style={s.qaRow}>
          {has("pos") && <QuickAction icon="cart" tint="#16A34A" label="New Sale" onPress={() => nav.navigate("More", { screen: "Pos" })} />}
          <QuickAction icon="invoice" tint="#2563EB" label="Create Invoice" onPress={() => nav.navigate("CreateInvoice")}
            pressRef={invoiceHold.ref} onLongPress={invoiceHold.onLongPress} hint="Press and hold for sales or purchase invoice" />
          <QuickAction icon="box" tint="#F59E0B" label="Add Product" onPress={() => nav.navigate("AddItem")} />
          <QuickAction icon="card" tint="#F97316" label="Add Expense" onPress={() => nav.navigate("AddExpense")} />
        </View>

        {dash && dash.activity.length > 0 && (
          <>
            <SectionHeader title="Recent activity" action="See all" onAction={() => nav.navigate("Invoices")} />
            {dash.activity.slice(0, 6).map((a, i) => (
              <View key={i} style={s.actRow}>
                <Avatar name={a.title} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={u.rowTitle} numberOfLines={1}>{a.title}</Text>
                  <Text style={u.rowMeta} numberOfLines={1}>{a.meta}</Text>
                </View>
                <Text style={[u.rowAmount, {
                  color: a.positive === true ? C.success : a.positive === false ? C.expense : C.text,
                }]}>
                  {a.positive === true ? "+" : a.positive === false ? "−" : ""}
                  {formatNaira(a.amount_kobo)}
                </Text>
              </View>
            ))}
          </>
        )}

        {/*
          Rendered even when there is no score yet.

          This used to be `health?.available && (...)`, so a business with no
          snapshot got no card at all — silently. Web says "No snapshot yet" in
          the same situation, and a missing card reads as a broken app rather
          than a feature waiting for data.
        */}
        {branches.length > 1 && (
          <FilterChips value={branchId ?? "all"} onChange={(v) => setBranchId(v === "all" ? null : v)}
            options={[{ value: "all", label: "All branches" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
        )}
        {health && (
          <View style={s.healthCard}>
            <View style={s.rowBetween}>
              <Text style={s.healthTitle}>Financial health</Text>
              {health.delta != null && (
                <View style={s.deltaChip}>
                  <Text style={s.deltaText}>
                    {health.delta > 0 ? `+${health.delta}` : health.delta}
                  </Text>
                </View>
              )}
            </View>
            {health.available ? (
              <>
                <View style={{ alignItems: "center", marginTop: 10 }}>
                  <HealthRing score={health.score ?? 0} />
                </View>
                <Text style={s.healthHeadline}>{health.headline}</Text>
                {factorRows}
              </>
            ) : (
              <>
                <Text style={s.healthEmpty}>
                  {health.message ?? "Not enough data yet. Record sales, payments and expenses to see your score."}
                </Text>
                {factorRows}
              </>
            )}
          </View>
        )}

        {tasks && tasks.total_count > 0 && (
          <Card>
            <View style={s.rowBetween}>
              <Text style={u.cardTitle}>My tasks</Text>
              <View style={s.countChip}><Text style={s.countText}>{tasks.total_count}</Text></View>
            </View>
            {tasks.overdue_invoices.slice(0, 3).map((o) => (
              <View key={o.id} style={u.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={u.rowTitle}>{o.customer}</Text>
                  <Text style={u.rowMeta}>{o.number} · {o.days_late} days late</Text>
                </View>
                <Text style={[u.rowAmount, { color: C.danger }]}>{formatNaira(o.balance_kobo)}</Text>
              </View>
            ))}
            {tasks.receipts_awaiting_review.slice(0, 3).map((r) => (
              <View key={r.id} style={u.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={u.rowTitle}>{r.merchant}</Text>
                  <Text style={[u.rowMeta, { color: C.warning }]}>{r.primary_flag}</Text>
                </View>
                <Text style={u.rowAmount}>
                  {r.total_kobo != null ? formatNaira(r.total_kobo) : "—"}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {breakdown && breakdown.categories.length > 0 && (
          <Card
            title="Spending by category"
            subtitle={`${breakdown.month_label} · ${formatCompact(breakdown.total_kobo)} across ${breakdown.transaction_count} transactions`}
          >
            {breakdown.categories.map((c) => (
              <View key={c.category_id} style={{ marginTop: 12 }}>
                <View style={s.rowBetween}>
                  <Text style={u.rowTitle}>{c.name}</Text>
                  <Text style={u.rowAmount}>{formatNaira(c.amount_kobo)}</Text>
                </View>
                <Text style={u.rowMeta}>{c.share_pct}% of total</Text>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { width: `${c.share_pct}%`, backgroundColor: c.color }]} />
                </View>
              </View>
            ))}
          </Card>
        )}

        <SectionHeader title="Receivables" />
        {dash && (
          <TileGrid>
            <Tile label="Overdue" value={formatNaira(dash.overdue_kobo)} color={C.danger} />
            <Tile label="Due in 30 days" value={formatNaira(dash.due_within_30_days_kobo)} />
            <Tile label="Avg days to get paid"
                  value={dash.avg_days_to_get_paid != null
                    ? `${dash.avg_days_to_get_paid} ${dash.avg_days_to_get_paid === 1 ? "day" : "days"}`
                    : "—"} />
            <Tile label="Upcoming payout" value={formatNaira(dash.upcoming_payout_kobo)} dark />
          </TileGrid>
        )}

        <Text style={u.footer}>© 2026 Revo Space Enterprise Ltd.</Text>
      </Screen>
    </>
  );
}

const s = StyleSheet.create({
  topRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  greeting: { fontSize: 18, fontWeight: "700", color: C.text, letterSpacing: -0.3 },
  orgName: { fontSize: 12.5, color: C.text2, marginTop: 1 },
  bell: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  bellDot: { position: "absolute", top: -2, right: -2, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: C.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  bellDotText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  hero: { backgroundColor: C.forest, borderRadius: 22, padding: 18, marginBottom: 14, overflow: "hidden" },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroLabel: { color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: "500" },
  heroPick: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 99, paddingHorizontal: 11, paddingVertical: 5 },
  heroPickText: { color: "#fff", fontSize: 12.5, fontWeight: "600" },
  heroBody: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 12, gap: 10 },
  heroValue: { flex: 1, color: "#fff", fontSize: 32, fontWeight: "800", letterSpacing: -1 },
  heroBars: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 46 },
  heroBar: { width: 7, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.55)" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 6 },
  actRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 16, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  qaRow: { flexDirection: "row", gap: 6, marginBottom: 16 },

  healthCard: { backgroundColor: C.inkCard, borderRadius: 18, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.borderDark },
  healthTitle: { fontSize: 15, fontWeight: "600", color: "#fff" },
  healthHeadline: { fontSize: 12, color: "rgba(255,255,255,0.78)", textAlign: "center", marginTop: 12, lineHeight: 18 },
  ringScore: { fontSize: 40, fontWeight: "700", color: "#fff", letterSpacing: -1.5 },
  ringOutOf: { fontSize: 9, color: "rgba(255,255,255,0.7)", letterSpacing: 1.4, marginTop: 2 },
  deltaChip: { backgroundColor: C.accent, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  deltaText: { fontSize: 11, fontWeight: "600", color: C.onBrand },
  factorRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 9, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)", marginTop: 8,
  },
  factorLabel: { fontSize: 13, fontWeight: "500", color: "#fff" },
  factorDetail: { fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 2 },
  factorBarTrack: {
    height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)",
    marginTop: 8, overflow: "hidden",
  },
  factorBarFill: { height: 4, borderRadius: 2 },
  factorWeight: { color: "rgba(255,255,255,0.55)", fontSize: 11, marginTop: 5 },
  healthEmpty: {
    color: "rgba(255,255,255,0.8)", fontSize: 12.5, textAlign: "center",
    marginTop: 14, lineHeight: 18,
  },
  factorGrade: { fontSize: 12.5, fontWeight: "600" },

  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  countChip: { backgroundColor: "#FEE4E2", borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
  countText: { fontSize: 11, fontWeight: "600", color: "#B42318" },

  barTrack: { height: 7, borderRadius: 99, backgroundColor: C.border2, overflow: "hidden", marginTop: 7 },
  barFill: { height: "100%", borderRadius: 99 },
});
