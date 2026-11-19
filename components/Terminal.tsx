import { useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { C } from "../theme";
import { Card, Loading, u } from "./ui";
import { Ghost, Message, Primary } from "./mini";
import { useTerminal, type TerminalStaffRow } from "../lib/terminal";
import { useModules } from "../lib/modules";

/** The numeric pad shared by staff sign-in and manager approval. */
function PinPad({ pin, setPin }: { pin: string; setPin: (p: string) => void }) {
  const press = (d: string) => setPin(pin.length < 6 ? pin + d : pin);
  return (
    <View>
      <View style={t.dots}>{Array.from({ length: 6 }, (_, i) => <View key={i} style={[t.dot, i < pin.length && t.dotOn]} />)}</View>
      <View style={t.pad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d, i) => (
          d === "" ? <View key={i} style={t.key} /> :
          <Pressable key={i} style={t.key} onPress={() => (d === "⌫" ? setPin(pin.slice(0, -1)) : press(d))} accessibilityLabel={d === "⌫" ? "Delete" : d}>
            <Text style={t.keyText}>{d}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * Wraps a selling screen. On a shared terminal nothing shows until someone
 * signs in with their PIN; otherwise the screen renders as normal.
 */
export function PinGate({ children }: { children: ReactNode }) {
  const term = useTerminal();
  const [people, setPeople] = useState<TerminalStaffRow[] | null>(null);
  const [pick, setPick] = useState<TerminalStaffRow | null>(null);
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mustChange, setMustChange] = useState(false);
  const [next, setNext] = useState("");
  const needed = term.mode && !term.staff;

  useEffect(() => { if (needed) void term.listStaff().then(setPeople).catch(() => setPeople([])); }, [needed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!term.ready) return <Loading label="Getting the till ready…" />;
  if (!needed && !mustChange) return <>{children}</>;

  if (mustChange) {
    return (
      <Card title="Choose a new PIN" subtitle="Your manager gave you a temporary PIN. Pick one only you know (4 to 6 digits).">
        <PinPad pin={next} setPin={setNext} />
        <Message text={msg} />
        <Primary label="Save PIN" busy={busy} disabled={next.length < 4} onPress={async () => {
          setBusy(true);
          const r = await term.changePin(pin, next);
          setBusy(false);
          if (!r.ok) return setMsg(r.message);
          setMustChange(false); setPick(null); setPin(""); setNext(""); setMsg(null);
        }} />
      </Card>
    );
  }

  if (!pick) {
    return (
      <Card title="Who is working?" subtitle="Choose your name, then enter your PIN.">
        {people === null ? <Loading label="Loading staff…" /> : people.length === 0
          ? <Text style={u.rowMeta}>No staff have a PIN yet. An owner or admin can add them on the web under Staff and access.</Text>
          : people.map((p) => (
            <Pressable key={p.id} disabled={p.locked} style={[t.person, p.locked && { opacity: 0.45 }]} onPress={() => { setPick(p); setPin(""); setMsg(null); }}>
              <View style={t.avatar}><Text style={t.avatarText}>{p.full_name.slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}><Text style={u.rowTitle}>{p.full_name}</Text>
                <Text style={u.rowMeta}>{p.locked ? "Locked for a few minutes" : p.role_label ?? "Staff"}</Text></View>
            </Pressable>
          ))}
      </Card>
    );
  }

  return (
    <Card title={`Hello, ${pick.full_name.split(" ")[0]}`} subtitle="Enter your PIN">
      <PinPad pin={pin} setPin={(p) => { setMsg(null); setPin(p); }} />
      <Message text={msg} />
      <Primary label="Unlock" busy={busy} disabled={pin.length < 4} onPress={async () => {
        setBusy(true);
        const r = await term.login(pick.id, pin);
        setBusy(false);
        if (!r.ok) { setMsg(r.message + (r.attemptsLeft !== undefined ? ` ${r.attemptsLeft} tries left.` : "")); setPin(""); return; }
        if (r.mustChangePin) { setMustChange(true); setMsg(null); }
      }} />
      <Ghost label="Back" onPress={() => { setPick(null); setPin(""); setMsg(null); }} />
    </Card>
  );
}

/** Who is acting, with Lock and Switch user. Admins can switch terminal mode on or off. */
export function TerminalBar({ offer = false }: { offer?: boolean }) {
  const term = useTerminal();
  const { mods } = useModules();
  if (!term.ready) return null;
  if (!term.mode) {
    if (!offer || !mods.isAdmin) return null;
    return (
      <View style={t.bar}>
        <Text style={[u.rowMeta, { flex: 1 }]}>Shared till mode is off</Text>
        <Ghost label="Turn on" onPress={() => void term.setMode(true)} />
      </View>
    );
  }
  return (
    <View style={t.bar}>
      <Text style={[u.rowTitle, { flex: 1 }]} numberOfLines={1}>
        {term.staff ? `${term.staff.name}${term.staff.role ? ` · ${term.staff.role}` : ""}` : "Locked"}
      </Text>
      {term.staff && <Ghost label="Lock" onPress={() => void term.lock()} />}
      {term.staff && <Ghost label="Switch user" onPress={() => void term.lock()} />}
      {mods.isAdmin && <Ghost label="Leave shared mode" onPress={() => void term.setMode(false)} />}
    </View>
  );
}

/** Asks a manager for their PIN once. Resolves with a single-use approval token. */
export function ApprovalSheet({ visible, title, onClose, onApproved }: { visible: boolean; title: string; onClose: () => void; onApproved: (token: string) => void }) {
  const term = useTerminal();
  const [people, setPeople] = useState<TerminalStaffRow[]>([]);
  const [who, setWho] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setPin(""); setMsg(null);
    void term.listStaff().then((p) => { setPeople(p); setWho((w) => w || p[0]?.id || ""); }).catch(() => {});
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={t.backdrop}>
        <View style={t.sheet}>
          <Text style={u.cardTitle}>{title}</Text>
          <Text style={u.cardSub}>A manager or owner enters their PIN to approve this one action.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 8 }}>
            {people.map((p) => (
              <Pressable key={p.id} onPress={() => setWho(p.id)} style={[t.chip, who === p.id && t.chipOn]}>
                <Text style={[t.chipText, who === p.id && { color: "#fff" }]}>{p.full_name}</Text>
              </Pressable>
            ))}
          </View>
          <PinPad pin={pin} setPin={(p) => { setMsg(null); setPin(p); }} />
          <Message text={msg} />
          <Primary label="Approve" busy={busy} disabled={pin.length < 4 || !who} onPress={async () => {
            setBusy(true);
            const r = await term.approve(who, pin);
            setBusy(false);
            if (!r.ok) { setMsg(r.message ?? "Could not approve."); setPin(""); return; }
            onApproved(r.token!);
          }} />
          <Ghost label="Cancel" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const t = StyleSheet.create({
  dots: { flexDirection: "row", justifyContent: "center", gap: 10, marginVertical: 14 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: C.border },
  dotOn: { backgroundColor: C.primary, borderColor: C.primary },
  pad: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10 },
  key: { width: "28%", height: 54, borderRadius: 14, backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  keyText: { fontSize: 22, fontWeight: "600", color: C.text },
  person: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border2 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700" },
  bar: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 10, flexWrap: "wrap" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 30 },
  chip: { borderWidth: 1, borderColor: C.border, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 13, color: C.text },
});
