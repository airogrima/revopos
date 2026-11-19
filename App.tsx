/**
 * App root and session gate.
 *
 * This file used to BE the app — a single 334-line dashboard screen. That
 * dashboard now lives in screens/DashboardScreen.tsx as one tab of several, and
 * this file mounts either the navigator or the sign-in screen depending on
 * whether anyone is signed in.
 *
 * The gate lives here, above the navigator, rather than as a route inside it.
 * A signed-out person then has no navigator at all, so there is no tab bar to
 * tap and no back gesture that lands on a screen expecting a session. It also
 * means every screen below can assume getClient() succeeds.
 *
 * SafeAreaProvider wraps everything because the tab bar and every screen's
 * padding are derived from the device's insets. Without it, useSafeAreaInsets
 * returns zeroes and content sits under the notch and the home indicator.
 */

import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { Session } from "@supabase/supabase-js";
import RootNavigation from "./navigation";
import AuthScreen from "./screens/AuthScreen";
import { supabase } from "./lib/supabase";
import { OrgProvider } from "./lib/org";
import { TerminalProvider } from "./lib/terminal";
import ErrorBoundary from "./components/ErrorBoundary";
import BiometricGate from "./components/BiometricGate";
import OnboardingSlides from "./components/OnboardingSlides";
import { hasSeenOnboarding, markOnboardingSeen, onOnboardingRequested } from "./lib/onboarding";
import { C } from "./theme";

export default function App() {
  /*
   * `undefined` means "still reading the keychain", which is different from
   * `null` meaning "definitely signed out". Collapsing the two would flash the
   * sign-in screen on every cold start before the stored session loads, which
   * reads as having been logged out.
   */
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  /*
   * The welcome slides. `seen` is undefined until the device flag is read, so
   * the first frame is the same spinner as the session read: no flash of the
   * sign-in screen before the slides. A person who is ALREADY signed in when
   * this ships is not shown them (they have clearly onboarded); they can open
   * them from Settings instead.
   */
  const [seen, setSeen] = useState<boolean | undefined>(undefined);
  const [replay, setReplay] = useState(false);
  useEffect(() => { void hasSeenOnboarding().then(setSeen); }, []);
  useEffect(() => onOnboardingRequested(() => setReplay(true)), []);
  useEffect(() => { if (seen === false && session) { setSeen(true); void markOnboardingSeen(); } }, [seen, session]);
  const finishTour = () => { setSeen(true); setReplay(false); void markOnboardingSeen(); };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    /*
     * The listener covers what the initial read cannot: a token refresh that
     * fails because the refresh token was revoked, a sign-out, and a sign-in
     * from the auth screen. Without it a revoked session would leave the app
     * sitting on a dashboard whose every query fails.
     */
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined || seen === undefined) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.primary} />
        </View>
      </SafeAreaProvider>
    );
  }

  if (replay || (seen === false && !session)) {
    return <SafeAreaProvider><OnboardingSlides onDone={finishTour} /></SafeAreaProvider>;
  }
  return (
    <SafeAreaProvider>
      {session
        /*
         * OrgProvider sits inside the gate so it only resolves once there is a
         * session to resolve it with, and the boundary wraps the navigator so a
         * render error in one screen does not blank the whole app.
         */
        /*
         * BiometricGate sits INSIDE the session gate and OUTSIDE the
         * navigator. Inside, because there is nothing to lock until somebody
         * is signed in — a locked sign-in screen protects nothing. Outside,
         * because no screen should mount and start querying the business's
         * figures until the device owner has been confirmed.
         */
        ? <ErrorBoundary><BiometricGate><OrgProvider><TerminalProvider><RootNavigation /></TerminalProvider></OrgProvider></BiometricGate></ErrorBoundary>
        /*
         * onSignedIn is a no-op rather than the thing that flips the gate:
         * onAuthStateChange already fires on sign-in, and setting state from
         * both would render twice.
         */
        : <AuthScreen onSignedIn={() => {}} />}
    </SafeAreaProvider>
  );
}
