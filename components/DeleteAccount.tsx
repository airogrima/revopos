import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase, signOut } from "../lib/supabase";
import { Card } from "./ui";
import { C } from "../theme";

/**
 * Closing the account, from the phone.
 *
 * REQUIRED, not merely nice to have: App Store Review Guideline 5.1.1(v) says
 * an app that lets you create an account must let you delete it IN THE APP.
 * Sending the user to the website does not satisfy it, and a submission without
 * this is rejected.
 *
 * The work happens in the `delete-account` Edge Function rather than here,
 * because finishing the job means deleting the auth user, and that needs the
 * service-role key. That key cannot live in an Expo bundle — it bypasses every
 * RLS policy in the database and would ship to every device that installs the
 * app. So the phone sends its own token and the privileged half stays server-side.
 *
 * Deliberately awkward, exactly like the web version: everything else in
 * Settings is a one-tap edit, and this one closes the business and every invoice,
 * payment and receipt in it, with no undo the user can reach.
 */
export default function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const armed = typed.trim().toUpperCase() === "DELETE";

  const close = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        method: "POST",
      });

      if (error) {
        /*
         * The function returns its refusals as 400 with a message — a platform
         * admin being told to contact support, for instance. supabase-js turns a
         * non-2xx into `error`, so the body is read back rather than showing a
         * bare "FunctionsHttpError".
         */
        let message = "Your account could not be closed. Please try again.";
        const res = (error as { context?: Response }).context;
        if (res) {
          try {
            const body = await res.json();
            if (body?.message) message = body.message;
          } catch { /* keep the generic message */ }
        }
        Alert.alert("Not closed", message);
        return;
      }

      const result = data as { ok?: boolean; message?: string } | null;
      if (!result?.ok) {
        Alert.alert("Not closed", result?.message ?? "Your account could not be closed.");
        return;
      }

      /*
       * Signing out locally regardless. The auth user is gone server-side, so the
       * stored session is now a token for an account that does not exist —
       * leaving it in the keychain would show a signed-in shell whose every query
       * fails.
       */
      Alert.alert("Account closed", result.message ?? "Your account has been closed.");
      await signOut();
    } catch (e) {
      Alert.alert("Not closed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    Alert.alert(
      "Close your account?",
      "This closes your business and every invoice, payment and receipt in it. " +
        "You will be signed out and will not be able to sign in again.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Close account", style: "destructive", onPress: () => void close() },
      ],
    );
  };

  return (
    <Card title="Close your account">
      <Text style={s.body}>
        Closes your account and your business, including every invoice, payment,
        expense and receipt. If other people are members of your business, it
        stays open for them and you are simply removed from it.
      </Text>

      {!open ? (
        <Pressable
          style={({ pressed }) => [s.ghost, pressed && { opacity: 0.7 }]}
          onPress={() => setOpen(true)}
        >
          <Text style={s.ghostText}>Close account</Text>
        </Pressable>
      ) : (
        <View style={{ marginTop: 12 }}>
          <Text style={s.label}>Type DELETE to confirm</Text>
          <TextInput
            style={s.input}
            value={typed}
            onChangeText={setTyped}
            placeholder="DELETE"
            placeholderTextColor={C.text3}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
          />

          <View style={s.row}>
            <Pressable
              style={({ pressed }) => [s.ghost, { flex: 1 }, pressed && { opacity: 0.7 }]}
              onPress={() => { setOpen(false); setTyped(""); }}
              disabled={busy}
            >
              <Text style={s.ghostText}>Cancel</Text>
            </Pressable>

            {/* Armed only on the exact word, so it cannot be hit early. */}
            <Pressable
              style={({ pressed }) => [
                s.danger, { flex: 1 },
                (!armed || busy) && { opacity: 0.45 },
                pressed && { opacity: 0.7 },
              ]}
              onPress={confirm}
              disabled={!armed || busy}
            >
              {busy
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.dangerText}>Close my account</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  body: { fontSize: 12.5, color: C.text2, lineHeight: 18 },
  label: { fontSize: 12.5, fontWeight: "600", color: C.text2, marginBottom: 6 },
  input: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: C.border2,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, color: C.text, minHeight: 48,
  },
  row: { flexDirection: "row", gap: 10, marginTop: 12 },
  ghost: {
    backgroundColor: "#fff", borderRadius: 12, minHeight: 48,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.border2, marginTop: 12,
  },
  ghostText: { color: C.text2, fontSize: 15, fontWeight: "600" },
  danger: {
    backgroundColor: C.danger, borderRadius: 12, minHeight: 48,
    alignItems: "center", justifyContent: "center", marginTop: 12,
  },
  dangerText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
