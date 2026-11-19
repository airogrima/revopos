import { useState, type ReactNode } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sanitizeAmountInput, sanitizePhoneInput } from "@revopass/core";
import { C } from "../theme";

/**
 * The form furniture every write screen needs.
 *
 * Written once because the mobile app is about to gain four forms in a row —
 * customer, item, expense, invoice — and four hand-rolled versions of "label,
 * input, error, save button" is how they end up subtly different from each
 * other and from the web.
 *
 * The RPCs behind these return refusals as VALUES with a `field` key, so a
 * message can be shown against the input it belongs to rather than as a banner
 * the user has to map back onto the form themselves.
 */

export function FormScreen({
  title, subtitle, children, onSubmit, submitLabel, busy, error,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onSubmit: () => void;
  submitLabel: string;
  busy: boolean;
  error?: string | null;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      // Without this the keyboard covers the save button on smaller phones and
      // there is no way to scroll to it.
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}

        {error ? (
          <View style={s.banner}><Text style={s.bannerText}>{error}</Text></View>
        ) : null}

        {children}

        <Pressable
          style={({ pressed }) => [s.submit, (busy || pressed) && { opacity: 0.75 }]}
          onPress={onSubmit}
          disabled={busy}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.submitText}>{submitLabel}</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Field({
  label, value, onChange, placeholder, error, keyboardType, autoCapitalize,
  multiline, hint, editable = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  keyboardType?: "default" | "decimal-pad" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words" | "sentences";
  multiline?: boolean;
  hint?: string;
  editable?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={[s.input, multiline && s.inputMultiline, !!error && s.inputError]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.text3}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        multiline={multiline}
        editable={editable}
      />
      {error
        ? <Text style={s.error}>{error}</Text>
        : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

/**
 * `Field`, for an amount — it will not hold letters.
 *
 * `keyboardType="decimal-pad"` was never a guarantee, only a suggestion about
 * which keyboard to show. A hardware keyboard (every simulator, and any phone
 * with one paired), a paste, or a keyboard that offers its own letter row all
 * put text straight into a decimal-pad field. Filtering the value on the way in
 * is what actually holds, so the letters never land.
 */
export function MoneyField({
  label, value, onChange, placeholder, error, hint, editable = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  hint?: string;
  editable?: boolean;
}) {
  return (
    <Field
      label={label}
      value={value}
      onChange={(v) => onChange(sanitizeAmountInput(v))}
      placeholder={placeholder}
      error={error}
      hint={hint}
      editable={editable}
      keyboardType="decimal-pad"
      autoCapitalize="none"
    />
  );
}

/** `Field`, for a phone number — digits, spacing and a leading `+` only. */
export function PhoneField({
  label, value, onChange, placeholder, error, hint, editable = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  hint?: string;
  editable?: boolean;
}) {
  return (
    <Field
      label={label}
      value={value}
      onChange={(v) => onChange(sanitizePhoneInput(v))}
      placeholder={placeholder}
      error={error}
      hint={hint}
      editable={editable}
      keyboardType="phone-pad"
      autoCapitalize="none"
    />
  );
}

/**
 * A date as the database wants it — `YYYY-MM-DD` in the user's OWN day.
 *
 * NOT `toISOString().slice(0, 10)`, which is the date in UTC. Nigeria runs an
 * hour ahead, so a date picked from the calendar and converted that way lands
 * on the PREVIOUS day for any moment before 01:00 WAT — an invoice due the 1st
 * filed as due the 31st, and overdue a day early. Reading the local calendar
 * fields back out cannot drift, whatever the timezone.
 */
export function toISODate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-NG", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

/**
 * A date chosen from a calendar, never typed.
 *
 * The two platforms disagree about what a date picker IS, so this follows each
 * one rather than forcing a shared shape. Android's picker is already a modal
 * dialog that reports "set" or "dismissed" and takes itself down, so it is
 * rendered only while open and its result applied directly. iOS's is an inline
 * view that would otherwise sit in the middle of the form pushing everything
 * around, so it goes in a sheet with an explicit Done — which also gives an
 * iPhone user somewhere to cancel, as scrolling a calendar there reports every
 * intermediate date as a change.
 */
export function DateField({
  label, value, onChange, minimumDate, error, hint, editable = true,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  minimumDate?: Date;
  error?: string | null;
  hint?: string;
  editable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // iOS edits a copy so a cancelled sheet leaves the real value alone.
  const [draft, setDraft] = useState(value);

  const openPicker = () => { setDraft(value); setOpen(true); };

  const onAndroidChange = (event: DateTimePickerEvent, picked?: Date) => {
    setOpen(false);
    if (event.type === "set" && picked) onChange(picked);
  };

  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Pressable
        onPress={openPicker}
        disabled={!editable}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatDay(value)}. Opens a calendar.`}
        style={[s.input, s.dateInput, !!error && s.inputError, !editable && s.dateDisabled]}
      >
        <Text style={s.dateValue}>{formatDay(value)}</Text>
        <Text style={s.dateHint}>Change</Text>
      </Pressable>

      {error
        ? <Text style={s.error}>{error}</Text>
        : hint ? <Text style={s.hint}>{hint}</Text> : null}

      {Platform.OS === "android" && open && (
        <DateTimePicker
          value={value}
          mode="date"
          display="calendar"
          minimumDate={minimumDate}
          onChange={onAndroidChange}
        />
      )}

      {Platform.OS === "ios" && (
        <Modal
          visible={open}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <Pressable style={s.sheetBackdrop} onPress={() => setOpen(false)}>
            {/* Swallows taps on the sheet itself so choosing a date does not
                dismiss it through the backdrop underneath. */}
            <Pressable style={s.sheet} onPress={() => {}}>
              <Text style={s.sheetTitle}>{label}</Text>
              <DateTimePicker
                value={draft}
                mode="date"
                display="inline"
                minimumDate={minimumDate}
                accentColor={C.primary}
                themeVariant="light"
                onChange={(_e, picked) => { if (picked) setDraft(picked); }}
              />
              <View style={s.sheetActions}>
                <Pressable style={s.sheetCancel} onPress={() => setOpen(false)}>
                  <Text style={s.sheetCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={s.sheetDone}
                  onPress={() => { onChange(draft); setOpen(false); }}
                >
                  <Text style={s.sheetDoneText}>Done</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

/** A row of choices — payment method, category. Wraps rather than scrolling. */
export function ChipRow<T extends string>({
  label, options, value, onChange, disabled,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={s.chips}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            disabled={disabled}
            // 44pt minimum so these are comfortable one-handed.
            style={[s.chip, value === o.value && s.chipActive]}
          >
            <Text style={[s.chipText, value === o.value && s.chipTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Success confirmation used after a write, before navigating back. */
export function useFormState() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /*
   * Applies an RPC result. The functions return {ok, field?, message} so a
   * message lands on the input it concerns; anything without a `field` is a
   * whole-form problem and goes to the banner.
   */
  const applyResult = (result: { ok?: boolean; field?: string; message?: string } | null) => {
    if (result?.ok) { setError(null); setFieldErrors({}); return true; }
    const message = result?.message ?? "That could not be saved.";
    if (result?.field) { setFieldErrors({ [result.field]: message }); setError(null); }
    else { setError(message); setFieldErrors({}); }
    return false;
  };

  return { busy, setBusy, error, setError, fieldErrors, setFieldErrors, applyResult };
}

const s = StyleSheet.create({
  title: { fontSize: 24, fontWeight: "700", color: C.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 13.5, color: C.text2, marginTop: 3, marginBottom: 18 },
  field: { marginBottom: 16 },
  label: { fontSize: 12.5, fontWeight: "600", color: C.text2, marginBottom: 6 },
  input: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: C.border,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, color: C.text, minHeight: 48,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: "top" },
  inputError: { borderColor: C.danger, backgroundColor: "#FFFBFB" },
  dateInput: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  dateDisabled: { opacity: 0.6 },
  dateValue: { fontSize: 15, color: C.text },
  dateHint: { fontSize: 13, fontWeight: "600", color: C.primary },
  sheetBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center", justifyContent: "center", padding: 20,
  },
  sheet: {
    width: "100%", maxWidth: 380, backgroundColor: "#fff",
    borderRadius: 16, padding: 16,
  },
  sheetTitle: { fontSize: 15, fontWeight: "700", color: C.text, marginBottom: 4 },
  sheetActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 6 },
  sheetCancel: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16 },
  sheetCancelText: { fontSize: 15, color: C.text2, fontWeight: "600" },
  sheetDone: {
    minHeight: 44, justifyContent: "center", paddingHorizontal: 22,
    borderRadius: 12, backgroundColor: C.forest,
  },
  sheetDoneText: { fontSize: 15, color: "#fff", fontWeight: "600" },
  error: { color: C.danger, fontSize: 12.5, marginTop: 5, lineHeight: 18 },
  hint: { color: C.text3, fontSize: 12, marginTop: 5, lineHeight: 17 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44, justifyContent: "center", paddingHorizontal: 16,
    borderRadius: 99, backgroundColor: "#fff",
    borderWidth: 1, borderColor: C.border2,
  },
  chipActive: { backgroundColor: C.forest, borderColor: C.forest },
  chipText: { fontSize: 13.5, color: C.text2, textTransform: "capitalize", fontWeight: "600" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  submit: {
    backgroundColor: C.forest, borderRadius: 14, minHeight: 54,
    alignItems: "center", justifyContent: "center", marginTop: 10,
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  banner: {
    backgroundColor: "#FEE4E2", borderRadius: 10, padding: 12, marginBottom: 16,
  },
  bannerText: { fontSize: 13, color: C.text, lineHeight: 19 },
});
