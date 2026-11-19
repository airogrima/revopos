/**
 * Industry and modules — the same controls as web Settings → Industry and modules.
 *
 * Switching a module off hides it; its records stay. What a module costs and
 * whether the plan covers it come from public.quote_modules, the single price
 * calculation. Paying goes through the server checkout (lib/billing.ts) and a
 * module unlocks only after the server confirms the payment.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { formatNaira, getClient, signOut } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { INDUSTRIES } from "../lib/industries";
import { isReauth, settle, settleMessage, startCheckout } from "../lib/billing";
import { CHECKOUT_ENABLED } from "../lib/features";
import { C } from "../theme";
import { FilterChips } from "../components/kit";
import { Card, ErrorView, Loading, Screen, ScreenTitle, u } from "../components/ui";

interface Mod {
  key: string; label: string; description: string | null; badge: string;
  selected: boolean; entitled: boolean; enabled: boolean; has_data: boolean; recommended: boolean;
}
interface Loaded { industry: string | null; modules: Mod[]; isAdmin: boolean }
interface Quote {
  required_plan: "starter" | "pro" | null; base_kobo: number | null; total_kobo: number; covered: boolean;
  current_tier: string | null; enterprise_recommended: boolean; unavailable_addons: string[];
  addons: { key: string; name: string; monthly_kobo: number; amount_kobo: number; grandfathered: boolean; available: boolean }[];
}

const BADGE: Record<string, string> = { starter: "Starter", pro: "Pro", addon: "Add-on" };

export default function ModulesScreen() {
  const { orgId } = useOrg();
  const { loading, refreshing, error, data, reload, onRefresh } = useOrgData<Loaded>(async (supabase, id) => {
    const [m, k] = await Promise.all([
      supabase.rpc("my_modules", { target_org: id }),
      supabase.rpc("my_permission_keys", { target_org: id }),
    ]);
    if (m.error) throw new Error(m.error.message);
    const mm = (m.data ?? {}) as { industry: string | null; modules: Mod[] };
    return { industry: mm.industry, modules: mm.modules ?? [], isAdmin: !!(k.data as { is_admin?: boolean } | null)?.is_admin };
  });

  const [on, setOn] = useState<string[] | null>(null);
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [monthlyTotal, setMonthlyTotal] = useState<number | null>(null);   // for the yearly saving
  const [prices, setPrices] = useState<Record<string, number>>({});          // add-on monthly price by module key, from public_pricing()
  const [quoting, setQuoting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const pending = useRef<string | null>(null);

  // The switches start from what the server has saved. After something changes the saved state
  // (a new industry, a verified payment) the next fresh copy of it replaces them; a plain save
  // keeps what is on screen, because that is exactly what was just saved.
  const resync = useRef(false);
  useEffect(() => {
    if (data && (on === null || resync.current)) { setOn(data.modules.filter((x) => x.selected).map((x) => x.key)); resync.current = false; }
  }, [data, on]);

  // Add-on prices for the toggle rows come from the database (public_pricing), never from code.
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const c = await getClient();
        const { data: p } = await c.rpc("public_pricing");
        const list = ((p as { addons?: { key: string; monthly_kobo: number }[] } | null)?.addons ?? []);
        if (!off) setPrices(Object.fromEntries(list.map((a) => [a.key, a.monthly_kobo])));
      } catch { /* rows simply show no price */ }
    })();
    return () => { off = true; };
  }, []);

  // Price whatever is switched on, from the database's one calculation (quote_modules). The device never
  // works out an amount: totals, base price and add-on prices are all read from it, and the server
  // recalculates again when payment starts.
  useEffect(() => {
    if (!orgId || on === null) return;
    let off = false;
    setQuoting(true);
    (async () => {
      try {
        const c = await getClient();
        const [q, m] = await Promise.all([
          c.rpc("quote_modules", { target_org: orgId, module_keys: on, p_period: period }),
          period === "yearly" ? c.rpc("quote_modules", { target_org: orgId, module_keys: on, p_period: "monthly" }) : Promise.resolve(null),
        ]);
        if (off) return;
        if (q.error || !q.data) throw new Error(q.error?.message ?? "no quote");
        setQuote(q.data as Quote);
        setMonthlyTotal(m && !m.error ? ((m.data as Quote).total_kobo ?? null) : null);
      } catch { if (!off) { setQuote(null); setMonthlyTotal(null); } }
      finally { if (!off) setQuoting(false); }
    })();
    return () => { off = true; };
  }, [orgId, on, period]);

  const verify = useCallback(async () => {
    const ref = pending.current;
    if (!ref) return;
    setBusy(true);
    try {
      const out = await settle(ref);
      setNote(settleMessage(out));
      if (out.settled || !out.reason.includes("pending")) pending.current = null;
      if (out.settled) { resync.current = true; reload(); }
    } catch (e) { setReauth(isReauth(e)); setNote(e instanceof Error ? e.message : "Could not check the payment."); }
    finally { setBusy(false); }
  }, [reload]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void verify(); });
    return () => sub.remove();
  }, [verify]);

  if (loading || on === null) return <Loading label="Loading modules…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data) return <ErrorView message="No module information available" />;

  const canEdit = data.isAdmin;
  const initial = data.modules.filter((x) => x.selected).map((x) => x.key);
  const dirty = on.length !== initial.length || on.some((k) => !initial.includes(k));

  const toggle = (m: Mod, v: boolean) => {
    if (!canEdit) return;
    const apply = () => setOn((cur) => (v ? [...(cur ?? []), m.key] : (cur ?? []).filter((k) => k !== m.key)));
    if (!v && m.has_data) {
      Alert.alert(`Switch off ${m.label}?`, "It will be hidden. Your records are kept, and switching it back on shows them again.",
        [{ text: "Keep on", style: "cancel" }, { text: "Switch off", onPress: apply }]);
    } else apply();
  };

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setNote(null);
    try { setNote(await fn()); reload(); }
    catch (e) { setNote(e instanceof Error ? e.message : "That did not work."); }
    finally { setBusy(false); }
  };

  const save = () => run(async () => {
    const c = await getClient();
    const { error: err } = await c.rpc("set_org_modules", { target_org: orgId, enabled_keys: on });
    if (err) throw new Error(err.message);
    return "Modules updated. Nothing was deleted; switch a module back on any time.";
  });

  const setIndustry = (key: string) => {
    if (!canEdit || key === (data.industry ?? "other")) return;
    Alert.alert("Change industry?", "This changes what is recommended and optionally switches on what the industry needs. Your data is not changed.",
      [{ text: "Cancel", style: "cancel" }, { text: "Change", onPress: () => void run(async () => {
        const c = await getClient();
        const { error: err } = await c.rpc("set_org_industry", { target_org: orgId, new_industry: key, apply_recommended: true });
        if (err) throw new Error(err.message);
        await c.rpc("seed_my_industry_roles", { target_org: orgId });
        resync.current = true;
        return "Industry updated. Your data was not changed.";
      }) }]);
  };

  const pay = async () => {
    if (!orgId || !quote?.required_plan) return;
    setBusy(true); setNote(null); setReauth(false);
    try {
      // Selection is saved first so what is paid for is what is switched on.
      const c = await getClient();
      const { error: se } = await c.rpc("set_org_modules", { target_org: orgId, enabled_keys: on });
      if (se) throw new Error(se.message);
      const r = await startCheckout(orgId, quote.required_plan, period, on);   // the server re-prices from the database
      if (!r.ok) { setNote(r.message ?? "Could not start payment."); return; }
      pending.current = r.reference ?? null;
      setNote("Complete the payment in your browser, then return to RevoPass. The modules unlock once the bank confirms it.");
    } catch (e) { setReauth(isReauth(e)); setNote(e instanceof Error ? e.message : "Could not start payment."); }
    finally { setBusy(false); }
  };

  const industry = data.industry ?? "other";
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Industry & modules" subtitle={canEdit ? "Switch on only what your business uses" : "Only an owner or admin can change these"} />

      {note ? <Card title="Status"><Text style={u.rowMeta}>{note}</Text>
        {reauth ? <Pressable onPress={() => void signOut()} style={s.cta} accessibilityRole="button"><Text style={s.ctaText}>Sign in again</Text></Pressable> : null}
        {pending.current ? (
          <Pressable disabled={busy} onPress={() => void verify()} style={s.cta}><Text style={s.ctaText}>{busy ? "Checking…" : "I have paid — check status"}</Text></Pressable>
        ) : null}
      </Card> : null}

      <Card title="Business industry" subtitle={INDUSTRIES.find((i) => i.key === industry)?.label ?? "Other"}>
        <View style={s.wrap}>
          {INDUSTRIES.map((i) => (
            <Pressable key={i.key} disabled={!canEdit || busy} onPress={() => setIndustry(i.key)}
              style={[s.pill, industry === i.key && s.pillOn]} accessibilityState={{ selected: industry === i.key }}>
              <Text style={[s.pillText, industry === i.key && { color: "#fff" }]}>{i.label}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card title="Billing period" subtitle={period === "yearly" ? "Prices shown per year" : "Prices shown per month"}>
        <FilterChips value={period} onChange={setPeriod} options={[{ value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly" }]} />
      </Card>

      <Card title="Modules" subtitle="Hidden modules keep their data">
        {data.modules.map((m) => {
          const selected = on.includes(m.key);
          const price = prices[m.key];            // only add-ons have one
          const priceText = price != null ? `${formatNaira(price * (period === "yearly" ? 12 : 1))} / ${period === "yearly" ? "year" : "month"}` : null;
          return (
            <View key={m.key} style={u.listRow}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={u.rowTitle}>{m.label}{m.recommended ? "  ·  recommended" : ""}</Text>
                <Text style={u.rowMeta}>
                  {BADGE[m.badge] ?? m.badge}{priceText ? ` · ${priceText}` : ""}{m.badge === "addon" && !m.entitled ? " · locked until paid" : m.entitled ? " · included" : ""}{m.description ? ` · ${m.description}` : ""}
                </Text>
              </View>
              <Switch value={selected} disabled={!canEdit || busy} onValueChange={(v) => toggle(m, v)} />
            </View>
          );
        })}
        {canEdit && dirty ? (
          <Pressable disabled={busy} onPress={() => void save()} style={s.cta}><Text style={s.ctaText}>Save selection</Text></Pressable>
        ) : null}
      </Card>

      {(() => {
        const per = period === "yearly" ? "year" : "month";
        if (quoting && !quote) return <Card title="Your RevoPass setup"><Text style={u.rowMeta}>Working out your setup…</Text></Card>;
        if (!quote) return <Card title="Your RevoPass setup"><Text style={[u.rowMeta, { color: C.danger }]}>We could not price this setup right now. Check your connection and pull to refresh.</Text></Card>;
        const planName = quote.required_plan === "pro" ? "Pro" : "Starter";
        const onTrial = quote.current_tier === "trial";
        // Same rule as the web: pay when the plan does not cover the selection, or while on the free trial (it can be paid any time).
        const canPay = !quote.covered || (onTrial && quote.total_kobo > 0);
        const valid = !quoting && quote.required_plan != null && quote.base_kobo != null && quote.total_kobo > 0 && quote.unavailable_addons.length === 0;
        const saving = period === "yearly" && monthlyTotal != null && monthlyTotal * 12 > quote.total_kobo ? monthlyTotal * 12 - quote.total_kobo : 0;
        return (
          <Card title="Your RevoPass setup" subtitle={quote.covered ? (onTrial ? "Covered by your free trial" : "Covered by your current plan") : `Needs ${planName} to activate`}>
            <View style={u.listRow}>
              <Text style={[u.rowTitle, { flex: 1 }]}>Base plan: {planName}</Text>
              <Text style={u.rowAmount}>{formatNaira(quote.base_kobo ?? 0)} / {per}</Text>
            </View>
            {quote.addons.map((a) => (
              <View key={a.key} style={u.listRow}>
                <Text style={[u.rowTitle, { flex: 1 }]}>{a.name}{a.grandfathered ? " · included for you" : ""}</Text>
                <Text style={u.rowMeta}>{a.grandfathered ? "Included" : `${formatNaira(a.amount_kobo)} / ${per}`}</Text>
              </View>
            ))}
            <View style={u.listRow}>
              <Text style={[u.rowTitle, { flex: 1, fontWeight: "700" }]}>{period === "yearly" ? "Yearly" : "Monthly"} total</Text>
              <Text style={[u.rowAmount, { fontWeight: "700" }]}>{formatNaira(quote.total_kobo)} / {per}</Text>
            </View>
            {saving > 0 ? <Text style={[u.rowMeta, { color: C.success, marginTop: 4 }]}>You save {formatNaira(saving)} a year compared with paying monthly.</Text> : null}
            {quote.enterprise_recommended ? <Text style={[u.rowMeta, { marginTop: 8 }]}>With several specialist add-ons, Enterprise may suit you better. Contact support@revopass.ng. This never blocks checkout.</Text> : null}
            {quote.unavailable_addons.length > 0 ? <Text style={[u.rowMeta, { marginTop: 8, color: C.danger }]}>One of the selected add-ons is not available right now.</Text> : null}
            {dirty && canEdit ? <Text style={[u.rowMeta, { marginTop: 8 }]}>Your selection is saved automatically when you pay, or tap Save selection above.</Text> : null}
            {CHECKOUT_ENABLED && canEdit && canPay ? (
              <Pressable disabled={busy || !valid} onPress={() => void pay()} accessibilityRole="button" accessibilityState={{ disabled: busy || !valid }}
                style={[s.cta, s.payBtn, (busy || !valid) && { opacity: 0.5 }]}>
                <Text style={[s.ctaText, { fontSize: 16 }]}>{busy ? "Starting payment…" : quoting ? "Updating price…" : `Pay Now — ${formatNaira(quote.total_kobo)} / ${per}`}</Text>
              </Pressable>
            ) : null}
            {CHECKOUT_ENABLED && onTrial && canPay ? <Text style={[u.rowMeta, { marginTop: 6 }]}>You can pay now without waiting for your free trial to end.</Text> : null}
          </Card>
        );
      })()}
    </Screen>
  );
}

const s = StyleSheet.create({
  cta: { marginTop: 12, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  payBtn: { backgroundColor: C.forest, paddingVertical: 16 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  pill: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.border2 },
  pillOn: { backgroundColor: C.primary, borderColor: C.primary },
  pillText: { fontSize: 12.5, fontWeight: "600", color: C.text2 },
});
