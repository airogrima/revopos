import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { getClient, secureStorage } from "./supabase";
import { useOrg } from "./org";

/**
 * Shared-terminal staff sessions.
 *
 * A PIN is never stored or hashed here: it goes to the database once
 * (staff_pin_login, bcrypt, five wrong tries lock that person for five
 * minutes) and a session token comes back. The token lives in the OS keystore,
 * is checked by the database on every sale, and expires after the business's
 * inactivity window. Permissions are decided in SQL; the list kept here only
 * shapes what the screens offer.
 */

const MODE_KEY = "rp_terminal_mode";
const TOKEN_KEY = "rp_staff_token";

export interface ActingStaff { id: string; name: string; role: string | null; permissions: string[] }
export interface TerminalStaffRow { id: string; full_name: string; role_label: string | null; locked: boolean }
export interface PinOutcome { ok: boolean; message?: string; mustChangePin?: boolean; attemptsLeft?: number; token?: string }

interface TerminalValue {
  ready: boolean;
  mode: boolean;
  staff: ActingStaff | null;
  /** Session token to pass as p_staff_token; null when nobody is acting. */
  token: string | null;
  lockMinutes: number;
  setMode: (on: boolean) => Promise<void>;
  listStaff: () => Promise<TerminalStaffRow[]>;
  login: (staffId: string, pin: string) => Promise<PinOutcome>;
  approve: (staffId: string, pin: string) => Promise<PinOutcome>;
  changePin: (oldPin: string, newPin: string) => Promise<{ ok: boolean; message: string }>;
  lock: () => Promise<void>;
  /** Call on any user action so the inactivity timer restarts. */
  touch: () => void;
  /** Permission check for the acting staff member (terminal mode only). */
  staffCan: (key: string) => boolean;
}

const REASONS: Record<string, string> = {
  wrong_pin: "That PIN is not right.",
  locked: "Too many wrong PINs. This person is locked for a few minutes.",
  unavailable: "PIN sign-in is not available for this person.",
};

const noop = async () => {};
const Ctx = createContext<TerminalValue>({
  ready: false, mode: false, staff: null, token: null, lockMinutes: 10,
  setMode: noop, listStaff: async () => [], login: async () => ({ ok: false }), approve: async () => ({ ok: false }),
  changePin: async () => ({ ok: false, message: "" }), lock: noop, touch: () => {}, staffCan: () => false,
});

export function TerminalProvider({ children }: { children: ReactNode }) {
  const { orgId } = useOrg();
  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState(false);
  const [staff, setStaff] = useState<ActingStaff | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [lockMinutes, setLockMinutes] = useState(10);
  const last = useRef(Date.now());

  const clear = useCallback(async () => {
    setStaff(null); setToken(null);
    await secureStorage.removeItem(TOKEN_KEY);
  }, []);

  const loadInfo = useCallback(async (tok: string): Promise<ActingStaff | null> => {
    if (!orgId) return null;
    const c = await getClient();
    const { data } = await c.rpc("staff_session_info", { target_org: orgId, token: tok });
    if (!data) return null;
    const d = data as { id: string; name: string; role: string | null; permissions: string[] };
    return { id: d.id, name: d.name, role: d.role, permissions: d.permissions ?? [] };
  }, [orgId]);

  // Restore the device's mode and any still-valid staff session.
  useEffect(() => {
    if (!orgId) return;
    let off = false;
    (async () => {
      try {
        const [m, t] = await Promise.all([secureStorage.getItem(MODE_KEY), secureStorage.getItem(TOKEN_KEY)]);
        if (off) return;
        setModeState(m === "1");
        const c = await getClient();
        const { data: o } = await c.from("organizations").select("terminal_lock_minutes").eq("id", orgId).maybeSingle();
        if (!off && o) setLockMinutes((o as { terminal_lock_minutes: number }).terminal_lock_minutes ?? 10);
        if (t) {
          const info = await loadInfo(t);
          if (off) return;
          if (info) { setStaff(info); setToken(t); } else await clear();
        }
      } catch { /* offline at launch: stay locked until PIN can be checked */ }
      finally { if (!off) setReady(true); }
    })();
    return () => { off = true; };
  }, [orgId, loadInfo, clear]);

  const lock = useCallback(async () => {
    const t = token;
    await clear();
    if (t && orgId) { try { const c = await getClient(); await c.rpc("staff_logout", { target_org: orgId, token: t }); } catch { /* expires on its own */ } }
  }, [token, orgId, clear]);

  // Inactivity lock: when the app comes back after the window, or the window passes while open.
  useEffect(() => {
    if (!mode || !staff) return;
    const limit = lockMinutes * 60000;
    const check = () => { if (Date.now() - last.current > limit) void lock(); };
    const id = setInterval(check, 20000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") check(); else last.current = Math.min(last.current, Date.now()); });
    return () => { clearInterval(id); sub.remove(); };
  }, [mode, staff, lockMinutes, lock]);

  const value = useMemo<TerminalValue>(() => ({
    ready, mode, staff, token, lockMinutes,
    setMode: async (on) => {
      if (on) await secureStorage.setItem(MODE_KEY, "1"); else { await secureStorage.removeItem(MODE_KEY); }
      if (!on) await lock();
      setModeState(on);
    },
    listStaff: async () => {
      if (!orgId) return [];
      const c = await getClient();
      const { data } = await c.rpc("list_terminal_staff", { target_org: orgId });
      return (data ?? []) as TerminalStaffRow[];
    },
    login: async (staffId, pin) => {
      if (!orgId) return { ok: false, message: "Not ready." };
      try {
        const c = await getClient();
        const { data, error } = await c.rpc("staff_pin_login", { target_org: orgId, target_staff: staffId, pin, kind: "session" });
        if (error) return { ok: false, message: "Could not check the PIN. Check your connection and try again." };
        const r = data as { ok: boolean; reason?: string; token?: string; must_change_pin?: boolean; attempts_left?: number };
        if (!r.ok) return { ok: false, message: REASONS[r.reason ?? "wrong_pin"] ?? "Could not sign in.", attemptsLeft: r.attempts_left };
        const info = await loadInfo(r.token!);
        if (!info) return { ok: false, message: "Could not start the session." };
        await secureStorage.setItem(TOKEN_KEY, r.token!);
        last.current = Date.now();
        setToken(r.token!); setStaff(info);
        return { ok: true, mustChangePin: !!r.must_change_pin, token: r.token };
      } catch { return { ok: false, message: "Could not reach the server. Try again." }; }
    },
    approve: async (staffId, pin) => {
      if (!orgId) return { ok: false, message: "Not ready." };
      try {
        const c = await getClient();
        const { data, error } = await c.rpc("staff_pin_login", { target_org: orgId, target_staff: staffId, pin, kind: "approval" });
        if (error) return { ok: false, message: "Could not check the PIN." };
        const r = data as { ok: boolean; reason?: string; token?: string };
        return r.ok ? { ok: true, token: r.token } : { ok: false, message: REASONS[r.reason ?? "wrong_pin"] ?? "Could not approve." };
      } catch { return { ok: false, message: "Could not reach the server." }; }
    },
    changePin: async (oldPin, newPin) => {
      if (!orgId || !token) return { ok: false, message: "Your session has locked. Enter your PIN again." };
      const c = await getClient();
      const { data, error } = await c.rpc("change_my_pin", { target_org: orgId, token, old_pin: oldPin, new_pin: newPin });
      if (error) return { ok: false, message: "Could not change the PIN." };
      const r = data as { ok: boolean; reason?: string };
      if (r.ok) return { ok: true, message: "PIN changed." };
      const msg: Record<string, string> = { wrong_pin: "Your current PIN is not right.", invalid_pin: "A PIN is 4 to 6 digits.", same_pin: "Choose a different PIN.", locked: "Your session has locked." };
      return { ok: false, message: msg[r.reason ?? ""] ?? "Could not change the PIN." };
    },
    lock,
    touch: () => { last.current = Date.now(); },
    staffCan: (key) => !!staff && (staff.permissions.includes("*") || staff.permissions.includes(key)),
  }), [ready, mode, staff, token, lockMinutes, orgId, lock, loadInfo]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTerminal = () => useContext(Ctx);

/** A refusal that a manager's PIN would clear. */
export const needsApproval = (raw: string) => /do not have permission|42501|not allowed/i.test(raw);
/** The staff session has locked and a PIN is needed. */
export const sessionLocked = (raw: string) => /locked|28000/i.test(raw);
