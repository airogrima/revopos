import { useState } from "react";
import { Share, Text, TextInput, View, StyleSheet } from "react-native";
import * as Clipboard from "expo-clipboard";
import { getClient } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { C } from "../theme";
import { Card, Loading, Row, u } from "./ui";
import { Ghost, Message, Primary } from "./mini";

interface Info {
  code: string; referred_by: { name: string; code: string } | null;
  referred_count: number; qualified_count: number; can_apply: boolean;
}

const BASE = process.env.EXPO_PUBLIC_APP_URL ?? "https://revopass.revospace.ng";

/** Affiliate / referral: the business's code, copy and share, and who referred it. */
export default function ReferralCard() {
  const { orgId } = useOrg();
  const { loading, data, reload } = useOrgData<Info | null>(async (c, org) => {
    const { data: d, error } = await c.rpc("my_referral", { target_org: org });
    return error ? null : (d as Info);
  });
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading label="Loading referral…" />;
  if (!data) return null;
  const link = `${BASE}/signup?ref=${encodeURIComponent(data.code)}`;

  const apply = async () => {
    setBusy(true); setMsg(null);
    try {
      const c = await getClient();
      const { data: r, error } = await c.rpc("apply_referral", { target_org: orgId, p_code: code.trim() });
      if (error) throw new Error(error.message);
      const res = r as { ok: boolean; message: string };
      setMsg({ text: res.message, ok: res.ok });
      if (res.ok) { setCode(""); reload(); }
    } catch { setMsg({ text: "We couldn’t apply that code right now.", ok: false }); }
    finally { setBusy(false); }
  };

  return (
    <Card title="Affiliate / Referral" subtitle="Share your code with other businesses. They can enter it when they sign up.">
      <Text style={s.code} selectable>{data.code}</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Ghost label="Copy code" onPress={async () => { await Clipboard.setStringAsync(data.code); setMsg({ text: "Code copied.", ok: true }); }} />
        <Ghost label="Copy link" onPress={async () => { await Clipboard.setStringAsync(link); setMsg({ text: "Link copied.", ok: true }); }} />
      </View>
      <Primary label="Share referral link" onPress={() => void Share.share({ message: `Run your business with RevoPass. Sign up with my code ${data.code}: ${link}` })} />
      <Message text={msg?.text ?? null} ok={msg?.ok ?? false} />
      <Row title="Businesses referred" amount={String(data.referred_count)} />
      <Row title="Referred by" meta={data.referred_by ? `${data.referred_by.name} (${data.referred_by.code})` : "Not referred by another RevoPass user."} />
      {!data.referred_by && data.can_apply && (
        <View style={{ marginTop: 8 }}>
          <Text style={u.rowMeta}>Have a referral code? Enter it here.</Text>
          <TextInput style={s.input} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="REV-XXXXXX" placeholderTextColor={C.text3} />
          <Ghost label={busy ? "Applying…" : "Apply code"} onPress={() => void apply()} />
        </View>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  code: { fontSize: 24, fontWeight: "700", letterSpacing: 1.5, color: C.text, marginVertical: 8 },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: C.text, minHeight: 46, marginVertical: 6 },
});
