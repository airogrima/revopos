/**
 * Subscription lockout on the phone — the same rule as the web.
 *
 * public.my_access_locked() is true when a PAID subscription is past its
 * paid-through date and no Super Admin override is on (trials, free Starter and
 * the grace period are never locked). While locked, everything except the plan
 * screen and signing out is closed, as on the web.
 * It unlocks when the server settles a verified payment, never on the phone's
 * say-so. A failed check (offline) does not lock anyone out.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getClient, signOut } from "../lib/supabase";
import { C } from "../theme";
import PricingScreen from "../screens/PricingScreen";

export default function LockGate({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  const insets = useSafeAreaInsets();

  const check = useCallback(async () => {
    try {
      const c = await getClient();
      const { data, error } = await c.rpc("my_access_locked");
      if (!error) setLocked(data === true);
    } catch { /* offline or signed out: leave the state as it was */ }
  }, []);

  useEffect(() => {
    void check();
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void check(); });
    return () => sub.remove();
  }, [check]);

  // While locked, re-check regularly so a confirmed payment opens the app again.
  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => void check(), 15000);
    return () => clearInterval(t);
  }, [locked, check]);

  if (!locked) return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <View style={s.banner}>
        <Text style={s.title}>Your subscription has expired</Text>
        <Text style={s.body}>Your data is safe and nothing has been deleted. The business opens again as soon as the subscription is active.</Text>
        <Pressable onPress={() => void signOut()} hitSlop={8}><Text style={s.link}>Sign out</Text></Pressable>
      </View>
      <PricingScreen />
    </View>
  );
}

const s = StyleSheet.create({
  banner: { marginHorizontal: 16, marginTop: 8, padding: 14, borderRadius: 14, backgroundColor: "#FEF0C7" },
  title: { fontSize: 15, fontWeight: "700", color: C.text },
  body: { fontSize: 13, color: C.text2, marginTop: 4, lineHeight: 18 },
  link: { color: C.primary, fontWeight: "700", marginTop: 8, fontSize: 13 },
});
