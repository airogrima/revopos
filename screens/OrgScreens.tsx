/**
 * Branches and Staff & Roles, on the phone.
 *
 * Same tables and rules as the web Settings and Staff pages: branches are read
 * and added with the signed-in client (RLS decides who may), and staff come
 * from staff_members (pin_hash is never selectable). Setting or resetting a
 * PIN and creating logins stays on the web, which is where those are validated.
 */

import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { getClient } from "../lib/supabase";
import { useOrgData, useOrg } from "../lib/org";
import { friendly } from "../lib/perms";
import { C } from "../theme";
import { EmptyState, ErrorView, Loading, Screen, u } from "../components/ui";
import { Avatar, Icon, ListCard, RoundAddButton, StatusBadge } from "../components/kit";

interface Branch { id: string; name: string; code: string | null; address: string | null; is_default: boolean; is_active: boolean }

export function BranchesScreen() {
  const { orgId } = useOrg();
  const { loading, error, data, reload, refreshing, onRefresh } = useOrgData<Branch[]>(async (c, org) => {
    const { data: d, error: e } = await c.from("branches").select("id,name,code,address,is_default,is_active").eq("org_id", org)
      .order("is_default", { ascending: false }).order("name");
    if (e) throw new Error(e.message);
    return (d ?? []) as Branch[];
  });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading label="Loading branches…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  const add = async () => {
    const n = name.trim();
    if (n === "") { setMsg("Give the branch a name."); return; }
    setBusy(true); setMsg(null);
    try {
      const c = await getClient();
      const { data: me } = await c.auth.getUser();
      const { error: e } = await c.from("branches")
        .insert({ org_id: orgId, name: n, code: code.trim() || null, created_by: me.user?.id ?? null });
      if (e) throw new Error(/duplicate key|unique/i.test(e.message) ? "A branch with that name already exists." : friendly(e.message));
      setName(""); setCode(""); setAdding(false); reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const toggle = (b: Branch) => Alert.alert(
    b.is_active ? `Deactivate ${b.name}?` : `Reactivate ${b.name}?`,
    b.is_active ? "It stops being offered for new sales. Its records are kept." : "It becomes available again.",
    [{ text: "Cancel", style: "cancel" }, { text: b.is_active ? "Deactivate" : "Reactivate", onPress: async () => {
      try {
        const c = await getClient();
        const { error: e } = await c.from("branches").update({ is_active: !b.is_active }).eq("id", b.id).eq("is_default", false);
        if (e) throw new Error(e.message);
        reload();
      } catch (e) { Alert.alert("Could not change the branch", friendly(e instanceof Error ? e.message : String(e))); }
    } }],
  );

  const rows = data ?? [];
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={s.head}>
        <View><Text style={u.title}>Branches</Text><Text style={u.subtitle}>{rows.length} branch{rows.length === 1 ? "" : "es"}</Text></View>
        <RoundAddButton label="Add branch" onPress={() => setAdding((v) => !v)} />
      </View>
      {adding && (
        <ListCard>
          <Text style={u.rowTitle}>New branch</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Branch name, e.g. Ikeja" placeholderTextColor={C.text3} />
          <TextInput style={s.input} value={code} onChangeText={setCode} placeholder="Short code (optional)" placeholderTextColor={C.text3} autoCapitalize="characters" maxLength={12} />
          {msg ? <Text style={s.err}>{msg}</Text> : null}
          <Pressable style={s.primary} onPress={() => void add()} disabled={busy}><Text style={s.primaryText}>{busy ? "Saving…" : "Add branch"}</Text></Pressable>
        </ListCard>
      )}
      {rows.length === 0 ? <ListCard><EmptyState title="No branches" body="Your business has no branches yet." /></ListCard> : rows.map((b) => (
        <ListCard key={b.id}>
          <View style={s.row}>
            <View style={s.icon}><Icon name="home" size={20} color={C.forest} /></View>
            <View style={{ flex: 1 }}>
              <Text style={u.rowTitle}>{b.name}</Text>
              <Text style={u.rowMeta}>{[b.code, b.address].filter(Boolean).join(" · ") || (b.is_default ? "Main branch" : "Branch")}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              {b.is_default ? <StatusBadge status="paid" label="Default" /> : <StatusBadge status={b.is_active ? "paid" : "draft"} label={b.is_active ? "Active" : "Inactive"} />}
              {!b.is_default && <Pressable onPress={() => toggle(b)} hitSlop={8}><Text style={s.link}>{b.is_active ? "Deactivate" : "Reactivate"}</Text></Pressable>}
            </View>
          </View>
        </ListCard>
      ))}
    </Screen>
  );
}

interface Staff { id: string; full_name: string; email: string | null; status: string; login_method: string; role_id: string | null }

export function StaffScreen() {
  const { loading, error, data, reload, refreshing, onRefresh } = useOrgData<{ staff: Staff[]; roles: Record<string, string> }>(async (c, org) => {
    const [st, ro] = await Promise.all([
      c.from("staff_members").select("id,full_name,email,status,login_method,role_id").eq("org_id", org).order("status").order("full_name"),
      c.from("org_roles").select("id,label").eq("org_id", org),
    ]);
    if (st.error) throw new Error(st.error.message);
    return {
      staff: (st.data ?? []) as Staff[],
      roles: Object.fromEntries(((ro.data ?? []) as { id: string; label: string }[]).map((r) => [r.id, r.label])),
    };
  });
  if (loading) return <Loading label="Loading staff…" />;
  if (error) return <ErrorView message={/permission|denied|row-level/i.test(error) ? "Only owners and admins can see staff." : error} onRetry={reload} />;
  const rows = data?.staff ?? [];
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Text style={u.title}>Staff & Roles</Text>
      <Text style={[u.subtitle, { marginBottom: 14 }]}>{rows.length} member{rows.length === 1 ? "" : "s"}</Text>
      {rows.length === 0 ? <ListCard><EmptyState title="No staff yet" body="Staff accounts and PINs are created on the web app." /></ListCard> : rows.map((m) => (
        <ListCard key={m.id}>
          <View style={s.row}>
            <Avatar name={m.full_name} size={42} />
            <View style={{ flex: 1 }}>
              <Text style={u.rowTitle}>{m.full_name}</Text>
              <Text style={u.rowMeta} numberOfLines={1}>{(m.role_id && data?.roles[m.role_id]) || "No role"} · {m.login_method === "pin" ? "PIN" : m.login_method === "both" ? "PIN + login" : "Login"}</Text>
            </View>
            <StatusBadge status={m.status === "active" ? "paid" : "draft"} label={m.status} />
          </View>
        </ListCard>
      ))}
      <Text style={[u.rowMeta, { textAlign: "center", marginTop: 6 }]}>Creating staff, roles and PINs is done on the web app.</Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.forestSoft, alignItems: "center", justifyContent: "center" },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, minHeight: 48, fontSize: 15, color: C.text, marginTop: 10 },
  err: { color: C.danger, fontSize: 12.5, marginTop: 8 },
  primary: { backgroundColor: C.forest, borderRadius: 14, minHeight: 50, alignItems: "center", justifyContent: "center", marginTop: 12 },
  primaryText: { color: "#fff", fontSize: 15.5, fontWeight: "700" },
  link: { color: C.forest, fontSize: 12.5, fontWeight: "700" },
});
