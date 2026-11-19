/**
 * Help & Support.
 *
 * This was locked behind a "Coming soon" chip because it contained nothing but
 * a placeholder — and locking it meant someone who needed help had no route to
 * any at all, which is the worst thing on the list to switch off.
 *
 * There is still no support-article system and this does not pretend
 * otherwise. What it gives is the two things a stuck user actually needs: a way
 * to reach a human, and the details that human asks for first.
 *
 * Contact routes come from the environment rather than being hardcoded. If
 * neither is configured the screen says plainly that in-app support is not set
 * up, instead of showing a button that opens nothing — a dead contact button is
 * worse than an honest absence when someone is already frustrated.
 */

import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { Card, EmptyState, Screen, ScreenTitle, u } from "../components/ui";
import { useOrg } from "../lib/org";
import { C } from "../theme";

const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? "";
/** Digits only, international format without the +, e.g. 2348012345678. */
const SUPPORT_WHATSAPP = process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP ?? "";

export default function HelpScreen() {
  const { orgName } = useOrg();

  const version = Constants.expoConfig?.version ?? "unknown";
  const build = Platform.select({
    ios: Constants.expoConfig?.ios?.buildNumber,
    android: Constants.expoConfig?.android?.versionCode?.toString(),
  }) ?? "—";

  /*
   * Attached to the message rather than requested in it. Every support
   * conversation opens by asking for these, and a user reading them back off a
   * screen gets them wrong.
   */
  const diagnostics = [
    `Business: ${orgName || "unknown"}`,
    `App: RevoPass ${version} (build ${build})`,
    `Platform: ${Platform.OS} ${Platform.Version}`,
  ].join("\n");

  const openEmail = () => {
    const subject = encodeURIComponent(`RevoPass support — ${orgName || "account"}`);
    const body = encodeURIComponent(`\n\n---\n${diagnostics}\n`);
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
  };

  const openWhatsApp = () => {
    const text = encodeURIComponent(`Hello, I need help with RevoPass.\n\n${diagnostics}`);
    /*
     * wa.me rather than a whatsapp:// URL: it works whether or not WhatsApp is
     * installed, falling back to the browser instead of failing silently. On a
     * support screen, silent failure is the one outcome to design out.
     */
    void Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP}?text=${text}`);
  };

  const hasContact = Boolean(SUPPORT_EMAIL || SUPPORT_WHATSAPP);

  return (
    <Screen>
      <ScreenTitle title="Help & Support" subtitle="Getting answers" />

      <Card title="Contact us">
        {hasContact ? (
          <View style={{ gap: 10 }}>
            {SUPPORT_WHATSAPP ? (
              <Pressable
                onPress={openWhatsApp}
                style={({ pressed }) => [s.action, pressed && { opacity: 0.7 }]}
              >
                <Text style={s.actionText}>Chat on WhatsApp</Text>
                <Text style={s.actionMetaLight}>Usually the fastest way to reach us</Text>
              </Pressable>
            ) : null}

            {SUPPORT_EMAIL ? (
              <Pressable
                onPress={openEmail}
                style={({ pressed }) => [s.actionGhost, pressed && { opacity: 0.7 }]}
              >
                <Text style={s.actionGhostText}>Email support</Text>
                <Text style={s.actionMeta}>{SUPPORT_EMAIL}</Text>
              </Pressable>
            ) : null}

            <Text style={s.note}>
              Your business name and app version are attached automatically, so
              you do not have to go looking for them.
            </Text>
          </View>
        ) : (
          <EmptyState
            title="In-app support is not set up yet"
            body="No support contact has been configured for this build. Help is available on the web app in the meantime."
          />
        )}
      </Card>

      {/* Version only. The platform and business rows were removed from the
          card, NOT from `diagnostics` — both still travel with a support
          message, where they are read by the person answering it rather than
          by the person asking. */}
      <Card title="App details">
        <Row label="Version" value={`${version} (build ${build})`} />
        <Text style={s.note}>
          Quote this if you report a problem — it says exactly which version you
          are running.
        </Text>
      </Card>

      <Text style={u.footer}>© 2026 Revo Space Enterprise Ltd.</Text>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={u.rowMeta}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  action: {
    backgroundColor: C.forest, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 16, minHeight: 44,
  },
  actionText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  actionMetaLight: { color: "rgba(4,33,15,0.75)", fontSize: 12.5, marginTop: 2 },
  actionGhost: {
    backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.border2,
    paddingVertical: 14, paddingHorizontal: 16, minHeight: 44,
  },
  actionGhostText: { color: C.text, fontSize: 15, fontWeight: "600" },
  actionMeta: { color: C.text3, fontSize: 12.5, marginTop: 2 },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    gap: 16, paddingVertical: 9,
  },
  rowValue: { color: C.text, fontSize: 13.5, fontWeight: "500", flexShrink: 1, textAlign: "right" },
  note: { color: C.text3, fontSize: 12, lineHeight: 18, marginTop: 10 },
});
