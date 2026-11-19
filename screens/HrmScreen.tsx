/** HRM: staff, clocking in and out, and leave. */
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { getClient } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { friendly, usePermissions } from "../lib/perms";
import { C } from "../theme";
import { Card, EmptyState, ErrorView, Loading, Screen, ScreenTitle, u } from "../components/ui";
import { Chips, Ghost, Input, Message, Picker, Primary } from "../components/mini";

interface Emp { id: string; full_name: string; job_title: string | null; department: string | null; is_active: boolean; user_id: string | null; employment_status: string }
interface Leave { id: string; leave_type: string; start_date: string; end_date: string; status: string; employee_id: string; employees: { full_name: string; user_id: string | null } | null }
interface Today { employee_id: string; clock_in: string | null; clock_out: string | null }

const LEAVE_TYPES = ["annual", "sick", "maternity", "paternity", "compassionate", "unpaid", "other"].map((v) => ({ value: v, label: v }));
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default function HrmScreen() {
  const { orgId } = useOrg();
  const { perms } = usePermissions();
  const { loading, refreshing, error, data, reload, onRefresh } = useOrgData<{ emps: Emp[]; leave: Leave[]; today: Today[]; me: string }>(async (supabase, org) => {
    const { data: u2 } = await supabase.auth.getUser();
    const today = new Date().toISOString().slice(0, 10);
    const [e, l, a] = await Promise.all([
      supabase.from("employees").select("id,full_name,job_title,department,is_active,user_id,employment_status").eq("org_id", org).order("is_active", { ascending: false }).order("full_name"),
      supabase.from("leave_requests").select("id,leave_type,start_date,end_date,status,employee_id,employees(full_name,user_id)").eq("org_id", org).order("start_date", { ascending: false }).limit(60),
      supabase.from("attendance_records").select("employee_id,clock_in,clock_out").eq("org_id", org).eq("work_date", today),
    ]);
    if (e.error) throw new Error(e.error.message);
    return { emps: (e.data ?? []) as Emp[], leave: (l.data ?? []) as unknown as Leave[], today: (a.data ?? []) as Today[], me: u2.user?.id ?? "" };
  });

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(""); const [title, setTitle] = useState(""); const [phone, setPhone] = useState("");
  const [asking, setAsking] = useState(false);
  const [forEmp, setForEmp] = useState(""); const [ltype, setLtype] = useState("annual");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  if (loading) return <Loading label="Loading staff…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  const emps = data?.emps ?? []; const leave = data?.leave ?? []; const me = data?.me ?? "";
  const mine = emps.find((e) => e.user_id === me && e.is_active);
  const myToday = (data?.today ?? []).find((t) => t.employee_id === mine?.id);
  const askable = perms.hrm ? emps.filter((e) => e.is_active) : emps.filter((e) => e.user_id === me);

  const run = async (work: (c: Awaited<ReturnType<typeof getClient>>) => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true); setMsg(null);
    try {
      const { error: e } = await work(await getClient());
      if (e) throw new Error(e.message);
      setMsg({ text: ok, ok: true }); reload(); return true;
    } catch (e) { setMsg({ text: friendly(e instanceof Error ? e.message : String(e)), ok: false }); return false; }
    finally { setBusy(false); }
  };

  const addEmployee = async () => {
    if (name.trim() === "") return setMsg({ text: "Enter the person's name.", ok: false });
    const { data: u2 } = await (await getClient()).auth.getUser();
    const ok = await run((c) => c.from("employees").insert({ org_id: orgId, full_name: name.trim(), job_title: title.trim() || null, phone: phone.trim() || null, created_by: u2.user?.id ?? null }), `${name.trim()} added.`);
    if (ok) { setAdding(false); setName(""); setTitle(""); setPhone(""); }
  };

  const requestLeave = async () => {
    if (forEmp === "") return setMsg({ text: "Choose who the leave is for.", ok: false });
    if (!ISO.test(from) || !ISO.test(to)) return setMsg({ text: "Enter dates as YYYY-MM-DD.", ok: false });
    if (to < from) return setMsg({ text: "The end date is before the start date.", ok: false });
    const { data: u2 } = await (await getClient()).auth.getUser();
    const ok = await run((c) => c.from("leave_requests").insert({ org_id: orgId, employee_id: forEmp, leave_type: ltype, start_date: from, end_date: to, reason: reason.trim() || null, created_by: u2.user?.id ?? null }), "Leave request sent.");
    if (ok) { setAsking(false); setFrom(""); setTo(""); setReason(""); }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="HRM" subtitle={perms.hrm ? `${emps.filter((e) => e.is_active).length} active staff` : "Your staff record"} />
      <Message text={msg?.text ?? null} ok={msg?.ok ?? false} />

      {mine ? (
        <Card title="Your day" subtitle={myToday?.clock_in ? (myToday.clock_out ? "Clocked out for today." : "You are clocked in.") : "Not clocked in yet."}>
          <Primary label="Clock in" busy={busy} disabled={!!myToday?.clock_in} onPress={() => void run(async (c) => { const r = await c.rpc("clock_in", { target_org: orgId }); return { error: r.error }; }, "Clocked in.")} />
          <Ghost label="Clock out" onPress={() => void run(async (c) => { const r = await c.rpc("clock_out", { target_org: orgId }); return { error: r.error }; }, "Clocked out.")} />
        </Card>
      ) : null}

      {perms.hrm && !adding ? <Primary label="Add employee" onPress={() => { setAdding(true); setMsg(null); }} /> : null}
      {adding ? (
        <Card title="New employee">
          <Input label="Full name" value={name} onChange={setName} />
          <Input label="Job title" value={title} onChange={setTitle} />
          <Input label="Phone" value={phone} onChange={setPhone} keyboard="phone-pad" />
          <Primary label="Save employee" busy={busy} onPress={() => void addEmployee()} />
          <Ghost label="Cancel" onPress={() => setAdding(false)} />
        </Card>
      ) : null}

      <Card title="Staff">
        {emps.length === 0 ? (
          <EmptyState title="No employees yet" body={perms.hrm ? "Add your staff to keep their details, attendance and leave in one place." : "HR has not added a staff record for you yet."} />
        ) : emps.map((e, i) => (
          <View key={e.id} style={[{ paddingVertical: 10 }, i > 0 && { borderTopWidth: 1, borderTopColor: C.border2 }]}>
            <Text style={u.rowTitle}>{e.full_name}{e.is_active ? "" : " (inactive)"}</Text>
            <Text style={u.rowMeta}>{[e.job_title, e.department, e.employment_status.replace("_", " ")].filter(Boolean).join(" · ")}</Text>
          </View>
        ))}
      </Card>

      {askable.length > 0 && !asking ? <Ghost label="Request leave" onPress={() => { setAsking(true); setMsg(null); if (askable.length === 1) setForEmp(askable[0]!.id); }} /> : null}
      {asking ? (
        <Card title="Request leave">
          <Text style={u.rowMeta}>For</Text>
          <Picker options={askable.map((e) => ({ value: e.id, label: e.full_name }))} value={forEmp} onChange={setForEmp} placeholder="Choose" />
          <Text style={[u.rowMeta, { marginTop: 10 }]}>Type</Text>
          <Chips options={LEAVE_TYPES} value={ltype} onChange={setLtype} />
          <Input label="From (YYYY-MM-DD)" value={from} onChange={setFrom} />
          <Input label="To (YYYY-MM-DD)" value={to} onChange={setTo} />
          <Input label="Reason" value={reason} onChange={setReason} />
          <Primary label="Send request" busy={busy} onPress={() => void requestLeave()} />
          <Ghost label="Cancel" onPress={() => setAsking(false)} />
        </Card>
      ) : null}

      <Card title="Leave">
        {leave.length === 0 ? <Text style={u.rowMeta}>No leave requests.</Text> : leave.map((l, i) => (
          <View key={l.id} style={[{ paddingVertical: 10 }, i > 0 && { borderTopWidth: 1, borderTopColor: C.border2 }]}>
            <Text style={u.rowTitle}>{l.employees?.full_name} · {l.leave_type}</Text>
            <Text style={u.rowMeta}>{l.start_date} to {l.end_date} · {l.status}</Text>
            {l.status === "pending" ? (
              <View style={{ flexDirection: "row", gap: 14, flexWrap: "wrap" }}>
                {perms.hrm && l.employees?.user_id !== me ? (
                  <>
                    <Pressable style={{ minHeight: 44, justifyContent: "center" }} onPress={() => void run(async (c) => { const r = await c.rpc("decide_leave", { target_leave: l.id, decision: "approved" }); return { error: r.error }; }, "Leave approved.")}><Text style={{ color: C.primary, fontWeight: "600" }}>Approve</Text></Pressable>
                    <Pressable style={{ minHeight: 44, justifyContent: "center" }} onPress={() => void run(async (c) => { const r = await c.rpc("decide_leave", { target_leave: l.id, decision: "rejected" }); return { error: r.error }; }, "Leave rejected.")}><Text style={{ color: C.danger, fontWeight: "600" }}>Reject</Text></Pressable>
                  </>
                ) : null}
                <Pressable style={{ minHeight: 44, justifyContent: "center" }} onPress={() => Alert.alert("Cancel this request?", "", [{ text: "Keep", style: "cancel" }, { text: "Cancel request", style: "destructive", onPress: () => void run(async (c) => { const r = await c.rpc("cancel_leave", { target_leave: l.id }); return { error: r.error }; }, "Request cancelled.") }])}><Text style={{ color: C.text2, fontWeight: "600" }}>Cancel</Text></Pressable>
              </View>
            ) : null}
          </View>
        ))}
      </Card>
    </Screen>
  );
}
