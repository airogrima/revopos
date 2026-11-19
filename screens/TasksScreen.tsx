/** To-Do List: tasks you own, tasks you gave out, and everything for managers. */
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { getClient } from "../lib/supabase";
import { useOrg, useOrgData } from "../lib/org";
import { friendly, usePermissions } from "../lib/perms";
import { C } from "../theme";
import { Card, EmptyState, ErrorView, Loading, Screen, ScreenTitle, u } from "../components/ui";
import { Chips, Input, Message, Picker, Primary, Ghost } from "../components/mini";

interface Task { id: string; title: string; description: string | null; due_date: string | null; priority: string; status: string; assigned_to: string | null; created_by: string | null }
type View2 = "my" | "all" | "today" | "overdue" | "completed";
const PRI = ["low", "medium", "high", "urgent"].map((v) => ({ value: v, label: v }));
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default function TasksScreen() {
  const { orgId } = useOrg();
  const { perms } = usePermissions();
  const { loading, refreshing, error, data, reload, onRefresh } = useOrgData<{ tasks: Task[]; people: { value: string; label: string }[]; me: string }>(async (supabase, org) => {
    const { data: u2 } = await supabase.auth.getUser();
    const [t, p] = await Promise.all([
      supabase.from("tasks").select("id,title,description,due_date,priority,status,assigned_to,created_by").eq("org_id", org).order("due_date", { ascending: true, nullsFirst: false }).limit(300),
      supabase.from("memberships").select("user_id,profiles(full_name,email)").eq("org_id", org),
    ]);
    if (t.error) throw new Error(t.error.message);
    const people = ((p.data ?? []) as unknown as { user_id: string; profiles: { full_name: string | null; email: string | null } | null }[])
      .map((m) => ({ value: m.user_id, label: m.profiles?.full_name || m.profiles?.email || "Team member" }));
    return { tasks: (t.data ?? []) as Task[], people, me: u2.user?.id ?? "" };
  });

  const [view, setView] = useState<View2>("my");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState(""); const [due, setDue] = useState(""); const [priority, setPriority] = useState("medium");
  const [assignee, setAssignee] = useState(""); const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  if (loading) return <Loading label="Loading tasks…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  const all = data?.tasks ?? []; const people = data?.people ?? []; const me = data?.me ?? "";
  const today = new Date().toISOString().slice(0, 10);
  const open = (t: Task) => t.status === "todo" || t.status === "in_progress";
  const shown = all.filter((t) =>
    view === "my" ? t.assigned_to === me && open(t)
    : view === "today" ? open(t) && t.due_date === today
    : view === "overdue" ? open(t) && !!t.due_date && t.due_date < today
    : view === "completed" ? t.status === "completed" : true);
  const views = [{ value: "my", label: "My tasks" }, ...(perms.manage ? [{ value: "all", label: "All" }] : []),
    { value: "today", label: "Today" }, { value: "overdue", label: "Overdue" }, { value: "completed", label: "Done" }] as { value: View2; label: string }[];

  const run = async (work: (c: Awaited<ReturnType<typeof getClient>>) => PromiseLike<{ error: { message: string } | null }>, ok: string | null) => {
    setBusy(true); setMsg(null);
    try {
      const { error: e } = await work(await getClient());
      if (e) throw new Error(e.message);
      if (ok) setMsg({ text: ok, ok: true });
      reload(); return true;
    } catch (e) { setMsg({ text: friendly(e instanceof Error ? e.message : String(e)), ok: false }); return false; }
    finally { setBusy(false); }
  };

  const create = async () => {
    if (title.trim() === "") return setMsg({ text: "Give the task a title.", ok: false });
    if (due !== "" && !ISO.test(due)) return setMsg({ text: "Enter the due date as YYYY-MM-DD.", ok: false });
    const ok = await run((c) => c.from("tasks").insert({
      org_id: orgId, title: title.trim(), description: desc.trim() || null, due_date: due || null, priority,
      assigned_to: assignee || me, created_by: me,
    }), "Task created.");
    if (ok) { setCreating(false); setTitle(""); setDue(""); setDesc(""); setAssignee(""); setPriority("medium"); }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="To-Do List" subtitle={`${all.filter((t) => t.assigned_to === me && open(t)).length} open tasks assigned to you`} />
      <Message text={msg?.text ?? null} ok={msg?.ok ?? false} />
      {!creating ? <Primary label="New task" onPress={() => { setCreating(true); setMsg(null); }} /> : (
        <Card title="New task">
          <Input label="Title" value={title} onChange={setTitle} />
          <Input label="Due date (YYYY-MM-DD)" value={due} onChange={setDue} />
          <Text style={[u.rowMeta, { marginTop: 10 }]}>Priority</Text>
          <Chips options={PRI} value={priority} onChange={setPriority} />
          <Text style={[u.rowMeta, { marginTop: 10 }]}>Assign to</Text>
          <Picker options={people} value={assignee} onChange={setAssignee} placeholder="Me" />
          <Input label="Description" value={desc} onChange={setDesc} multiline />
          <Primary label="Create task" busy={busy} onPress={() => void create()} />
          <Ghost label="Cancel" onPress={() => setCreating(false)} />
        </Card>
      )}
      <View style={{ marginTop: 10 }}><Chips options={views} value={view} onChange={setView} /></View>

      <Card>
        {shown.length === 0 ? (
          <EmptyState title={view === "completed" ? "Nothing completed yet" : "No tasks yet"} body="Create a task to keep track of what needs doing, who owns it and when it is due." />
        ) : shown.map((t, i) => {
          const overdue = open(t) && !!t.due_date && t.due_date < today;
          return (
            <View key={t.id} style={[{ paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 }, i > 0 && { borderTopWidth: 1, borderTopColor: C.border2 }]}>
              <Pressable accessibilityLabel={t.status === "completed" ? "Reopen task" : "Complete task"} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
                         onPress={() => void run((c) => c.from("tasks").update({ status: t.status === "completed" ? "todo" : "completed" }).eq("id", t.id), null)}>
                <Text style={{ fontSize: 24, color: C.primary }}>{t.status === "completed" ? "●" : "○"}</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={[u.rowTitle, t.status === "completed" && { textDecorationLine: "line-through", color: C.text2 }]}>{t.title}</Text>
                <Text style={[u.rowMeta, overdue && { color: C.danger }]}>
                  {t.priority}{t.due_date ? ` · due ${t.due_date}` : ""}{overdue ? " · overdue" : ""}{t.status === "in_progress" ? " · in progress" : ""}
                </Text>
              </View>
              {(perms.manage || t.created_by === me) ? (
                <Pressable accessibilityLabel={`Delete ${t.title}`} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 6 }}
                           onPress={() => Alert.alert("Delete task?", t.title, [{ text: "Keep", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => void run((c) => c.from("tasks").delete().eq("id", t.id), "Task deleted.") }])}>
                  <Text style={{ color: C.danger, fontWeight: "600" }}>Delete</Text></Pressable>
              ) : null}
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}
