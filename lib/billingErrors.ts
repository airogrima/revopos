/**
 * Why a response that is not our JSON answer happened, in words a person can
 * act on. The old code swallowed these and the screen only said "Could not
 * start payment.", which hid a wrong server address as if it were a payment
 * problem. Exported so it can be tested.
 */
export function explainHttpFailure(status: number, contentType: string, host: string): string {
  const html = /html/i.test(contentType);
  if (status === 404) return `The payment server (${host}) has no mobile checkout. The app is pointing at a deployment that does not include it, or EXPO_PUBLIC_APP_URL is wrong.`;
  if ((status === 401 || status === 403) && html) return `The payment server (${host}) blocked the request before it reached RevoPass (for example Vercel deployment protection). Use the live address, or turn protection off for this deployment.`;
  if (status >= 500) return `The payment server (${host}) had an error (${status}). Try again; if it keeps happening, the server logs will show why.`;
  return `The payment server (${host}) answered with an unexpected response (${status}).`;
}

