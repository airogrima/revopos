import { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { getClient, isAuthFailure, signOut } from "../lib/supabase";
import { Field, FormScreen, PhoneField, useFormState } from "../components/form";

/**
 * Add a customer from the phone.
 *
 * The first of the write screens, and deliberately the smallest — it is also
 * what unblocks creating an invoice, since an invoice needs somebody to bill.
 *
 * Calls public.create_customer rather than inserting into the table. The name
 * and email rules live there, so the phone and the web cannot disagree about
 * what a valid customer is.
 */
export default function AddCustomerScreen() {
  const nav = useNavigation();
  const { busy, setBusy, error, setError, fieldErrors, applyResult } = useFormState();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [tin, setTin] = useState("");

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const supabase = await getClient();
      const { data, error: rpcError } = await supabase.rpc("create_customer", {
        p_name: name,
        p_email: email.trim() || null,
        p_phone: phone.trim() || null,
        p_address: address.trim() || null,
        p_tin: tin.trim() || null,
      });
      if (rpcError) throw new Error(rpcError.message);

      if (applyResult(data as { ok?: boolean; field?: string; message?: string })) {
        nav.goBack();
      }
    } catch (e) {
      if (isAuthFailure(e)) { void signOut(); return; }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen
      title="New customer"
      subtitle="Only the name is required — the rest can wait."
      onSubmit={submit}
      submitLabel="Save customer"
      busy={busy}
      error={error}
    >
      <Field label="Name" value={name} onChange={setName}
             placeholder="e.g. Hauwa Musa" autoCapitalize="words"
             error={fieldErrors.name} editable={!busy} />
      <Field label="Email" value={email} onChange={setEmail}
             placeholder="them@theirbusiness.ng"
             keyboardType="email-address" autoCapitalize="none"
             error={fieldErrors.email} editable={!busy}
             hint="Needed if you want to email them an invoice." />
      <PhoneField label="Phone" value={phone} onChange={setPhone}
                  placeholder="0801 234 5678" editable={!busy} />
      <Field label="Address" value={address} onChange={setAddress}
             placeholder="Where they are" multiline editable={!busy} />
      <Field label="Tax ID (TIN)" value={tin} onChange={setTin}
             placeholder="Optional" autoCapitalize="none" editable={!busy} />
    </FormScreen>
  );
}
