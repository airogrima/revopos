import { secureStorage } from "./supabase";

/**
 * Has this phone seen the welcome slides?
 *
 * A device-level flag, deliberately not tied to an account: the slides come
 * BEFORE sign-in, so there is no user yet. It lives in the same key-value store
 * the session uses (Keychain / Keystore on a phone, localStorage on web), so no
 * new dependency is needed. Any storage failure counts as "seen", because a
 * broken store must never trap someone in the tour.
 */
const KEY = "rp_onboarding_seen_v1";

export async function hasSeenOnboarding(): Promise<boolean> {
  try { return (await secureStorage.getItem(KEY)) === "1"; } catch { return true; }
}

export async function markOnboardingSeen(): Promise<void> {
  try { await secureStorage.setItem(KEY, "1"); } catch { /* nothing to do */ }
}

/** Settings → "Show welcome tour": ask the app root to show the slides again. */
const listeners = new Set<() => void>();
export function onOnboardingRequested(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function requestOnboarding(): void {
  listeners.forEach((fn) => fn());
}
