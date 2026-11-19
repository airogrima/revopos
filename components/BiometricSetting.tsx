import { useEffect, useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import {
  authenticate, getBiometricSupport, isBiometricLockEnabled, setBiometricLockEnabled,
  type BiometricSupport,
} from "../lib/biometrics";
import { Card } from "./ui";
import { C } from "../theme";

/**
 * The switch that turns the lock on.
 *
 * Off by default and never turned on for anybody: a lock the user did not ask
 * for is a lock they will meet unexpectedly, possibly in front of a customer.
 *
 * Turning it ON asks for the biometric first. That is not ceremony — it is the
 * only way to find out that the thing works on this device BEFORE it stands
 * between the user and their invoices. A switch that enabled a broken lock
 * would be discovered at the next cold start, with no way in.
 *
 * Turning it OFF does not ask. Requiring a face to REMOVE a lock is how someone
 * whose sensor has stopped working gets stuck with it, and there is nothing to
 * protect: the app is already unlocked and open in their hand.
 */
export default function BiometricSetting() {
  const [support, setSupport] = useState<BiometricSupport | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, on] = await Promise.all([getBiometricSupport(), isBiometricLockEnabled()]);
      if (cancelled) return;
      setSupport(s);
      setEnabled(on);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!support) return null;

  const title = "Screen lock";

  /*
   * A device with a sensor but nothing enrolled is told what to do about it.
   * A device with no sensor is told plainly, once, rather than being shown a
   * switch that cannot move.
   */
  if (!support.available) {
    return (
      <Card title={title}>
        <Text style={s.body}>
          {support.hardwareOnly
            ? `This phone supports ${support.label}, but none is set up yet. Add one in the phone's own settings and it will be offered here.`
            : "This phone does not support a fingerprint or face unlock."}
        </Text>
      </Card>
    );
  }

  const toggle = async (next: boolean) => {
    if (!next) {
      setBusy(true);
      await setBiometricLockEnabled(false);
      setEnabled(false);
      setBusy(false);
      return;
    }

    setBusy(true);
    const ok = await authenticate(`Turn on ${support.label} for RevoPass`);
    if (ok) {
      await setBiometricLockEnabled(true);
      setEnabled(true);
    } else {
      Alert.alert(
        "Not turned on",
        `RevoPass could not confirm your ${support.label}, so the lock has been left off.`,
      );
    }
    setBusy(false);
  };

  return (
    <Card title={title}>
      <View style={s.row}>
        <View style={{ flex: 1, paddingRight: 14 }}>
          <Text style={s.label}>Unlock with {support.label}</Text>
          <Text style={s.body}>
            Ask for {support.label} when RevoPass opens, so someone holding your
            unlocked phone cannot read your invoices.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(v) => void toggle(v)}
          disabled={busy}
          trackColor={{ true: C.primary, false: C.border2 }}
        />
      </View>

      {enabled ? (
        <Text style={s.note}>
          This locks the app on this phone. It is not a second password — your
          account is still protected by the one you sign in with.
        </Text>
      ) : null}
    </Card>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  label: { fontSize: 14, fontWeight: "600", color: C.text, marginBottom: 3 },
  body: { fontSize: 12.5, color: C.text2, lineHeight: 18 },
  note: { fontSize: 11.5, color: C.text3, lineHeight: 17, marginTop: 12 },
});
