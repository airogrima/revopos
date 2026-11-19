import { useOrgData } from "./org";

export interface ModulesState {
  industry: string | null;
  onboardingDone: boolean;
  enabled: string[];
  /** Switched on by the owner but not covered by the plan: shown as locked. */
  locked: { key: string; label: string; badge: string }[];
  tier: string | null;
  keys: string[];
  isAdmin: boolean;
}

const EMPTY: ModulesState = { industry: null, onboardingDone: true, enabled: [], locked: [], tier: null, keys: [], isAdmin: false };

/**
 * Which modules this business has on, and which permission keys the signed-in
 * person holds. Used to shape menus only; the database enforces the same rules.
 */
export function useModules() {
  const state = useOrgData<ModulesState>(async (supabase, orgId) => {
    const [mods, keys] = await Promise.all([
      supabase.rpc("my_modules", { target_org: orgId }),
      supabase.rpc("my_permission_keys", { target_org: orgId }),
    ]);
    if (mods.error) throw new Error(mods.error.message);
    const m = (mods.data ?? {}) as { industry: string | null; onboarding_done: boolean; modules: { key: string; label: string; badge: string; selected: boolean; entitled: boolean; enabled: boolean }[]; tier?: string };
    const k = (keys.data ?? {}) as { keys?: string[]; is_admin?: boolean };
    return {
      industry: m.industry, onboardingDone: m.onboarding_done,
      enabled: (m.modules ?? []).filter((x) => x.enabled).map((x) => x.key),
      locked: (m.modules ?? []).filter((x) => x.selected && !x.entitled).map((x) => ({ key: x.key, label: x.label, badge: x.badge })),
      tier: m.tier ?? null,
      keys: k.keys ?? [], isAdmin: !!k.is_admin,
    };
  });
  const s = state.data ?? EMPTY;
  return {
    ...state, mods: s,
    has: (module: string) => s.enabled.includes(module),
    can: (...perms: string[]) => perms.length === 0 || s.isAdmin || perms.some((p) => s.keys.includes(p)),
  };
}
