import { useEffect, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { parseNaira } from "@revopass/core";
import { getClient, isAuthFailure, signOut } from "../lib/supabase";
import { useOrg } from "../lib/org";
import { ChipRow, DateField, Field, FormScreen, toISODate, useFormState } from "../components/form";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { C } from "../theme";

/**
 * Record money going out.
 *
 * Note this does not exist on the web app either — its expenses page is
 * read-only and every row there arrived by seed. So this is a new capability,
 * not a port, and the phone is arguably the right place for it: expenses happen
 * away from a desk, which is exactly when they get forgotten.
 *
 * VAT is captured separately because it is reclaimable. The tax report sums
 * vat_kobo on its own, so folding it into the total would quietly make input
 * VAT unrecoverable.
 */

const METHODS = [
  { value: "cash", label: "cash" },
  { value: "transfer", label: "transfer" },
  { value: "card", label: "card" },
  { value: "pos", label: "POS" },
  { value: "ussd", label: "USSD" },
] as const;

export default function AddExpenseScreen() {
  const nav = useNavigation();
  const { orgId } = useOrg();
  const { busy, setBusy, error, setError, fieldErrors, setFieldErrors, applyResult } = useFormState();

  const [total, setTotal] = useState("");
  const [vat, setVat] = useState("");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("cash");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date());
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [catError, setCatError] = useState<string | null>(null);

  /*
   * "+ Add new category": the same rule the web uses. The name is trimmed and
   * matched case-insensitively against this business's expense categories, so
   * an existing one is reused instead of duplicated; otherwise one row is
   * added to public.categories for THIS business (RLS scopes it), then selected.
   */
  const addCategory = async () => {
    const name = newName.replace(/\s+/g, " ").trim();
    if (name === "") { setCatError("Enter a category name."); return; }
    if (name.length > 80) { setCatError("Up to 80 characters."); return; }
    setCatError(null);
    try {
      const supabase = await getClient();
      const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (existing) { setCategoryId(existing.id); setAdding(false); setNewName(""); return; }
      const { data, error: e } = await supabase.from("categories")
        .insert({ org_id: orgId, name, kind: "expense" }).select("id,name").single();
      if (e || !data) throw new Error(e?.message ?? "Could not add the category.");
      setCategories((cs) => [...cs, data as { id: string; name: string }].sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryId((data as { id: string }).id);
      setAdding(false); setNewName("");
    } catch (e) {
      setCatError(e instanceof Error ? e.message : "We couldn't add that category. Please try again.");
    }
  };

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = await getClient();
        const { data } = await supabase
          .from("categories").select("id,name")
          .eq("org_id", orgId).eq("kind", "expense").order("name");
        if (!cancelled) setCategories((data ?? []) as { id: string; name: string }[]);
      } catch {
        // A missing category list must not block recording the expense —
        // category is optional, and the money still needs writing down.
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const submit = async () => {
    setError(null);
    setFieldErrors({});

    const totalKobo = parseNaira(total);
    if (totalKobo === null || totalKobo <= 0) {
      setFieldErrors({ total: "Enter the amount spent, for example 5,000." });
      return;
    }
    const vatKobo = vat.trim() === "" ? 0 : parseNaira(vat);
    if (vatKobo === null || vatKobo < 0) {
      setFieldErrors({ vat: "Enter a VAT amount, or leave it blank." });
      return;
    }

    setBusy(true);
    try {
      const supabase = await getClient();
      const { data, error: rpcError } = await supabase.rpc("create_expense", {
        p_total_kobo: totalKobo,
        p_description: description,
        p_expense_date: toISODate(date),
        p_category_id: categoryId,
        p_vat_kobo: vatKobo,
        p_payment_method: method,
        p_note: note.trim() === "" ? null : note.trim(),
      });
      if (rpcError) throw new Error(rpcError.message);
      if (applyResult(data as { ok?: boolean; field?: string; message?: string })) nav.goBack();
    } catch (e) {
      if (isAuthFailure(e)) { void signOut(); return; }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen
      title="Record an expense"
      subtitle="What you spent, and what on."
      onSubmit={submit}
      submitLabel="Save expense"
      busy={busy}
      error={error}
    >
      <View style={x.catBlock}>
        <Text style={x.label}>Category</Text>
        <View style={x.chips}>
          {categories.map((c) => (
            <Pressable key={c.id} onPress={() => setCategoryId(c.id === categoryId ? null : c.id)} disabled={busy}
                       style={[x.chip, categoryId === c.id && x.chipOn]}>
              <Text style={[x.chipText, categoryId === c.id && x.chipTextOn]}>{c.name}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => { setAdding(true); setCatError(null); }} disabled={busy} style={[x.chip, x.chipAdd]}>
            <Text style={x.chipAddText}>+ Add new category</Text>
          </Pressable>
        </View>
        {adding && (
          <View style={x.addRow}>
            <TextInput style={x.addInput} value={newName} onChangeText={setNewName} placeholder="New category name"
                       placeholderTextColor={C.text3} maxLength={80} autoFocus onSubmitEditing={() => void addCategory()} returnKeyType="done" />
            <Pressable style={x.addBtn} onPress={() => void addCategory()}><Text style={x.addBtnText}>Add</Text></Pressable>
            <Pressable style={x.cancelBtn} onPress={() => { setAdding(false); setNewName(""); setCatError(null); }}><Text style={x.cancelText}>Cancel</Text></Pressable>
          </View>
        )}
        {catError ? <Text style={x.err}>{catError}</Text> : null}
      </View>

      <Field label="Amount" value={total} onChange={setTotal}
             placeholder="₦0.00" keyboardType="decimal-pad"
             error={fieldErrors.total} editable={!busy} />
      <DateField label="Date" value={date} onChange={setDate} editable={!busy} />
      <Field label="What was it for?" value={description} onChange={setDescription}
             placeholder="e.g. Fuel for the generator"
             error={fieldErrors.description} editable={!busy} />
      <Field label="VAT included" value={vat} onChange={setVat}
             placeholder="Leave blank if none" keyboardType="decimal-pad"
             error={fieldErrors.vat} editable={!busy}
             hint="Part of the amount above, not on top of it. Recorded separately so you can reclaim it." />

      <ChipRow label="Payment method" options={METHODS as unknown as { value: string; label: string }[]}
               value={method} onChange={(v) => setMethod(v as typeof method)} disabled={busy} />

      <Field label="Notes" value={note} onChange={setNote} placeholder="Add notes (optional)" multiline editable={!busy} />
    </FormScreen>
  );
}

const x = StyleSheet.create({
  catBlock: { marginBottom: 16 },
  label: { fontSize: 12.5, fontWeight: "600", color: C.text2, marginBottom: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: 16, borderRadius: 99, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff" },
  chipOn: { backgroundColor: C.forest, borderColor: C.forest },
  chipText: { fontSize: 13.5, color: C.text2, fontWeight: "600" },
  chipTextOn: { color: "#fff", fontWeight: "700" },
  chipAdd: { borderStyle: "dashed", borderColor: C.forest },
  chipAddText: { fontSize: 13.5, color: C.forest, fontWeight: "700" },
  addRow: { flexDirection: "row", gap: 8, marginTop: 10, alignItems: "center" },
  addInput: { flex: 1, backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, minHeight: 46, fontSize: 15, color: C.text },
  addBtn: { backgroundColor: C.forest, borderRadius: 14, minHeight: 46, paddingHorizontal: 18, justifyContent: "center" },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 14.5 },
  cancelBtn: { minHeight: 46, justifyContent: "center", paddingHorizontal: 6 },
  cancelText: { color: C.text2, fontWeight: "600", fontSize: 14 },
  err: { color: C.danger, fontSize: 12.5, marginTop: 6 },
});
