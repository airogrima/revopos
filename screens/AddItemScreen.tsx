import { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { parseNaira } from "@revopass/core";
import { getClient, isAuthFailure, signOut } from "../lib/supabase";
import { Field, FormScreen, useFormState } from "../components/form";

/**
 * Add something you sell.
 *
 * The catalogue also fills itself from invoice lines, so this is for the case
 * where someone wants a price on record before they have invoiced it once.
 *
 * public.create_item refuses a duplicate name and never overwrites an existing
 * price — the same rules the automatic capture obeys.
 */
export default function AddItemScreen() {
  const nav = useNavigation();
  const { busy, setBusy, error, setError, fieldErrors, setFieldErrors, applyResult } = useFormState();

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState("");

  const submit = async () => {
    setError(null);
    setFieldErrors({});

    // parseNaira gives integer kobo from "12,500" or "12500.50". Never a float.
    const kobo = price.trim() === "" ? 0 : parseNaira(price);
    if (kobo === null || kobo < 0) {
      setFieldErrors({ price: "Enter a price like 12,500 — or leave it blank." });
      return;
    }

    setBusy(true);
    try {
      const supabase = await getClient();
      const { data, error: rpcError } = await supabase.rpc("create_item", {
        p_name: name,
        p_unit_price_kobo: kobo,
        p_unit: unit.trim() || "each",
        p_sku: null,
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
      title="New item or service"
      subtitle="So you can reuse it on an invoice without retyping the price."
      onSubmit={submit}
      submitLabel="Save item"
      busy={busy}
      error={error}
    >
      <Field label="Name" value={name} onChange={setName}
             placeholder="e.g. Site survey" error={fieldErrors.name} editable={!busy} />
      <Field label="Price" value={price} onChange={setPrice}
             placeholder="e.g. 25,000" keyboardType="decimal-pad"
             error={fieldErrors.price} editable={!busy}
             hint="Leave blank if it varies each time." />
      <Field label="Unit" value={unit} onChange={setUnit}
             placeholder="each" autoCapitalize="none" editable={!busy}
             hint="each, hour, day, bag — whatever you charge by." />
    </FormScreen>
  );
}
