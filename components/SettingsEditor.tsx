/**
 * Editable Business Profile and Tax cards.
 *
 * Mirrors the web actions updateBusinessProfile / updateTaxSettings exactly: the
 * same columns, the same validation (name required, email shape, rate 0–100%
 * stored as basis points, a TIN when VAT registered) and the same write path, an
 * UPDATE on `organizations` under the user's own session. RLS (app.can_write =
 * owner or admin) is the real gate; `canEdit` only hides the buttons for others.
 *
 * Not editable here, because the web does not edit them either: currency and
 * legal name. Tax name / inclusive-exclusive are not backend settings, so none
 * are invented. Saving changes the organisation row only; issued documents keep
 * their own snapshot, so nothing already issued is altered.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Image, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { getClient } from "../lib/supabase";
import { friendly } from "../lib/perms";
import { C } from "../theme";
import { Card, u } from "./ui";
import { Field } from "./form";

export interface OrgRow {
  id?: string; name: string; legal_name: string | null; business_type: string | null; state: string | null;
  address: string | null; email: string | null; phone: string | null; tin: string | null; logo_url: string | null;
  vat_registered: boolean; vat_number: string | null; vat_rate_bps: number; default_wht_rate_bps: number; currency: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bpsToStr = (b: number) => String(b / 100);
export function pctToBps(v: string): number | null {
  const t = v.trim(); if (t === "") return null;
  const n = Number(t); if (!Number.isFinite(n)) return null;
  const bps = Math.round(n * 100); return bps >= 0 && bps <= 10000 ? bps : null;
}
const nul = (v: string) => (v.trim() === "" ? null : v.trim());

/** Small non-blocking confirmation that fades out by itself. */
export function useToast() {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const o = useRef(new Animated.Value(0)).current;
  const show = (text: string, ok = true) => {
    setMsg({ text, ok });
    Animated.sequence([Animated.timing(o, { toValue: 1, duration: 160, useNativeDriver: true }), Animated.delay(2200),
      Animated.timing(o, { toValue: 0, duration: 260, useNativeDriver: true })]).start(() => setMsg(null));
  };
  const node = msg ? (
    <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" style={[t.toast, { opacity: o, backgroundColor: msg.ok ? C.forest : C.danger }]}>
      <Text style={t.text}>{msg.text}</Text>
    </Animated.View>
  ) : null;
  return { show, node };
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={u.listRow}>
      <Text style={[u.rowMeta, { flex: 1 }]}>{label}</Text>
      <Text style={[u.rowTitle, { flex: 1.4, textAlign: "right" }]} numberOfLines={2}>{value && value.trim() !== "" ? value : "—"}</Text>
    </View>
  );
}

function Buttons({ busy, onSave, onCancel }: { busy: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
      <Pressable onPress={onCancel} disabled={busy} style={[t.btn, { backgroundColor: C.border2 }]} accessibilityRole="button"><Text style={[t.btnText, { color: C.text }]}>Cancel</Text></Pressable>
      <Pressable onPress={onSave} disabled={busy} style={[t.btn, { backgroundColor: C.forest, flex: 1.4 }]} accessibilityRole="button">
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={t.btnText}>Save</Text>}
      </Pressable>
    </View>
  );
}

export default function SettingsEditor({ org, orgId, canEdit, onSaved }: {
  org: OrgRow; orgId: string; canEdit: boolean; onSaved: (toast: string) => void;
}) {
  const [mode, setMode] = useState<null | "profile" | "tax">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [top, setTop] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", business_type: "", state: "", address: "", email: "", phone: "", tin: "", vat_rate: "", wht_rate: "", vat_registered: false });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const begin = (m: "profile" | "tax") => {
    setF({ name: org.name ?? "", business_type: org.business_type ?? "", state: org.state ?? "", address: org.address ?? "", email: org.email ?? "",
      phone: org.phone ?? "", tin: org.tin ?? "", vat_rate: bpsToStr(org.vat_rate_bps), wht_rate: bpsToStr(org.default_wht_rate_bps), vat_registered: org.vat_registered });
    setErr({}); setTop(null); setMode(m);
  };
  useEffect(() => { setMode(null); }, [orgId]);

  const write = async (patch: Record<string, unknown>, done: string) => {
    setBusy(true); setTop(null);
    try {
      const c = await getClient();
      const { data, error } = await c.from("organizations").update(patch).eq("id", orgId).select("id");
      if (error) throw new Error(error.message);
      // RLS hides rows you may not write: zero rows back means the update was refused.
      if (!data?.length) throw new Error("permission denied");
      setMode(null); onSaved(done);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Could not save.";
      setTop(/permission|row-level|denied/i.test(raw) ? "Only an owner or admin can change this." : friendly(raw));
    } finally { setBusy(false); }
  };

  const saveProfile = () => {
    const e: Record<string, string> = {};
    if (f.name.trim() === "") e.name = "Business name is required";
    if (f.email.trim() !== "" && !EMAIL.test(f.email.trim())) e.email = "Enter a valid email address";
    setErr(e); if (Object.keys(e).length) return;
    void write({ name: f.name.trim(), business_type: nul(f.business_type), state: nul(f.state), tin: nul(f.tin), address: nul(f.address), email: nul(f.email), phone: nul(f.phone) }, "Business profile saved");
  };
  const saveTax = () => {
    const e: Record<string, string> = {};
    const vat = pctToBps(f.vat_rate), wht = pctToBps(f.wht_rate);
    if (vat === null) e.vat_rate = "Enter a rate between 0 and 100";
    if (wht === null) e.wht_rate = "Enter a rate between 0 and 100";
    if (f.vat_registered && f.tin.trim() === "") e.tin = "A TIN is required when the business is VAT registered";
    setErr(e); if (Object.keys(e).length) return;
    void write({ vat_rate_bps: vat, default_wht_rate_bps: wht, vat_registered: f.vat_registered, tin: nul(f.tin) }, "Tax settings saved");
  };

  const pickLogo = async () => {
    const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!p.granted) { setTop("Allow photo access to choose a logo."); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsEditing: true });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    setBusy(true); setTop(null);
    try {
      const c = await getClient();
      const ext = a.uri.toLowerCase().includes(".png") ? "png" : "jpg";
      const path = `${orgId}/logo.${ext}`;
      const buf = await (await fetch(a.uri)).arrayBuffer();
      if (buf.byteLength > 2 * 1024 * 1024) throw new Error("Logo must be under 2 MB.");
      const up = await c.storage.from("logos").upload(path, buf, { upsert: true, contentType: ext === "png" ? "image/png" : "image/jpeg" });
      if (up.error) throw new Error(up.error.message);
      const url = `${c.storage.from("logos").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
      const { data, error } = await c.from("organizations").update({ logo_url: url }).eq("id", orgId).select("id");
      if (error || !data?.length) throw new Error(error?.message ?? "permission denied");
      onSaved("Logo saved");
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Could not upload.";
      setTop(/permission|row-level|denied|policy/i.test(raw) ? "Only an owner or admin can change the logo." : raw);
    } finally { setBusy(false); }
  };

  const editBtn = (m: "profile" | "tax") => canEdit ? (
    <Pressable onPress={() => begin(m)} accessibilityRole="button" accessibilityLabel={`Edit ${m}`} style={t.edit}><Text style={t.editText}>Edit</Text></Pressable>
  ) : null;

  return (
    <>
      <Card title="Business profile">
        {mode === "profile" ? (
          <>
            {top ? <Text style={t.top}>{top}</Text> : null}
            <Field label="Business name" value={f.name} onChange={set("name")} error={err.name} editable={!busy} />
            <Field label="Business type" value={f.business_type} onChange={set("business_type")} editable={!busy} />
            <Field label="State" value={f.state} onChange={set("state")} editable={!busy} />
            <Field label="Address" value={f.address} onChange={set("address")} multiline editable={!busy} />
            <Field label="Email" value={f.email} onChange={set("email")} error={err.email} keyboardType="email-address" autoCapitalize="none" editable={!busy} />
            <Field label="Phone" value={f.phone} onChange={set("phone")} keyboardType="phone-pad" editable={!busy} />
            <Field label="Registration / Tax ID (TIN)" value={f.tin} onChange={set("tin")} autoCapitalize="none" editable={!busy} />
            <Row label="Country / currency" value={`Nigeria · ${org.currency}`} />
            <Buttons busy={busy} onSave={saveProfile} onCancel={() => setMode(null)} />
          </>
        ) : (
          <>
            <View style={t.logoRow}>
              {org.logo_url ? <Image source={{ uri: org.logo_url }} style={t.logo} accessibilityLabel="Business logo" /> : <View style={[t.logo, t.logoEmpty]}><Text style={u.rowMeta}>No logo</Text></View>}
              {canEdit ? <Pressable onPress={() => void pickLogo()} disabled={busy} style={t.edit} accessibilityRole="button"><Text style={t.editText}>{busy ? "Uploading…" : org.logo_url ? "Change logo" : "Add logo"}</Text></Pressable> : null}
            </View>
            {top ? <Text style={t.top}>{top}</Text> : null}
            <Row label="Trading name" value={org.name} />
            <Row label="Legal name" value={org.legal_name} />
            <Row label="Business type" value={org.business_type} />
            <Row label="State" value={org.state} />
            <Row label="Address" value={org.address} />
            <Row label="Email" value={org.email} />
            <Row label="Phone" value={org.phone} />
            <Row label="Registration / TIN" value={org.tin} />
            <Row label="Country / currency" value={`Nigeria · ${org.currency}`} />
            {editBtn("profile")}
          </>
        )}
      </Card>

      <Card title="Tax">
        {mode === "tax" ? (
          <>
            {top ? <Text style={t.top}>{top}</Text> : null}
            <View style={t.switchRow}>
              <Text style={[u.rowTitle, { flex: 1 }]}>VAT registered</Text>
              <Switch value={f.vat_registered} onValueChange={(v) => setF((p) => ({ ...p, vat_registered: v }))} disabled={busy} trackColor={{ true: C.forest, false: undefined }} accessibilityLabel="VAT registered" />
            </View>
            <Field label="VAT rate (%)" value={f.vat_rate} onChange={set("vat_rate")} error={err.vat_rate} keyboardType="decimal-pad" editable={!busy} />
            <Field label="Default WHT rate (%)" value={f.wht_rate} onChange={set("wht_rate")} error={err.wht_rate} keyboardType="decimal-pad" editable={!busy} />
            <Field label="TIN" value={f.tin} onChange={set("tin")} error={err.tin} autoCapitalize="none" editable={!busy}
              hint="Changes apply to new documents only. Issued invoices keep the rate they were issued with." />
            <Buttons busy={busy} onSave={saveTax} onCancel={() => setMode(null)} />
          </>
        ) : (
          <>
            <Row label="TIN" value={org.tin} />
            <Row label="VAT registered" value={org.vat_registered ? "Yes" : "No"} />
            <Row label="VAT number" value={org.vat_number} />
            <Row label="VAT rate" value={`${org.vat_rate_bps / 100}%`} />
            <Row label="Default WHT rate" value={`${org.default_wht_rate_bps / 100}%`} />
            <Row label="Currency" value={org.currency} />
            {editBtn("tax")}
          </>
        )}
      </Card>
    </>
  );
}

const t = StyleSheet.create({
  toast: { position: "absolute", left: 24, right: 24, bottom: 96, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center", zIndex: 50, elevation: 8 },
  text: { color: "#fff", fontWeight: "700", fontSize: 14 },
  btn: { borderRadius: 12, paddingVertical: 12, alignItems: "center", flex: 1 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  edit: { alignSelf: "flex-start", marginTop: 10, backgroundColor: C.forestSoft, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  editText: { color: C.forest, fontWeight: "700", fontSize: 13.5 },
  top: { color: C.danger, fontSize: 13, marginBottom: 8 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 6 },
  logo: { width: 64, height: 64, borderRadius: 12, resizeMode: "contain", backgroundColor: C.border2 },
  logoEmpty: { alignItems: "center", justifyContent: "center" },
  switchRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, marginBottom: 6 },
});
