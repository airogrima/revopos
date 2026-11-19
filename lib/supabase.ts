import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Same database, same RLS policies, same RPCs as the web app — this is the
 * point of both clients sharing one Postgres rather than syncing two.
 *
 * REAL PER-USER AUTH
 *
 * This used to sign every install in as ONE shared account, with the email and
 * password supplied through EXPO_PUBLIC_ variables. Expo inlines those into the
 * JavaScript bundle, so the credentials shipped inside the app: extracting them
 * from a downloaded build is trivial, and anyone who did was inside that
 * business's books. It was a preview shortcut that could not ship.
 *
 * Now each person signs in as themselves and RLS sees the actual user, exactly
 * as it does on the web.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/**
 * Session storage backed by the device keychain / Android Keystore.
 *
 * NOT AsyncStorage, which is the common default: AsyncStorage is plain
 * unencrypted files in the app's sandbox, readable on a rooted or jailbroken
 * device and often swept up by device backups. A Supabase session is a refresh
 * token — long-lived, and enough to reissue access tokens — so it belongs
 * behind the OS keystore.
 *
 * WHY THE CHUNKING
 *
 * SecureStore's practical limit is 2048 bytes per entry, and a Supabase session
 * is larger than that: it carries an access JWT, a refresh token and the user
 * object. Running the app surfaced the warning —
 *
 *   "Value being stored in SecureStore is larger than 2048 bytes and it may
 *    not be stored successfully. In a future SDK version, this call may throw"
 *
 * — which means the session might silently fail to persist, and the user is
 * asked to sign in again on every cold start. That is precisely the failure
 * secure storage was added to prevent, and it would have looked like the
 * keychain simply not working.
 *
 * So values are split across numbered entries with a marker at the base key.
 * A value written before this change has no marker and is returned as-is, so
 * an existing session survives the upgrade instead of forcing a re-login.
 */
const CHUNK_PREFIX = "__chunk__:";
const CHUNK_SIZE = 1536; // headroom under 2048 for key overhead and encoding

/** SecureStore only accepts [A-Za-z0-9._-]; supabase-js keys contain more. */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

const nativeStorage = {
  async getItem(key: string): Promise<string | null> {
    const base = safeKey(key);
    const head = await SecureStore.getItemAsync(base);
    if (head === null) return null;

    // Written before chunking existed — still perfectly valid.
    if (!head.startsWith(CHUNK_PREFIX)) return head;

    const count = Number(head.slice(CHUNK_PREFIX.length));
    if (!Number.isInteger(count) || count < 1) return null;

    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${base}.${i}`);
      // A missing chunk means a torn write; a partial session is worse than
      // none, because supabase-js would try to use it and fail confusingly.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join("");
  },

  async setItem(key: string, value: string): Promise<void> {
    const base = safeKey(key);
    await clearChunks(base);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(base, value);
      return;
    }

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    // Chunks first, marker last: if this is interrupted, the base key still
    // holds the old value rather than a marker pointing at nothing.
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(`${base}.${i}`, chunks[i]);
    }
    await SecureStore.setItemAsync(base, `${CHUNK_PREFIX}${chunks.length}`);
  },

  async removeItem(key: string): Promise<void> {
    const base = safeKey(key);
    await clearChunks(base);
    await SecureStore.deleteItemAsync(base);
  },
};

/**
 * The browser build (used only to preview the app on a computer) has no
 * keychain, so it falls back to localStorage. Phones always use the keystore.
 */
const webStorage = {
  getItem: async (k: string) => { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } },
  setItem: async (k: string, v: string) => { try { globalThis.localStorage?.setItem(k, v); } catch { /* unavailable */ } },
  removeItem: async (k: string) => { try { globalThis.localStorage?.removeItem(k); } catch { /* unavailable */ } },
};
export const secureStorage = Platform.OS === "web" ? webStorage : nativeStorage;

/** Remove any chunks a previous write left behind. */
async function clearChunks(base: string): Promise<void> {
  const head = await SecureStore.getItemAsync(base);
  if (!head?.startsWith(CHUNK_PREFIX)) return;
  const count = Number(head.slice(CHUNK_PREFIX.length));
  if (!Number.isInteger(count)) return;
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(`${base}.${i}`);
  }
}

/**
 * One client for the whole app.
 *
 * Created eagerly and never re-created: supabase-js keeps the session and the
 * refresh timer on the instance, so a second client would race the first over
 * token refresh and could invalidate a perfectly good session.
 */
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      storage: secureStorage,
      persistSession: true,
      autoRefreshToken: true,
      // No URL to parse on native; leaving this on makes supabase-js look for
      // browser globals that do not exist.
      detectSessionInUrl: false,
    },
  },
);

/**
 * The signed-in client.
 *
 * Kept as a function with this name so the eleven screens calling it did not
 * have to change. It no longer signs anybody in — the session is established by
 * the sign-in screen and restored from the keychain on launch — but it does
 * assert that one exists, so a screen cannot quietly render an empty state
 * that is really an auth failure.
 */
export async function getClient(): Promise<SupabaseClient> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Not signed in.");
  return supabase;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new Error(friendlyAuthError(error.message));
}

export async function signUp(
  email: string, password: string, fullName: string, referralCode = "",
  extra: { businessName?: string; phone?: string } = {},
): Promise<{ hasSession: boolean }> {
  // An optional referral code must be real before the account is made. The
  // database applies it again when the business is created.
  const code = referralCode.trim();
  if (code !== "") {
    const { data: ok } = await supabase.rpc("validate_referral_code", { p_code: code });
    if (ok !== true) throw new Error("We couldn’t find that referral code. Fix it or clear the field to continue.");
  }
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    // handle_new_user reads this to create the profile and the organisation, so
    // the same trigger provisions a mobile sign-up as a web one.
    // business_name is what handle_new_user names the business from (as on the web). phone is kept with
    // the account's metadata; it is also copied to the profile below when a session exists.
    options: { data: {
      full_name: fullName.trim(),
      ...(extra.businessName?.trim() ? { business_name: extra.businessName.trim() } : {}),
      ...(extra.phone?.trim() ? { phone: extra.phone.trim() } : {}),
      ...(code !== "" ? { referral_code: code } : {}),
    } },
  });
  if (error) throw new Error(friendlyAuthError(error.message));
  const uid = data.session?.user?.id;
  if (uid && extra.phone?.trim()) {
    // Best effort: the person's own profile row (their own-row policy). A failure never blocks sign-up.
    try { await supabase.from("profiles").update({ phone: extra.phone.trim() }).eq("id", uid); } catch { /* optional */ }
  }
  return { hasSession: !!data.session };
}

/**
 * Send a password-reset email.
 *
 * The link lands on the WEB app, not back in here. Deep-linking a recovery
 * token into the app would need the scheme registered on both platforms and a
 * handler for the token exchange — real work, and pointless when the web page
 * already does this correctly and every phone has a browser. The person taps
 * the link, sets a new password, comes back and signs in.
 *
 * Always resolves. Telling someone "no account with that email" turns this into
 * a way to discover who banks with RevoPass, one address at a time — the same
 * reasoning as the web form, which must not disagree with this one.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const appUrl = process.env.EXPO_PUBLIC_APP_URL ?? "https://revopass.revospace.ng";
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${appUrl}/reset-password`,
  });

  // Rate limiting is the one failure worth surfacing: it is actionable, and
  // saying so reveals nothing about whether the account exists.
  if (error && /rate limit|too many/i.test(error.message)) {
    throw new Error("Too many attempts. Wait a minute and try again.");
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Is this failure "you are not signed in" rather than "the query went wrong"?
 *
 * The distinction decides which screen the user ends up on. An expired or
 * revoked refresh token surfaced as a data error rendered "Could not load: Not
 * signed in." on every tab, with no sign-in prompt and no way back — the app
 * looked broken when it merely needed re-authentication.
 *
 * Matches on the sentinel thrown by getClient() and on the shapes PostgREST and
 * GoTrue use for an unusable JWT.
 */
export function isAuthFailure(e: unknown): boolean {
  if (!e) return false;
  const err = e as { message?: string; code?: string; status?: number; __isAuthError?: boolean };
  if (err.__isAuthError) return true;
  // PGRST301 is PostgREST's "JWT expired"; 401 covers a rejected token.
  if (err.code === "PGRST301" || err.status === 401) return true;
  const m = String(err.message ?? e).toLowerCase();
  return m.includes("not signed in")
      || m.includes("jwt expired")
      || m.includes("invalid claim")
      || m.includes("refresh token");
}

/**
 * Supabase's auth errors are written for developers. These are the ones a real
 * person hits, in words that tell them what to do about it.
 */
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "That email and password do not match.";
  if (m.includes("email not confirmed")) return "Check your email and confirm your address first.";
  if (m.includes("already registered")) return "That email already has an account. Sign in instead.";
  if (m.includes("password should be at least")) return "Use a password of at least 6 characters.";
  if (m.includes("unable to validate email")) return "That does not look like a valid email address.";
  if (m.includes("network")) return "No connection. Check your internet and try again.";
  return message;
}

/**
 * Money formatting comes from @revopass/core, not a copy.
 *
 * It used to be duplicated here, with a comment explaining that importing core
 * would need Metro transpile config "not worth setting up for a preview". That
 * was true of a preview and is not true of a shipping product: the two copies
 * agreeing was luck, nothing tested it, and the failure mode is the same
 * invoice showing a different amount on the phone than on the web — which is
 * exactly the discrepancy that destroys trust in an accounting product.
 *
 * No Metro config was needed in the end. metro.config.js already watches the
 * workspace root and resolves the hoisted node_modules, and Metro's babel
 * transform handles core's raw TypeScript, so the import just works.
 *
 * formatCompact keeps its old name because eleven screens call it; it is now a
 * thin alias for core's formatNairaCompact rather than a second implementation.
 */
export { formatNaira, formatNairaCompact as formatCompact } from "@revopass/core";
