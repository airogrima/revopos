import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { authenticate, getBiometricSupport, isBiometricLockEnabled } from "../lib/biometrics";
import { signOut } from "../lib/supabase";
import { Logo } from "./ui";
import { C } from "../theme";

/**
 * Holds the app shut until the device owner is confirmed.
 *
 * Only when the user has turned the lock on — otherwise this renders its
 * children and gets out of the way, because a business that has not asked for a
 * lock must not be met by one.
 *
 * WHY IT COVERS RATHER THAN REDIRECTS
 *
 * The lock renders INSTEAD of the app, not on top of it. A modal over a live
 * screen still lets the screen underneath mount, query and render — the
 * dashboard's figures would be on screen behind the prompt, and a screenshot or
 * the app switcher would show them. Nothing below this renders until it opens.
 */
export default function BiometricGate({ children }: { children: ReactNode }) {
  /** null while we work out whether a lock even applies. */
  const [locked, setLocked] = useState<boolean | null>(null);
  const [prompting, setPrompting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [label, setLabel] = useState("biometrics");

  const prompt = useCallback(async (auto: boolean) => {
    setPrompting(true);
    setFailed(false);
    const ok = await authenticate("Unlock RevoPass");
    setPrompting(false);
    if (ok) setLocked(false);
    // A cancelled automatic prompt is not a failure worth shouting about — the
    // Unlock button is right there. A cancelled deliberate one gets the notice.
    else if (!auto) setFailed(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [enabled, support] = await Promise.all([
        isBiometricLockEnabled(),
        getBiometricSupport(),
      ]);
      if (cancelled) return;
      setLabel(support.label);

      /*
       * A lock that was switched on and then had its face or finger removed
       * from the device would otherwise be a locked app with no way in. If the
       * device can no longer authenticate, the lock does not apply.
       */
      if (!enabled || !support.available) { setLocked(false); return; }

      setLocked(true);
      void prompt(true);
    })();
    return () => { cancelled = true; };
  }, [prompt]);

  /*
   * Re-locks when the app has been away.
   *
   * Backgrounding is what happens when the phone is handed over or put down, so
   * coming back is exactly when the check is worth repeating — a lock that only
   * ran on a cold start would almost never run at all on a phone that keeps
   * apps alive for days.
   */
  const wasBackground = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") { wasBackground.current = true; return; }
      if (state === "active" && wasBackground.current) {
        wasBackground.current = false;
        void (async () => {
          const [enabled, support] = await Promise.all([
            isBiometricLockEnabled(),
            getBiometricSupport(),
          ]);
          if (!enabled || !support.available) return;
          setLocked(true);
          void prompt(true);
        })();
      }
    });
    return () => sub.remove();
  }, [prompt]);

  if (locked === null) {
    return (
      <View style={s.screen}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  if (!locked) return <>{children}</>;

  return (
    <View style={s.screen}>
      <Logo size={64} />
      <Text style={s.title}>RevoPass is locked</Text>
      <Text style={s.body}>
        Unlock with {label} to see your business.
      </Text>

      {failed ? (
        <Text style={s.failed}>That did not unlock. Try again.</Text>
      ) : null}

      <Pressable
        style={({ pressed }) => [s.button, (prompting || pressed) && { opacity: 0.75 }]}
        onPress={() => void prompt(false)}
        disabled={prompting}
      >
        {prompting
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.buttonText}>Unlock</Text>}
      </Pressable>

      {/*
        A way out that is not the biometric.
        Someone whose face will not scan, or who has picked up the wrong phone,
        needs an exit that is not "force quit the app". Signing out clears the
        stored session, so the next person in needs the password — which makes
        this the safe escape hatch rather than a way around the lock.
      */}
      <Pressable style={s.secondary} onPress={() => { void signOut(); }}>
        <Text style={s.secondaryText}>Sign out instead</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1, backgroundColor: C.bg,
    alignItems: "center", justifyContent: "center", padding: 32, gap: 6,
  },
  title: { fontSize: 20, fontWeight: "700", color: C.text, marginTop: 18 },
  body: { fontSize: 14, color: C.text2, textAlign: "center", lineHeight: 20, marginTop: 4 },
  failed: { fontSize: 13, color: C.danger, marginTop: 12, textAlign: "center" },
  button: {
    backgroundColor: C.forest, borderRadius: 12, minHeight: 52,
    alignItems: "center", justifyContent: "center",
    alignSelf: "stretch", marginTop: 24,
  },
  buttonText: { color: "#fff", fontSize: 15.5, fontWeight: "600" },
  secondary: { minHeight: 44, justifyContent: "center", marginTop: 6 },
  secondaryText: { color: C.text2, fontSize: 14, fontWeight: "600" },
});
