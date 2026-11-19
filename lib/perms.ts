import { useOrgData } from "./org";

export interface Permissions {
  role: string | null; pos: boolean; pos_view: boolean; pos_discount: boolean; stock: boolean;
  production: boolean; hrm: boolean; budgets: boolean; bank: boolean; manage: boolean;
}

const NONE: Permissions = {
  role: null, pos: false, pos_view: false, pos_discount: false, stock: false,
  production: false, hrm: false, budgets: false, bank: false, manage: false,
};

/**
 * What the signed-in user may do, from the database. Screens use it to shape
 * what they show; the same rules are enforced again by RLS and the functions.
 */
export function usePermissions() {
  const state = useOrgData<Permissions>(async (supabase, orgId) => {
    const { data, error } = await supabase.rpc("my_permissions", { target_org: orgId });
    if (error) throw new Error(error.message);
    return { ...NONE, ...(data as Partial<Permissions>) };
  });
  return { ...state, perms: state.data ?? NONE };
}

/** A key for a sale, made when the cart starts and reused on every retry. */
export const newKey = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;

/** A database refusal in plain words. */
export function friendly(raw: string): string {
  if (/permission|not allowed|row-level security|42501/i.test(raw)) return "You do not have permission to do that.";
  return raw.replace(/^.*?ERROR:\s*/i, "");
}
