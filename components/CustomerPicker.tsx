import { useMemo, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { getClient, isAuthFailure, signOut } from "../lib/supabase";
import { C } from "../theme";

/**
 * Choosing who an invoice is for.
 *
 * This was a wrapped row of chips — every customer on screen at once. That is
 * fine for the three a new business has and unusable for the eighty it has
 * later: the row grows without limit, pushes the actual invoice off the screen,
 * and offers no way to find a name except reading all of them. A dropdown costs
 * one tap and does not grow.
 *
 * It also answers the question the chips could not. A customer who is not in
 * the list used to be a dead end — leave the invoice, go to More → Customers,
 * add them, come back, start again. Here, the search box IS the new-customer
 * field: whatever finds nothing can be added under that name without leaving
 * the invoice, and lands selected.
 *
 * Only the name is asked for. `create_customer` requires nothing else, and an
 * invoice is a bad moment to interrupt someone for an address they can fill in
 * later from the customer screen.
 */

export interface PickerCustomer {
  id: string;
  name: string;
}

/** Case- and spacing-insensitive, the way someone searching actually types. */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export default function CustomerPicker({
  customers, value, onChange, onCreated, error, disabled,
}: {
  customers: PickerCustomer[];
  value: string | null;
  onChange: (id: string) => void;
  /** Hands the new customer back so the list on the invoice screen stays whole. */
  onCreated: (customer: PickerCustomer) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const selected = customers.find((c) => c.id === value) ?? null;

  const matches = useMemo(() => {
    const q = normalize(query);
    if (!q) return customers;
    return customers.filter((c) => normalize(c.name).includes(q));
  }, [customers, query]);

  /*
   * Offered whenever the typed name is not ALREADY a customer — not only when
   * the list comes back empty. "Musa Traders" matching "Musa Traders Ltd" is a
   * different business, and hiding the option because something merely
   * resembled it is how a duplicate gets picked by accident.
   */
  const typed = query.trim();
  const exists = customers.some((c) => normalize(c.name) === normalize(typed));
  const canCreate = typed.length > 0 && !exists;

  const close = () => {
    setOpen(false);
    setQuery("");
    setCreateError(null);
  };

  const select = (id: string) => {
    onChange(id);
    close();
  };

  const create = async () => {
    setBusy(true);
    setCreateError(null);
    try {
      const supabase = await getClient();
      const { data, error: rpcError } = await supabase.rpc("create_customer", {
        p_name: typed,
      });
      if (rpcError) throw new Error(rpcError.message);

      const result = data as { ok?: boolean; id?: string; name?: string; message?: string };
      if (!result?.ok || !result.id) {
        setCreateError(result?.message ?? "That customer could not be added.");
        return;
      }

      const created = { id: result.id, name: result.name ?? typed };
      onCreated(created);
      select(created.id);
    } catch (e) {
      if (isAuthFailure(e)) { void signOut(); return; }
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.field}>
      <Text style={s.label}>Customer</Text>

      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={
          selected ? `Customer: ${selected.name}. Opens a list.` : "Choose a customer"
        }
        style={[s.trigger, !!error && s.triggerError, disabled && s.triggerDisabled]}
      >
        <Text style={selected ? s.triggerValue : s.triggerPlaceholder} numberOfLines={1}>
          {selected ? selected.name : "Choose a customer"}
        </Text>
        <Text style={s.triggerAction}>{selected ? "Change" : "Select"}</Text>
      </Pressable>

      {error ? <Text style={s.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={s.backdrop} onPress={close}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={s.sheetWrap}
          >
            {/* Swallows taps so using the sheet does not dismiss it. */}
            <Pressable style={s.sheet} onPress={() => {}}>
              <Text style={s.sheetTitle}>Choose a customer</Text>

              <TextInput
                style={s.search}
                value={query}
                onChangeText={setQuery}
                placeholder="Search, or type a new name"
                placeholderTextColor={C.text3}
                autoCapitalize="words"
                autoCorrect={false}
                editable={!busy}
              />

              <ScrollView
                style={s.list}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={matches.length === 0 ? s.listEmpty : undefined}
              >
                {matches.length === 0 ? (
                  <Text style={s.empty}>
                    {customers.length === 0
                      ? "No customers yet — type a name above to add your first."
                      : "No customer matches that."}
                  </Text>
                ) : (
                  matches.map((c) => (
                    <Pressable
                      key={c.id}
                      onPress={() => select(c.id)}
                      disabled={busy}
                      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
                    >
                      <Text style={s.rowText} numberOfLines={1}>{c.name}</Text>
                      {c.id === value ? <Text style={s.rowCheck}>✓</Text> : null}
                    </Pressable>
                  ))
                )}
              </ScrollView>

              {createError ? <Text style={s.error}>{createError}</Text> : null}

              {canCreate ? (
                <Pressable style={s.create} onPress={create} disabled={busy}>
                  {busy
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={s.createText} numberOfLines={1}>+ Add “{typed}”</Text>}
                </Pressable>
              ) : null}

              <Pressable style={s.cancel} onPress={close} disabled={busy}>
                <Text style={s.cancelText}>Cancel</Text>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 12.5, fontWeight: "600", color: C.text2, marginBottom: 6 },
  trigger: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#fff", borderWidth: 1, borderColor: C.border2,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    minHeight: 48, gap: 12,
  },
  triggerError: { borderColor: C.danger, backgroundColor: "#FFFBFB" },
  triggerDisabled: { opacity: 0.6 },
  triggerValue: { fontSize: 15, color: C.text, flexShrink: 1 },
  triggerPlaceholder: { fontSize: 15, color: C.text3, flexShrink: 1 },
  triggerAction: { fontSize: 13, fontWeight: "600", color: C.primary },
  error: { color: C.danger, fontSize: 12.5, marginTop: 5, lineHeight: 18 },

  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center", justifyContent: "center", padding: 20,
  },
  sheetWrap: { width: "100%", maxWidth: 380 },
  sheet: { backgroundColor: "#fff", borderRadius: 16, padding: 16 },
  sheetTitle: { fontSize: 15, fontWeight: "700", color: C.text, marginBottom: 10 },
  search: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: C.border2,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 15, color: C.text, minHeight: 44,
  },
  // Capped so a long list scrolls inside the sheet instead of pushing the
  // add-and-cancel controls off the bottom of the screen.
  list: { maxHeight: 260, marginTop: 10 },
  listEmpty: { paddingVertical: 18 },
  empty: { color: C.text3, fontSize: 13, lineHeight: 19, textAlign: "center" },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    minHeight: 46, paddingHorizontal: 10, borderRadius: 8, gap: 12,
  },
  rowPressed: { backgroundColor: C.bg },
  rowText: { fontSize: 15, color: C.text, flexShrink: 1 },
  rowCheck: { fontSize: 15, fontWeight: "700", color: C.primary },
  create: {
    backgroundColor: C.forest, borderRadius: 10, minHeight: 46,
    alignItems: "center", justifyContent: "center", marginTop: 12, paddingHorizontal: 14,
  },
  createText: { color: "#fff", fontSize: 14.5, fontWeight: "600" },
  cancel: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 4 },
  cancelText: { fontSize: 15, color: C.text2, fontWeight: "600" },
});
