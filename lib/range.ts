export type Range = "month" | "last" | "quarter" | "year";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "month", label: "This month" }, { value: "last", label: "Last month" },
  { value: "quarter", label: "Quarter" }, { value: "year", label: "This year" },
];

/** Period start and end as YYYY-MM-DD, in the phone's local calendar. */
export function rangeDates(r: Range): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear(); const m = now.getMonth();
  if (r === "month") return { from: iso(new Date(y, m, 1)), to: iso(now) };
  if (r === "last") return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  if (r === "quarter") return { from: iso(new Date(y, Math.floor(m / 3) * 3, 1)), to: iso(now) };
  return { from: iso(new Date(y, 0, 1)), to: iso(now) };
}
