/** One-shot message handed to the screen we navigate back to (shown there as a toast). */
let pending: string | null = null;
export const setFlash = (m: string) => { pending = m; };
export const takeFlash = (): string | null => { const m = pending; pending = null; return m; };
