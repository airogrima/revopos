/**
 * Settings — business profile and tax are editable by owners and admins (see SettingsEditor).
 *
 * The web app edits these through server actions (updateBusinessProfile,
 * updateTaxSettings) which validate rates, convert percentages to basis points
 * and re-check permissions. Mobile has no server actions; editing here would
 * mean writing straight to PostgREST and reimplementing that validation a
 * second time, where it could drift. A tax rate saved wrong on the phone would
 * silently mis-charge VAT on every subsequent invoice.
 *
 * So this screen shows the settings and says where to change them. Editing is
 * worth adding once there is a shared validation path, not before.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { requestOnboarding } from "../lib/onboarding";
import { useNavigation } from "@react-navigation/native";
import { Icon } from "../components/kit";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getClient, signOut } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { C } from "../theme";
import { Card, ErrorView, Loading, Screen, ScreenTitle, u } from "../components/ui";
import BiometricSetting from "../components/BiometricSetting";
import DeleteAccount from "../components/DeleteAccount";
import ReferralCard from "../components/ReferralCard";
import SettingsEditor, { useToast } from "../components/SettingsEditor";
import { usePermissions } from "../lib/perms";
import BankAccountsCard from "../components/BankAccountsCard";

/** The web app hosts the legal pages; the same base the password reset uses. */
const LEGAL_BASE = process.env.EXPO_PUBLIC_APP_URL ?? "https://revopass.revospace.ng";

interface Org {
  name: string; legal_name: string | null;
  business_type: string | null; state: string | null;
  address: string | null; email: string | null; phone: string | null;
  tin: string | null; vat_registered: boolean; vat_number: string | null;
  vat_rate_bps: number; default_wht_rate_bps: number;
  currency: string; document_footer: string | null; logo_url: string | null;
}

/** Basis points to a percentage string: 750 -> "7.5%". */
function bpsToPct(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, "")}%`;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={u.listRow}>
      <Text style={[u.rowMeta, { flex: 1 }]}>{label}</Text>
      <Text style={[u.rowTitle, { flex: 1.4, textAlign: "right" }]} numberOfLines={2}>
        {value && value.trim() !== "" ? value : "—"}
      </Text>
    </View>
  );
}

function LinkRow({ icon, tint, label, meta, onPress }: { icon: string; tint: string; label: string; meta: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [lr.row, pressed && { opacity: 0.6 }]} accessibilityRole="button">
      <View style={[lr.icon, { backgroundColor: tint + "22" }]}><Icon name={icon} size={20} color={tint} /></View>
      <View style={{ flex: 1 }}>
        <Text style={lr.label}>{label}</Text>
        <Text style={lr.meta}>{meta}</Text>
      </View>
      <Icon name="right" size={18} color={C.text3} />
    </Pressable>
  );
}

export default function SettingsScreen() {
  const nav = useNavigation<{ navigate: (n: string) => void }>();
  const scroll = useRef<ScrollView>(null);
  const ys = useRef<Record<string, number>>({});
  const mark = (k: string) => ({ onLayout: (e: { nativeEvent: { layout: { y: number } } }) => { ys.current[k] = e.nativeEvent.layout.y; } });
  const jump = (k: string) => scroll.current?.scrollTo({ y: Math.max(0, (ys.current[k] ?? 0) - 8), animated: true });
  const { loading, refreshing, error, data: raw, reload, onRefresh } =
    useOrgData<Org | null>(async (supabase, orgId) => {
      const { data, error: err } = await supabase
        .from("organizations")
        .select("name,legal_name,business_type,state,address,email,phone,tin,logo_url,vat_registered,vat_number,vat_rate_bps,default_wht_rate_bps,currency,document_footer")
        .limit(1);
      if (err) throw new Error(err.message);
      if (!data?.length) throw new Error("No organization visible to this user");
      return data[0] as Org;
    });
  const org = raw;
  const { orgId } = useOrg();
  const { perms } = usePermissions();
  const toast = useToast();

  if (loading) return <Loading label="Loading settings…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!org) return <ErrorView message="No organization found" />;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh} scrollRef={scroll}>
      <ScreenTitle title="Settings" subtitle={org.name} />

      <LinkRow icon="briefcase" tint="#2563EB" label="Business Profile" meta="Update business information" onPress={() => jump("profile")} />
      <LinkRow icon="home" tint="#F59E0B" label="Branches" meta="Manage your branches" onPress={() => nav.navigate("Branches")} />
      <LinkRow icon="users" tint="#16A34A" label="Staff & Roles" meta="Manage staff and permissions" onPress={() => nav.navigate("Staff")} />
      <LinkRow icon="gift" tint="#16A34A" label="Subscription" meta="View your plan" onPress={() => nav.navigate("Pricing")} />
      <LinkRow icon="users" tint="#7C3AED" label="Referral / Affiliate" meta="Share and earn rewards" onPress={() => jump("referral")} />
      <LinkRow icon="lock" tint="#F59E0B" label="Security" meta="Password and account security" onPress={() => jump("security")} />
      <LinkRow icon="help" tint="#2563EB" label="Help & Support" meta="Contact us, and app details" onPress={() => nav.navigate("Help")} />
      <LinkRow icon="layers" tint="#F97316" label="Show Welcome Tour" meta="View the onboarding slides" onPress={requestOnboarding} />
      <View style={{ height: 10 }} />

      <View {...mark("profile")}>
        {orgId ? <SettingsEditor org={org} orgId={orgId} canEdit={perms.manage} onSaved={(m) => { toast.show(m); reload(); }} /> : null}
      </View>

      <BankAccountsCard />

      <Card title="Documents">
        <Field label="Invoice footer" value={org.document_footer} />
      </Card>

      <View {...mark("security")}><BiometricSetting /></View>


      {/*
        Sign out lives here because Settings is where people look for it, and
        because the tab bar has no room for it.

        Confirmed first: signing out on a phone is easy to hit by accident, and
        on a shared or borrowed device the next sign-in needs a password the
        user may not have with them.
      */}
      <Pressable
        style={({ pressed }) => [so.button, pressed && { opacity: 0.7 }]}
        onPress={() =>
          Alert.alert(
            "Sign out?",
            "You will need your email and password to sign back in.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Sign out", style: "destructive", onPress: () => { void signOut(); } },
            ],
          )
        }
      >
        <Text style={so.text}>Sign out</Text>
      </Pressable>

      {/* Last on the page, after sign out — the same ordering the web settings
          page uses, and for the same reason: the most destructive control should
          be the one you have to travel furthest to reach. */}
      <View {...mark("referral")}><ReferralCard /></View>
      <Card title="Legal">
        <Pressable onPress={() => void Linking.openURL(`${LEGAL_BASE}/privacy`)}><Text style={u.rowTitle}>Privacy Policy</Text></Pressable>
        <Pressable style={{ marginTop: 12 }} onPress={() => void Linking.openURL(`${LEGAL_BASE}/terms`)}><Text style={u.rowTitle}>Terms of Service</Text></Pressable>
      </Card>
      <DeleteAccount />
      {toast.node}

      <Text style={u.footer}>© 2026 Revo Space Enterprise Ltd.</Text>
    </Screen>
  );
}

const so = StyleSheet.create({
  button: {
    backgroundColor: "#FEECEC", borderRadius: 14, paddingVertical: 15,
    alignItems: "center", marginBottom: 16,
  },
  text: { color: C.danger, fontSize: 16, fontWeight: "700" },
});

const lr = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, backgroundColor: "#fff",
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, borderWidth: 1, borderColor: C.border2,
  },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontWeight: "600", color: C.text },
  meta: { fontSize: 12, color: C.text2, marginTop: 2 },
});
