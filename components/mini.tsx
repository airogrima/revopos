/** Small form pieces for the module screens (production, HRM, tasks, budgets). */
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { C } from "../theme";
import { u } from "./ui";

export function Input({
  label, value, onChange, placeholder, keyboard, error, multiline,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  keyboard?: "default" | "decimal-pad" | "number-pad" | "phone-pad" | "email-address"; error?: string | undefined; multiline?: boolean;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={u.rowMeta}>{label}</Text>
      <TextInput
        style={[m.input, multiline && { minHeight: 70, textAlignVertical: "top" }, !!error && { borderColor: C.danger }]}
        value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.text3}
        keyboardType={keyboard ?? "default"} autoCapitalize="sentences" multiline={multiline}
      />
      {error ? <Text style={m.err}>{error}</Text> : null}
    </View>
  );
}

export function Chips<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={m.chips}>
      {options.map((o) => (
        <Pressable key={o.value} style={[m.chip, value === o.value && m.chipOn]} onPress={() => onChange(o.value)}
                   accessibilityState={{ selected: value === o.value }}>
          <Text style={[m.chipText, value === o.value && m.chipTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Primary({ label, onPress, busy, disabled }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <Pressable style={[m.primary, (busy || disabled) && { opacity: 0.55 }]} disabled={busy || disabled} onPress={onPress}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={m.primaryText}>{label}</Text>}
    </Pressable>
  );
}

export function Ghost({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={m.ghost} onPress={onPress}>
      <Text style={[m.ghostText, danger && { color: C.danger }]}>{label}</Text>
    </Pressable>
  );
}

export function Message({ text, ok }: { text: string | null; ok?: boolean }) {
  return text ? <Text style={[m.err, ok && { color: C.primary }]}>{text}</Text> : null;
}

/** A pick-one list with search, for choosing a product or person on a phone. */
export function Picker({
  options, value, onChange, placeholder,
}: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={m.chips}>
      <Pressable style={[m.chip, value === "" && m.chipOn]} onPress={() => onChange("")}>
        <Text style={[m.chipText, value === "" && m.chipTextOn]}>{placeholder}</Text>
      </Pressable>
      {options.map((o) => (
        <Pressable key={o.value} style={[m.chip, value === o.value && m.chipOn]} onPress={() => onChange(o.value)}>
          <Text style={[m.chipText, value === o.value && m.chipTextOn]} numberOfLines={1}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const m = StyleSheet.create({
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: C.text, minHeight: 48, marginTop: 4 },
  err: { color: C.danger, fontSize: 12.5, marginTop: 6, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: 15, borderRadius: 99, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff", maxWidth: "100%" },
  chipOn: { backgroundColor: C.forest, borderColor: C.forest },
  chipText: { fontSize: 13, color: C.text2, fontWeight: "600" },
  chipTextOn: { color: "#fff", fontWeight: "700" },
  primary: { backgroundColor: C.forest, borderRadius: 14, minHeight: 54, alignItems: "center", justifyContent: "center", marginTop: 14 },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  ghost: { minHeight: 46, alignItems: "center", justifyContent: "center", marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff" },
  ghostText: { color: C.text, fontSize: 14.5, fontWeight: "600" },
});
