import { Linking, Platform } from "react-native";
import { secureStorage } from "./supabase";

/**
 * Referral links. A link such as revopass://signup?ref=REV-A7K9Q2 (or https://…/signup?ref=…, as
 * the web's share links can carry) fills the referral field when the sign-up form opens, and the
 * code is remembered on the device until an account is created so it survives closing the app.
 * The code is NOT trusted here: signUp() validates it with the existing validate_referral_code
 * before anything is created, and the database applies it again when the business is made.
 */
const KEY = "rp_referral_code_v1";
const PARAMS = ["ref", "referral", "referral_code", "code"];

export function parseReferral(url: string | null | undefined): string | null {
  if (!url) return null;
  const q = url.split("?")[1]?.split("#")[0];
  if (!q) return null;
  for (const part of q.split("&")) {
    const [k, v] = part.split("=");
    if (PARAMS.includes(decodeURIComponent(k ?? "")) && v) {
      const code = decodeURIComponent(v).trim().toUpperCase();
      if (/^[A-Z0-9-]{4,20}$/.test(code)) return code;
    }
  }
  return null;
}

export async function rememberReferral(code: string): Promise<void> { try { await secureStorage.setItem(KEY, code); } catch { /* optional */ } }
export async function forgetReferral(): Promise<void> { try { await secureStorage.removeItem(KEY); } catch { /* optional */ } }
export async function savedReferral(): Promise<string | null> { try { return (await secureStorage.getItem(KEY)) ?? null; } catch { return null; } }

/** The referral code the app was opened with (deep link, or ?ref= on web), else the one remembered earlier. */
export async function initialReferral(): Promise<string | null> {
  let code: string | null = null;
  try { code = parseReferral(await Linking.getInitialURL()); } catch { /* none */ }
  if (!code && Platform.OS === "web" && typeof window !== "undefined") code = parseReferral(window.location.href);
  if (code) { await rememberReferral(code); return code; }
  return savedReferral();
}

/** Calls back when a referral link opens the app while it is already running. */
export function onReferralLink(cb: (code: string) => void): () => void {
  const sub = Linking.addEventListener("url", ({ url }) => { const c = parseReferral(url); if (c) { void rememberReferral(c); cb(c); } });
  return () => sub.remove();
}
