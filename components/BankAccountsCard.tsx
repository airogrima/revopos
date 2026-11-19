/**
 * Bank details: any number of receiving accounts, one of them Primary.
 *
 * Mirrors the web Settings section. Validation comes from @revopass/core, the
 * same function the web action uses, so the phone and the web agree on what a
 * saveable account is. Row-level security decides who may write; a staff member
 * gets the database's refusal, shown here as a plain message.
 */
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { digitsOnly, validateBankAccount } from "@revopass/core";
import { getClient, isAuthFailure, signOut } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { C } from "../theme";
import { Card, u } from "./ui";

interface BankAccount {
  id: string;
  label: string | null;
  bank_name: string;
  account_name: string | null;
  account_number: string;
  currency: string;
  is_primary: boolean;
}

interface Draft {
  id: string | null;
  label: string; bank: string; name: string; number: string; currency: string;
  primary: boolean;
}

const blank = (first: boolean): Draft => ({
  id: null, label: "", bank: "", name: "", number: "", currency: "NGN", primary: first,
});

export default function BankAccountsCard() {
  const { orgId } = useOrg();
  const { loading, error, data, reload } = useOrgData<BankAccount[]>(async (supabase, org) => {
    const { data: rows, error: err } = await supabase
      .from("org_bank_accounts")
      .select("id,label,bank_name,account_name,account_number,currency,is_primary")
      .eq("org_id", org)
      .order("created_at");
    if (err) throw new Error(err.message);
    return (rows ?? []) as BankAccount[];
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accounts = data ?? [];

  const run = async (work: (client: Awaited<ReturnType<typeof getClient>>) => Promise<string | null>) => {
    setBusy(true);
    setMessage(null);
    try {
      const client = await getClient();
      const failure = await work(client);
      if (failure) setMessage(failure);
      else reload();
      return !failure;
    } catch (e) {
      if (isAuthFailure(e)) { void signOut(); return false; }
      setMessage(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft || !orgId) return;
    const check = validateBankAccount({
      label: draft.label, bankName: draft.bank, accountName: draft.name,
      accountNumber: draft.number, currency: draft.currency,
    });
    setErrors(check.errors);
    if (!check.ok) return;

    const ok = await run(async (client) => {
      const row = {
        label: check.clean.label, bank_name: check.clean.bankName,
        account_name: check.clean.accountName, account_number: check.clean.accountNumber,
        currency: check.clean.currency,
      };
      let id = draft.id;
      if (id) {
        const { error: e } = await client.from("org_bank_accounts").update(row).eq("id", id);
        if (e) return friendly(e.message);
      } else {
        const { data: created, error: e } = await client
          .from("org_bank_accounts").insert({ org_id: orgId, ...row }).select("id").single();
        if (e) return friendly(e.message);
        id = created.id as string;
      }
      if (draft.primary) {
        const { error: e } = await client.rpc("set_primary_bank_account", { target_account: id });
        if (e) return friendly(e.message);
      }
      return null;
    });
    if (ok) setDraft(null);
  };

  const makePrimary = (a: BankAccount) => run(async (client) => {
    const { error: e } = await client.rpc("set_primary_bank_account", { target_account: a.id });
    return e ? friendly(e.message) : null;
  });

  const confirmRemove = (a: BankAccount) => {
    const only = accounts.length === 1;
    Alert.alert(
      `Remove ${a.label || a.bank_name}?`,
      [
        `Account ${a.account_number} will be removed.`,
        a.is_primary && !only ? "Another account will become Primary." : "",
        only ? "It is your only account, so invoices will show no bank details." : "",
      ].filter(Boolean).join(" "),
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Remove", style: "destructive",
          onPress: () => {
            void run(async (client) => {
              const { error: e } = await client.from("org_bank_accounts").delete().eq("id", a.id);
              return e ? friendly(e.message) : null;
            });
          },
        },
      ],
    );
  };

  return (
    <Card title="Bank details on your invoices">
      {loading ? <ActivityIndicator color={C.primary} /> : null}
      {error ? <Text style={s.err}>{error}</Text> : null}
      {message ? <Text style={s.err}>{message}</Text> : null}

      {!loading && accounts.length === 0 && !draft ? (
        <Text style={[u.rowMeta, { lineHeight: 17, marginBottom: 8 }]}>
          Not set, so your invoices show no transfer details.
        </Text>
      ) : null}

      {accounts.map((a) => (
        <View key={a.id} style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={u.rowTitle}>
              {a.label || a.bank_name}{a.is_primary ? "  ·  Primary" : ""}
            </Text>
            <Text style={u.rowMeta}>
              {a.bank_name}{a.account_name ? ` · ${a.account_name}` : ""}
            </Text>
            <Text style={u.rowMeta}>{a.account_number} · {a.currency}</Text>
          </View>
          <View style={s.actions}>
            {!a.is_primary ? (
              <Pressable accessibilityLabel={`Make ${a.label || a.bank_name} primary`}
                         style={s.link} disabled={busy} onPress={() => void makePrimary(a)}>
                <Text style={s.linkText}>Primary</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityLabel={`Edit ${a.label || a.bank_name}`} style={s.link}
                       onPress={() => {
                         setErrors({});
                         setDraft({
                           id: a.id, label: a.label ?? "", bank: a.bank_name, name: a.account_name ?? "",
                           number: a.account_number, currency: a.currency, primary: a.is_primary,
                         });
                       }}>
              <Text style={s.linkText}>Edit</Text>
            </Pressable>
            <Pressable accessibilityLabel={`Remove ${a.label || a.bank_name}`} style={s.link}
                       disabled={busy} onPress={() => confirmRemove(a)}>
              <Text style={[s.linkText, { color: C.danger }]}>− Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {draft ? (
        <View style={s.form}>
          <Text style={u.rowTitle}>{draft.id ? "Edit bank account" : "New bank account"}</Text>
          <Input label="Label" value={draft.label} onChange={(v) => setDraft({ ...draft, label: v })}
                 placeholder="e.g. Main account, USD account" error={errors.label} />
          <Input label="Bank" value={draft.bank} onChange={(v) => setDraft({ ...draft, bank: v })}
                 placeholder="e.g. GTBank" error={errors.bank_name} />
          <Input label="Account name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
          <Input label="Account number" value={draft.number} keyboard="number-pad"
                 onChange={(v) => setDraft({ ...draft, number: digitsOnly(v) })}
                 placeholder="0123456789" error={errors.bank_account_number} />
          <Input label="Currency" value={draft.currency} caps
                 onChange={(v) => setDraft({ ...draft, currency: v.toUpperCase().slice(0, 3) })}
                 error={errors.currency} />
          <Pressable style={s.check} onPress={() => setDraft({ ...draft, primary: !draft.primary })}
                     accessibilityRole="checkbox" accessibilityState={{ checked: draft.primary }}>
            <Text style={u.rowTitle}>{draft.primary ? "☑" : "☐"}  Use as Primary account</Text>
          </Pressable>
          <View style={s.actions}>
            <Pressable style={s.ghost} onPress={() => setDraft(null)}><Text style={s.linkText}>Cancel</Text></Pressable>
            <Pressable style={[s.save, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => void save()}>
              {busy ? <ActivityIndicator color={"#fff"} /> : <Text style={s.saveText}>Save account</Text>}
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable accessibilityLabel="Add bank account" style={s.add}
                   onPress={() => { setErrors({}); setDraft(blank(accounts.length === 0)); }}>
          <Text style={s.addText}>+ Add bank account</Text>
        </Pressable>
      )}
    </Card>
  );
}

function friendly(raw: string): string {
  return /permission denied|row-level security|42501|not found/i.test(raw)
    ? "You do not have permission to change bank accounts. Only an owner or admin can."
    : raw;
}

function Input({
  label, value, onChange, placeholder, error, keyboard, caps,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; error?: string | undefined; keyboard?: "number-pad"; caps?: boolean;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={u.rowMeta}>{label}</Text>
      <TextInput
        style={[s.input, !!error && { borderColor: C.danger }]}
        value={value} onChangeText={onChange} placeholder={placeholder}
        placeholderTextColor={C.text3} keyboardType={keyboard ?? "default"}
        autoCapitalize={caps ? "characters" : "words"}
      />
      {error ? <Text style={s.err}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border2, gap: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 },
  link: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  linkText: { fontSize: 13.5, fontWeight: "600", color: C.primary },
  err: { color: C.danger, fontSize: 12.5, marginTop: 4, lineHeight: 18 },
  form: { borderTopWidth: 1, borderTopColor: C.border2, paddingTop: 12, marginTop: 4 },
  input: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: C.text, minHeight: 46, marginTop: 4,
  },
  check: { minHeight: 44, justifyContent: "center", marginTop: 6 },
  ghost: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14 },
  save: {
    backgroundColor: C.forest, borderRadius: 12, minHeight: 46, paddingHorizontal: 20,
    alignItems: "center", justifyContent: "center",
  },
  saveText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  add: {
    minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    alignItems: "center", justifyContent: "center", marginTop: 10, backgroundColor: "#fff",
  },
  addText: { fontSize: 14.5, fontWeight: "600", color: C.text },
});
