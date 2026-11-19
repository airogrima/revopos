/**
 * Pricing — plans, prices and subscribing, from the same sources as the web.
 *
 * Prices come from public.public_pricing (public.plan_prices and
 * industry_addons), the rows checkout charges from, so a number on this screen
 * is the number on the bill. Paying goes through the RevoPass server
 * (lib/billing.ts → /api/mobile/checkout): the phone never holds a payment
 * secret, and a plan activates only after the server has verified the payment
 * with Squad. Returning from the payment page is not proof of payment.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { formatNaira, getClient, signOut } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { C } from "../theme";
import { Card, ErrorView, Loading, Screen, ScreenTitle, u } from "../components/ui";
import { isReauth, settle, settleMessage, startCheckout } from "../lib/billing";
import { CHECKOUT_ENABLED } from "../lib/features";

type Tier = "trial" | "starter" | "pro";

interface Side { allowed: boolean; monthly_limit: number | null }
interface Feature {
  key: string; label: string; availability: "live" | "planned";
  trial: Side; starter: Side; pro: Side;
  included: boolean; monthly_limit: number | null;
}
interface Entitlements { effective_tier: Tier; features: Feature[] }

const TIER_LABEL: Record<Tier, string> = {
  trial: "Free trial", starter: "Starter", pro: "Pro",
};

function cell(side: Side) {
  if (!side.allowed) return "—";
  return side.monthly_limit === null ? "✓" : `${side.monthly_limit}/mo`;
}

/** A capped feature has to say so, or the only difference between the plans is
 *  invisible. Mirrors featureBullet() on the web. */
function bullet(label: string, side: Side): string {
  return side.monthly_limit === null ? label : `${label} — ${side.monthly_limit} a month`;
}

/** "a, b and c" — an Oxford-comma-free list, because these are read aloud. */
function sentence(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Lowercase the first letter only — a blanket toLowerCase turns "(OCR)" into
 *  "(ocr)". Same rule as lower() on the web. */
function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

interface PlanPrice { plan: "starter" | "pro"; period: "monthly" | "yearly"; amount_kobo: number }
interface Sub {
  plan: "starter" | "pro"; status: string; billing_period: "monthly" | "yearly"; amount_kobo: number;
  trial_ends_at: string | null; current_period_end: string | null; pending_plan: string | null;
  pending_plan_effective_at: string | null;
}
interface Loaded {
  ent: Entitlements;
  plans: PlanPrice[];
  addons: { key: string; name: string; monthly_kobo: number }[];
  sub: Sub | null;
  renewal: { show?: boolean; days_remaining?: number; expired?: boolean; can_renew?: boolean; plan?: "starter" | "pro"; billing_period?: "monthly" | "yearly"; paid_addon_keys?: string[]; unavailable_addons?: string[] } | null;
}

function dateText(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "";
}

export default function PricingScreen() {
  const nav = useNavigation<{ navigate: (n: string) => void }>();
  const { orgId } = useOrg();
  const { loading, refreshing, error, data, reload, onRefresh } =
    useOrgData<Loaded>(async (supabase, id) => {
      const [entR, priceR, subR, renR] = await Promise.all([
        supabase.rpc("plan_entitlements", { target_org: id }),
        supabase.rpc("public_pricing"),
        supabase.from("subscriptions")
          .select("plan,status,billing_period,amount_kobo,trial_ends_at,current_period_end,pending_plan,pending_plan_effective_at")
          .eq("org_id", id).in("status", ["trialing", "active", "past_due"]).limit(1),
        supabase.rpc("renewal_status", { target_org: id }),
      ]);
      if (entR.error) throw new Error(entR.error.message);
      const pr = priceR.data as { plans?: PlanPrice[]; addons?: Loaded["addons"] } | null;
      return {
        ent: entR.data as Entitlements,
        plans: pr?.plans ?? [],
        addons: pr?.addons ?? [],
        sub: ((subR.data ?? [])[0] as Sub | undefined) ?? null,
        renewal: (renR.data as Loaded["renewal"]) ?? null,
      };
    });

  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const pending = useRef<string | null>(null);

  const verify = useCallback(async () => {
    const ref = pending.current;
    if (!ref) return;
    setBusy(true);
    try {
      const out = await settle(ref);
      setNote(settleMessage(out));
      // Keep asking only while the bank has not answered; stop on a final outcome.
      if (out.settled || !out.reason.includes("pending")) pending.current = null;
      if (out.settled) reload();
    } catch (e) {
      setReauth(isReauth(e));
      setNote(e instanceof Error ? e.message : "Could not check the payment.");
    } finally { setBusy(false); }
  }, [reload]);

  // Coming back from the payment page: verify with the server, never assume.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void verify(); });
    return () => sub.remove();
  }, [verify]);

  const pay = useCallback(async (plan: "starter" | "pro", per: "monthly" | "yearly", modules?: string[]) => {
    if (!orgId || busy) return;
    setBusy(true); setNote(null); setReauth(false);
    try {
      const r = await startCheckout(orgId, plan, per, modules);
      if (!r.ok) { setNote(r.message ?? "Could not start payment."); return; }
      pending.current = r.reference ?? null;
      setNote("Complete the payment in your browser, then return to RevoPass. We will confirm it with the bank.");
    } catch (e) {
      setReauth(isReauth(e));
      setNote(e instanceof Error ? e.message : "Could not start payment.");
    } finally { setBusy(false); }
  }, [orgId, busy]);

  const planChange = useCallback(async (kind: "downgrade" | "cancel") => {
    setBusy(true); setNote(null);
    try {
      const c = await getClient();
      const { data: res, error: err } = kind === "downgrade"
        ? await c.rpc("request_plan_change", { p_plan: "starter" })
        : await c.rpc("cancel_plan_change");
      if (err) throw new Error(err.message);
      setNote((res as { message?: string } | null)?.message ?? "Done.");
      reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "The change could not be made.");
    } finally { setBusy(false); }
  }, [reload]);

  if (loading) return <Loading label="Loading plans…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data) return <ErrorView message="No plan information available" />;
  const { ent, plans, addons, sub, renewal } = data;

  const priceOf = (plan: "starter" | "pro", per: "monthly" | "yearly") =>
    plans.find((p) => p.plan === plan && p.period === per)?.amount_kobo ?? null;
  const priceText = (plan: "starter" | "pro") => {
    const m = priceOf(plan, "monthly"); const y = priceOf(plan, "yearly");
    // The saving is arithmetic on the two database prices (12 months vs the yearly price), as on the web.
    const saving = m != null && y != null && m * 12 > y ? ` (save ${formatNaira(m * 12 - y)})` : "";
    return [m != null ? `${formatNaira(m)} / month` : null, y != null ? `${formatNaira(y)} yearly${saving}` : null]
      .filter(Boolean).join(" · ") || "Price unavailable";
  };

  // A trial row says plan = pro; paying for a plan is a different thing.
  const paying = sub && sub.status !== "trialing" && sub.amount_kobo > 0 ? sub : null;
  const currentLabel = sub?.status === "trialing" ? "Free trial" : TIER_LABEL[ent.effective_tier];
  const subtitle = sub?.status === "trialing"
    ? `Free trial${sub.trial_ends_at ? ` · ends ${dateText(sub.trial_ends_at)}` : ""}`
    : `You are on ${currentLabel}${paying?.current_period_end ? ` · paid to ${dateText(paying.current_period_end)}` : ""}`
      + (sub?.status === "past_due" ? " · payment overdue" : "");

  const live = ent.features.filter((f) => f.availability === "live");
  const starterList = sentence(live.filter((f) => f.starter.allowed).map((f) => lower(bullet(f.label, f.starter))));
  const proList = sentence(
    live.filter((f) => f.pro.allowed && (!f.starter.allowed || f.starter.monthly_limit !== f.pro.monthly_limit))
      .map((f) => (f.starter.allowed ? `unlimited ${lower(f.label)}` : lower(f.label))),
  );

  const planButton = (plan: "starter" | "pro") => {
    if (!CHECKOUT_ENABLED) return null;
    const price = priceOf(plan, period);
    const isCurrent = paying?.plan === plan && paying.billing_period === period && paying.status === "active";
    const label = isCurrent ? "Current plan"
      : price == null ? "Unavailable"
      : paying ? `${paying.plan === "starter" && plan === "pro" ? "Upgrade" : "Switch"} to ${TIER_LABEL[plan]} · ${formatNaira(price)}`
      : `Subscribe to ${TIER_LABEL[plan]} · ${formatNaira(price)}`;
    const disabled = isCurrent || price == null || busy;
    return (
      <Pressable
        accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
        onPress={() => Alert.alert(`${TIER_LABEL[plan]} ${period}`,
          `You will be taken to a secure payment page to pay ${formatNaira(price ?? 0)}. Your plan changes only after the payment is confirmed.`,
          [{ text: "Cancel", style: "cancel" }, { text: "Continue to payment", onPress: () => void pay(plan, period) }])}
        style={({ pressed }) => [s.cta, disabled && s.ctaOff, pressed && { opacity: 0.8 }]}
      >
        <Text style={[s.ctaText, disabled && { color: C.text3 }]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Pricing Plan" subtitle={subtitle} />

      {note ? <Card title="Payment"><Text style={u.rowMeta}>{note}</Text>
        {reauth ? <Pressable onPress={() => void signOut()} style={({ pressed }) => [s.cta, { marginTop: 10 }, pressed && { opacity: 0.8 }]} accessibilityRole="button"><Text style={s.ctaText}>Sign in again</Text></Pressable> : null}
        {pending.current ? (
          <Pressable disabled={busy} onPress={() => void verify()} style={({ pressed }) => [s.cta, { marginTop: 10 }, pressed && { opacity: 0.8 }]}>
            <Text style={s.ctaText}>{busy ? "Checking…" : "I have paid — check status"}</Text>
          </Pressable>
        ) : null}
      </Card> : null}

      {CHECKOUT_ENABLED && renewal?.show && renewal.can_renew ? (
        <Card title="Renew subscription" subtitle={renewal.expired ? "Your subscription has expired" : `Expires in ${renewal.days_remaining ?? "a few"} days`}>
          <Pressable disabled={busy} onPress={() => {
            // Same package as the web's Renew Now: the server re-prices the paid setup.
            if (!renewal.plan) return;
            if ((renewal.unavailable_addons ?? []).length > 0) { setNote("One of your add-ons is not available right now. Contact support to renew."); return; }
            const keys = renewal.plan === "pro" ? [...(renewal.paid_addon_keys ?? []), "pos"] : [...(renewal.paid_addon_keys ?? [])];
            void pay(renewal.plan, renewal.billing_period ?? "monthly", keys);
          }} style={({ pressed }) => [s.cta, pressed && { opacity: 0.8 }]}>
            <Text style={s.ctaText}>Renew now</Text>
          </Pressable>
        </Card>
      ) : null}

      <View style={s.toggle}>
        {(["monthly", "yearly"] as const).map((p) => (
          <Pressable key={p} onPress={() => setPeriod(p)} style={[s.toggleBtn, period === p && s.toggleOn]}>
            <Text style={[s.toggleText, period === p && { color: "#fff" }]}>{p === "monthly" ? "Monthly" : "Yearly"}</Text>
          </Pressable>
        ))}
      </View>

      <Card title="Starter" subtitle={priceText("starter")}>
        <Text style={u.rowMeta}>{starterList}.</Text>
        {planButton("starter")}
      </Card>

      <Card title="Pro" subtitle={priceText("pro")}>
        <Text style={u.rowMeta}>
          {proList ? `Everything in Starter, plus ${proList}.` : "Everything in Starter. Pro does not yet include anything Starter does not."}
        </Text>
        {planButton("pro")}
      </Card>

      {sub?.pending_plan ? (
        <Card title="Scheduled change" subtitle={`Moving to ${TIER_LABEL[sub.pending_plan as Tier] ?? sub.pending_plan} on ${dateText(sub.pending_plan_effective_at)}`}>
          <Pressable disabled={busy} onPress={() => void planChange("cancel")} style={s.linkBtn}><Text style={s.linkText}>Cancel scheduled change</Text></Pressable>
        </Card>
      ) : CHECKOUT_ENABLED && paying?.plan === "pro" ? (
        <Pressable disabled={busy} onPress={() => Alert.alert("Downgrade to Starter",
          "Starter takes effect at the end of the period you have paid for. You keep Pro until then.",
          [{ text: "Keep Pro", style: "cancel" }, { text: "Schedule downgrade", style: "destructive", onPress: () => void planChange("downgrade") }])}
          style={s.linkBtn}><Text style={s.linkText}>Downgrade to Starter</Text></Pressable>
      ) : null}

      <Card title="Industry add-ons" subtitle="Added to the Pro plan">
        {addons.map((a) => (
          <View key={a.key} style={s.row}>
            <Text style={[u.rowTitle, { flex: 1 }]}>{a.name}</Text>
            <Text style={u.rowMeta}>+ {formatNaira(a.monthly_kobo)} / month</Text>
          </View>
        ))}
        <Text style={[u.rowMeta, { marginTop: 8 }]}>Pick your industry modules to see the combined plan + add-on total (monthly or yearly) and pay once.</Text>
        <Pressable onPress={() => nav.navigate("Modules")} style={({ pressed }) => [s.cta, pressed && { opacity: 0.8 }]} accessibilityRole="button">
          <Text style={s.ctaText}>Choose industry modules</Text>
        </Pressable>
      </Card>

      <Card title="Enterprise" subtitle="Custom pricing">
        <Text style={u.rowMeta}>For multi-industry, advanced multi-branch and larger operations. Contact support@revopass.ng.</Text>
      </Card>

      <Card title="Compare" subtitle="Starter vs Pro">
        <View style={[s.row, s.head]}>
          <Text style={[s.feat, s.headText]}>Feature</Text>
          <Text style={[s.col, s.headText]}>Starter</Text>
          <Text style={[s.col, s.headText]}>Pro</Text>
        </View>
        {live.map((f) => (
          <View key={f.key} style={s.row}>
            <View style={s.feat}><Text style={u.rowTitle}>{f.label}</Text></View>
            <Text style={[s.col, { color: f.starter.allowed ? C.text : C.text3 }]}>{cell(f.starter)}</Text>
            <Text style={[s.col, { color: f.pro.allowed ? C.success : C.text3 }]}>{cell(f.pro)}</Text>
          </View>
        ))}
      </Card>

      <Text style={[u.rowMeta, { textAlign: "center", marginBottom: 10, lineHeight: 18 }]}>
        {CHECKOUT_ENABLED
          ? "Payments run through Squad on a secure page. Your plan activates only after the payment is confirmed."
          : "Subscriptions are not bought inside this app. Prices are shown for reference."}
      </Text>
      <Text style={u.footer}>© 2026 Revo Space Enterprise Ltd.</Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.border2, marginTop: 4,
  },
  head: { borderTopWidth: 0, marginTop: 8 },
  headText: { fontSize: 10.5, fontWeight: "700", color: C.text2, textTransform: "uppercase", letterSpacing: 0.4 },
  feat: { flex: 1 },
  cta: { marginTop: 12, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  ctaOff: { backgroundColor: C.border2 },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  toggle: { flexDirection: "row", alignSelf: "center", backgroundColor: C.border2, borderRadius: 12, padding: 3, marginBottom: 12 },
  toggleBtn: { paddingVertical: 8, paddingHorizontal: 22, borderRadius: 10 },
  toggleOn: { backgroundColor: C.primary },
  toggleText: { fontWeight: "700", fontSize: 13, color: C.text2 },
  linkBtn: { alignSelf: "center", paddingVertical: 10, marginBottom: 8 },
  linkText: { color: C.primary, fontWeight: "600", fontSize: 13 },
  col: { width: 62, textAlign: "center", fontSize: 12.5, fontWeight: "600" },
});
