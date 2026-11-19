import { useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { formatNaira, parseNaira } from "@revopass/core";
import { getClient, isAuthFailure, signOut } from "../lib/supabase";
import { C } from "../theme";
import { u } from "./ui";

/**
 * Record a payment against an invoice, from the phone.
 *
 * This is the first thing the mobile app can DO rather than merely display.
 * It was chosen over creating an invoice because it is what actually happens
 * away from a desk: the customer pays in the shop, and the record needs making
 * before it is forgotten.
 *
 * It calls public.record_payment — the same function the web now uses — rather
 * than writing to `payments` directly. A direct write would skip the
 * draft/due-date handling and hit a check constraint, which is a bug this
 * project has already had once.
 *
 * Amounts are parsed with core's parseNaira, so "25,000" and "25000.50" both
 * become integer kobo and nothing is ever a float.
 */

const METHODS = ["cash", "transfer", "card", "pos", "ussd", "cheque"] as const;

export default function RecordPaymentSheet({
  invoice, onClose, onRecorded,
}: {
  invoice: { id: string; number: string; balance_kobo: number; customerName: string } | null;
  onClose: () => void;
  /** Called after a successful write so the list can refetch. */
  onRecorded: (message: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to the full balance — the common case is paying the invoice off.
  useEffect(() => {
    if (invoice) {
      setAmount(invoice.balance_kobo > 0 ? String(invoice.balance_kobo / 100) : "");
      setMethod("cash");
      setReference("");
      setError(null);
    }
  }, [invoice]);

  if (!invoice) return null;

  const parsed = parseNaira(amount);
  const overpaying = parsed !== null && parsed > invoice.balance_kobo;

  const submit = async () => {
    setError(null);

    if (parsed === null || parsed <= 0) {
      setError("Enter the amount received, for example 25,000.");
      return;
    }

    setBusy(true);
    try {
      const supabase = await getClient();
      const { data, error: rpcError } = await supabase.rpc("record_payment", {
        p_document_id: invoice.id,
        p_amount_kobo: parsed,
        p_paid_on: new Date().toISOString().slice(0, 10),
        p_method: method,
        p_reference: reference.trim() || null,
      });

      if (rpcError) throw new Error(rpcError.message);

      const result = data as { ok?: boolean; message?: string } | null;
      if (!result?.ok) {
        // The function returns refusals as values, not exceptions, and its
        // messages are already written for a shop owner.
        setError(result?.message ?? "The payment could not be recorded.");
        return;
      }

      onRecorded(result.message ?? "Payment recorded.");
      onClose();
    } catch (e) {
      if (isAuthFailure(e)) { void signOut(); return; }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Tapping the dimmed area closes, which is the gesture people expect
            of a sheet. The sheet itself swallows the tap. */}
        <Pressable style={s.backdropFill} onPress={busy ? undefined : onClose} />

        <View style={s.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={s.title}>Record payment</Text>
            <Text style={s.sub}>
              {invoice.number} · {invoice.customerName}
            </Text>
            <Text style={s.balance}>
              {formatNaira(invoice.balance_kobo)} outstanding
            </Text>

            {error && (
              <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
            )}

            <Text style={s.label}>Amount received</Text>
            <TextInput
              style={s.input}
              value={amount}
              onChangeText={setAmount}
              placeholder="e.g. 25,000"
              placeholderTextColor={C.text3}
              keyboardType="decimal-pad"
              editable={!busy}
            />
            {overpaying && (
              <Text style={s.warn}>
                That is more than the {formatNaira(invoice.balance_kobo)} outstanding.
                Recording it will leave the invoice overpaid.
              </Text>
            )}

            <Text style={s.label}>How was it paid?</Text>
            <View style={s.methods}>
              {METHODS.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setMethod(m)}
                  disabled={busy}
                  style={[s.method, method === m && s.methodActive]}
                >
                  <Text style={[s.methodText, method === m && s.methodTextActive]}>{m}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>Reference (optional)</Text>
            <TextInput
              style={s.input}
              value={reference}
              onChangeText={setReference}
              placeholder="Teller number, transfer ref…"
              placeholderTextColor={C.text3}
              editable={!busy}
            />

            <Pressable
              style={({ pressed }) => [s.primary, (busy || pressed) && { opacity: 0.75 }]}
              onPress={submit}
              disabled={busy}
            >
              {busy
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.primaryText}>Record payment</Text>}
            </Pressable>

            <Pressable style={s.cancel} onPress={onClose} disabled={busy}>
              <Text style={s.cancelText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  backdropFill: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(16,24,40,0.45)" },
  sheet: {
    backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 22, maxHeight: "88%",
  },
  title: { fontSize: 19, fontWeight: "700", color: C.text },
  sub: { fontSize: 13.5, color: C.text2, marginTop: 2 },
  balance: { fontSize: 15, fontWeight: "600", color: C.primary, marginTop: 8, marginBottom: 6 },
  label: { fontSize: 12, fontWeight: "600", color: C.text2, marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: C.border2,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, color: C.text,
  },
  methods: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  method: {
    paddingHorizontal: 14, minHeight: 44, justifyContent: "center",
    borderRadius: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: C.border2,
  },
  methodActive: { backgroundColor: C.forest, borderColor: C.forest },
  methodText: { fontSize: 13.5, color: C.text2, textTransform: "capitalize" },
  methodTextActive: { color: "#fff", fontWeight: "600" },
  primary: {
    backgroundColor: C.forest, borderRadius: 12, minHeight: 50,
    alignItems: "center", justifyContent: "center", marginTop: 22,
  },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  cancel: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 6, marginBottom: 8 },
  cancelText: { color: C.text2, fontSize: 14.5 },
  errorBox: { backgroundColor: "#FEE4E2", borderRadius: 10, padding: 12, marginTop: 12 },
  errorText: { color: C.text, fontSize: 13, lineHeight: 19 },
  warn: { color: C.warning, fontSize: 12.5, marginTop: 6, lineHeight: 18 },
});
