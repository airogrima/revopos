import { useEffect, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useNavigation } from "@react-navigation/native";
import { parseNaira } from "@revopass/core";
import { getClient, isAuthFailure, signOut, supabase } from "../lib/supabase";
import { useOrg } from "../lib/org";
import { ChipRow, Field, FormScreen, useFormState } from "../components/form";
import { C } from "../theme";

/**
 * Photograph a receipt, keep the image, file it as an expense.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not read the receipt. The fields below are typed by the person
 * holding it. Automatic extraction is the Pro `receipt_ocr` feature and it does
 * not exist yet — so nothing here is labelled "scanned", nothing shows a
 * confidence score, and no field arrives pre-filled. Implying a machine read it
 * when a human did would be the worst possible lie to tell in an accounting
 * product.
 *
 * The image is the point even without OCR: FIRS wants evidence, and a photo
 * attached to the expense is what a receipt in a drawer was for.
 */

const METHODS = [
  { value: "cash", label: "cash" },
  { value: "transfer", label: "transfer" },
  { value: "card", label: "card" },
  { value: "pos", label: "POS" },
] as const;

export default function CaptureReceiptScreen() {
  const nav = useNavigation();
  const { orgId } = useOrg();
  const { busy, setBusy, error, setError, fieldErrors, setFieldErrors, applyResult } = useFormState();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [merchant, setMerchant] = useState("");
  const [total, setTotal] = useState("");
  const [vat, setVat] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("cash");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  /*
   * One key per capture attempt, generated when the screen mounts.
   *
   * A phone that loses signal mid-upload retries, and receipt_scans has a
   * unique index on (org_id, client_key) so the retry returns the original row
   * instead of filing the same receipt — and the same expense — twice.
   */
  const [clientKey] = useState(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const client = await getClient();
        const { data } = await client
          .from("categories").select("id,name")
          .eq("org_id", orgId).eq("kind", "expense").order("name");
        if (!cancelled) setCategories((data ?? []) as { id: string; name: string }[]);
      } catch { /* category is optional; never block the capture */ }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const pick = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!perm.granted) {
      Alert.alert(
        fromCamera ? "Camera access needed" : "Photo access needed",
        "RevoPass needs this to attach a picture of the receipt. You can turn it on in Settings.",
      );
      return;
    }

    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      // Receipts are read, not admired. Compressing keeps uploads viable on
      // mobile data, which is the connection this will usually run on.
      quality: 0.6,
      allowsEditing: true,
    };
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);

    if (!result.canceled && result.assets?.[0]) setImageUri(result.assets[0].uri);
  };

  const submit = async () => {
    setError(null);
    setFieldErrors({});

    if (!imageUri) {
      setError("Take or choose a photo of the receipt first.");
      return;
    }
    const totalKobo = parseNaira(total);
    if (totalKobo === null || totalKobo <= 0) {
      setFieldErrors({ total: "Enter the amount on the receipt." });
      return;
    }
    const vatKobo = vat.trim() === "" ? 0 : parseNaira(vat);
    if (vatKobo === null || vatKobo < 0) {
      setFieldErrors({ vat: "Enter a VAT amount, or leave it blank." });
      return;
    }
    if (!orgId) { setError("No business found for this account."); return; }

    setBusy(true);
    try {
      const client = await getClient();

      /*
       * Path is `<org_id>/<key>.jpg`. Every storage policy on this bucket keys
       * on that first folder, so the layout is what keeps one business's
       * receipts out of another's.
       */
      const path = `${orgId}/${clientKey}.jpg`;
      const response = await fetch(imageUri);
      const blob = await response.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(path, blob, { contentType: "image/jpeg", upsert: true });

      if (uploadError) throw new Error(`The photo did not upload: ${uploadError.message}`);

      const { data, error: rpcError } = await client.rpc("create_receipt_scan", {
        p_storage_path: path,
        p_merchant: merchant,
        p_total_kobo: totalKobo,
        p_spent_on: new Date().toISOString().slice(0, 10),
        p_vat_kobo: vatKobo,
        p_category_id: categoryId,
        p_client_key: clientKey,
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
      title="Capture a receipt"
      subtitle="Photograph it, then fill in what it says."
      onSubmit={submit}
      submitLabel="Save receipt"
      busy={busy}
      error={error}
    >
      {imageUri ? (
        <View style={s.preview}>
          <Image source={{ uri: imageUri }} style={s.image} resizeMode="cover" />
          <Pressable onPress={() => setImageUri(null)} disabled={busy} style={s.retake}>
            <Text style={s.retakeText}>Retake</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.pickRow}>
          <Pressable style={s.pickPrimary} onPress={() => pick(true)} disabled={busy}>
            <Text style={s.pickPrimaryText}>Take a photo</Text>
          </Pressable>
          <Pressable style={s.pickGhost} onPress={() => pick(false)} disabled={busy}>
            <Text style={s.pickGhostText}>Choose from photos</Text>
          </Pressable>
        </View>
      )}

      <Field label="Who did you pay?" value={merchant} onChange={setMerchant}
             placeholder="e.g. Total Filling Station"
             error={fieldErrors.merchant} editable={!busy} />
      <Field label="Amount" value={total} onChange={setTotal}
             placeholder="e.g. 25,000" keyboardType="decimal-pad"
             error={fieldErrors.total} editable={!busy} />
      <Field label="VAT included" value={vat} onChange={setVat}
             placeholder="Leave blank if none" keyboardType="decimal-pad"
             error={fieldErrors.vat} editable={!busy}
             hint="Part of the amount above. Recorded separately so you can reclaim it." />

      <ChipRow label="How did you pay?" options={METHODS as unknown as { value: string; label: string }[]}
               value={method} onChange={(v) => setMethod(v as typeof method)} disabled={busy} />

      {categories.length > 0 && (
        <ChipRow
          label="Category"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={categoryId}
          onChange={(v) => setCategoryId(v === categoryId ? null : v)}
          disabled={busy}
        />
      )}

      {/* Said plainly, so nobody waits for fields to fill themselves. */}
      <Text style={s.note}>
        RevoPass does not read the receipt yet — you enter the figures, and the
        photo is kept alongside them as proof. Automatic reading is a Pro feature
        that is not switched on.
      </Text>
    </FormScreen>
  );
}

const s = StyleSheet.create({
  pickRow: { gap: 10, marginBottom: 18 },
  pickPrimary: {
    backgroundColor: C.green, borderRadius: 12, minHeight: 52,
    alignItems: "center", justifyContent: "center",
  },
  pickPrimaryText: { color: C.onBrand, fontSize: 15, fontWeight: "600" },
  pickGhost: {
    backgroundColor: "#fff", borderRadius: 12, minHeight: 48,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.border2,
  },
  pickGhostText: { color: C.text, fontSize: 14.5, fontWeight: "600" },
  preview: { marginBottom: 18 },
  image: { width: "100%", height: 220, borderRadius: 12, backgroundColor: "#fff" },
  retake: { marginTop: 10, minHeight: 44, alignItems: "center", justifyContent: "center" },
  retakeText: { color: C.primary, fontSize: 14, fontWeight: "600" },
  note: {
    color: C.text3, fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 4,
  },
});
