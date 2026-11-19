/**
 * Subscription checkout from the phone.
 *
 * The phone never holds a payment secret and never decides what was paid. It
 * asks the RevoPass server (the same code the web uses, lib/checkout.ts) to
 * create the payment, opens the hosted Squad page the server returns, and then
 * asks the server to verify the payment with Squad. A plan is activated only
 * when that verification (or Squad's signed webhook) succeeds.
 */
import { Linking } from "react-native";
import { supabase } from "./supabase";
import { explainHttpFailure } from "./billingErrors";

const BASE = (process.env.EXPO_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

/** The person's session is genuinely gone (no session, or the refresh token was refused). Only then is signing in again offered. */
export class ReauthRequired extends Error {
  readonly reauth = true;
  constructor(message = "Your session has ended. Sign in again to continue; your plan and module choices are saved.") { super(message); }
}
export const isReauth = (e: unknown): boolean => !!e && typeof e === "object" && (e as { reauth?: boolean }).reauth === true;

/**
 * A valid access token for the payment server.
 *
 * getSession() already refreshes a token that is expired or about to be, but it can hand back a stale one
 * when the refresh could not run (the app was suspended mid-refresh), so a token with under a minute left is
 * refreshed explicitly, and `force` refreshes regardless (used to retry after the server rejected one).
 * Only when the refresh itself fails is the session treated as gone.
 */
async function accessToken(force = false): Promise<string> {
  const { data } = await supabase.auth.getSession();
  let session = data.session;
  const expiring = !!session && session.expires_at != null && session.expires_at * 1000 < Date.now() + 60_000;
  if (!session || expiring || force) {
    const r = await supabase.auth.refreshSession();
    if (r.error || !r.data.session) {
      if (session && !expiring && !force) return session.access_token;
      throw new ReauthRequired();
    }
    session = r.data.session;
  }
  return session.access_token;
}

/** Same company domain (revospace.ng) over https: the only redirect target a bearer token may follow to. */
function sameCompany(from: string, to: string): boolean {
  try {
    const a = new URL(from), b = new URL(to);
    const root = (h: string) => h.split(".").slice(-2).join(".");
    return b.protocol === "https:" && root(a.hostname) === root(b.hostname);
  } catch { return false; }
}

let base = BASE;   // the origin that actually answers (see the redirect note below)

async function send(origin: string, path: string, token: string, body: unknown): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!BASE) throw new Error("Payments are not configured in this build (EXPO_PUBLIC_APP_URL is empty).");
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(attempt === 1);
    try {
      res = await send(base, path, token, body);
      /*
       * A redirect to another host (apex to www, say) makes the HTTP client drop the Authorization header,
       * and the server then rightly sees an unauthenticated request. Detect that, and when the new host is
       * the same company domain, send the request again straight to it (and remember it).
       */
      if (res.redirected && res.url) {
        const target = new URL(res.url).origin;
        if (target !== base && sameCompany(base, target) && res.status === 401) { base = target; res = await send(base, path, token, body); }
      }
    } catch (e) {
      if (isReauth(e)) throw e;
      throw new Error("Could not reach RevoPass. Check your connection and try again.");
    }
    // The server rejected the token: refresh once and retry before bothering the person.
    if (res.status === 401 && attempt === 0) continue;
    break;
  }
  const r = res as Response;
  const type = r.headers.get("content-type") ?? "";
  const parsed = type.includes("json") ? ((await r.json().catch(() => null)) as (T & { code?: string }) | null) : null;
  if (parsed === null) {
    let host = base;
    try { host = new URL(base).host; } catch { /* keep the raw value */ }
    throw new Error(explainHttpFailure(r.status, type, host));
  }
  if (r.status === 401) {
    // Refreshed and still refused. The server says why (code), so the message is not a guess.
    const code = parsed.code;
    if (code === "no_token") throw new Error("The payment server did not receive your sign-in. If the app address redirects to another domain, update EXPO_PUBLIC_APP_URL to the final address.");
    if (code === "not_configured") throw new Error("The payment server is not configured to check sign-ins (its Supabase settings are missing). Contact support.");
    throw new ReauthRequired("The payment server could not verify your session. Sign in again to continue; your plan and module choices are saved.");
  }
  return parsed;
}

export interface CheckoutStart { ok: boolean; redirectUrl?: string; reference?: string; message?: string; notConfigured?: boolean }
export interface SettleOutcome { settled: boolean; reason: string; plan?: string; period?: string }

/** Create the payment on the server and open the hosted checkout page. */
export async function startCheckout(
  orgId: string, plan: "starter" | "pro", period: "monthly" | "yearly", modules?: string[],
): Promise<CheckoutStart> {
  const r = await post<CheckoutStart>("/api/mobile/checkout", { org_id: orgId, plan, period, modules });
  if (r.ok && r.redirectUrl) await Linking.openURL(r.redirectUrl);
  return r;
}

/** Ask the server to verify a payment with Squad; safe to call repeatedly. */
export function settle(reference: string): Promise<SettleOutcome> {
  return post<SettleOutcome>("/api/mobile/settle", { reference });
}

/** Plain-language outcome for a settle result. */
export function settleMessage(o: SettleOutcome): string {
  if (o.settled) return "Payment confirmed. Your plan is active.";
  if (o.reason.startsWith("provider_pending") || o.reason === "provider_pending")
    return "Your payment is still pending. It will activate once the bank confirms it.";
  if (o.reason === "already_settled") return "This payment was already confirmed. Your plan is active.";
  if (o.reason.includes("cancel")) return "The payment was cancelled. Nothing was activated and you have not been charged for a plan.";
  if (o.reason.includes("expired")) return "The payment link expired. Nothing was activated. Start a new payment.";
  if (o.reason === "unknown_reference") return "We could not find that payment. Start a new payment.";
  if (o.reason === "wrong_currency" || o.reason === "amount_mismatch" || o.reason === "bad_amount") return "The payment did not match the amount due, so nothing was activated. Contact support if you were charged.";
  if (o.reason.startsWith("provider_")) return "Payment was not completed. You have not been charged for a plan.";
  if (o.reason === "not_configured") return "Payment verification is not set up on the server yet.";
  return "We could not confirm the payment yet. If you paid, try again in a minute.";
}
