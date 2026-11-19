/**
 * A purchase invoice has no public share page (it is the supplier's bill to the
 * business, not a document sent to a customer), so the server has no rendered
 * layout to reuse. This builds a plain, print-ready page from the same rows the
 * Purchases screen reads: business details, supplier, lines, VAT, totals, paid
 * and balance. Amounts are shown exactly as stored (kobo), never recalculated.
 */
import { formatNaira } from "@revopass/core";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export interface PurchaseDoc {
  number: string; reference: string | null; purchase_date: string; due_date: string | null; status: string;
  subtotal_kobo: number; vat_kobo: number; total_kobo: number; amount_paid_kobo: number; balance_kobo: number; notes: string | null;
  vendor: { name: string; email: string | null; phone: string | null; address: string | null; tin: string | null } | null;
  lines: { description: string; quantity: number; unit_cost_kobo: number; line_total_kobo: number }[];
  business: { name: string; logo_url: string | null; address: string | null; email: string | null; phone: string | null; tin: string | null; document_footer: string | null };
}

export function purchaseHtml(d: PurchaseDoc): string {
  const b = d.business, v = d.vendor;
  const paid = d.balance_kobo <= 0 ? "PAID" : d.amount_paid_kobo > 0 ? "PART PAID" : "UNPAID";
  const rows = d.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="n">${esc(l.quantity)}</td><td class="n">${esc(formatNaira(l.unit_cost_kobo))}</td><td class="n">${esc(formatNaira(l.line_total_kobo))}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}body{font-family:-apple-system,Roboto,Helvetica,Arial,sans-serif;color:#0f1f19;margin:0;padding:20px;font-size:14px}
.top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.logo{max-height:56px;max-width:160px}
h1{margin:0 0 4px;font-size:22px;color:#0B7A4B}.muted{color:#5b6b64;font-size:12.5px;line-height:1.5}
.badge{display:inline-block;padding:3px 10px;border-radius:99px;font-weight:700;font-size:12px;background:#e7f5ee;color:#0B7A4B}.badge.u{background:#fdecea;color:#b42318}
table{width:100%;border-collapse:collapse;margin-top:18px}th,td{padding:9px 6px;border-bottom:1px solid #e3e9e6;text-align:left}th{font-size:11.5px;color:#5b6b64;text-transform:uppercase}
.n{text-align:right;white-space:nowrap}.tot{margin-top:14px;margin-left:auto;width:min(280px,100%)}.tot div{display:flex;justify-content:space-between;padding:4px 0}.tot .g{font-weight:800;font-size:16px;border-top:2px solid #0f1f19;margin-top:4px;padding-top:8px}
.foot{margin-top:26px;font-size:12px;color:#5b6b64}
</style></head><body>
<div class="top"><div>${b.logo_url ? `<img class="logo" src="${esc(b.logo_url)}"/>` : ""}<h1>${esc(b.name)}</h1>
<div class="muted">${[b.address, b.email, b.phone, b.tin ? "TIN " + b.tin : ""].filter(Boolean).map(esc).join("<br/>")}</div></div>
<div style="text-align:right"><h1>PURCHASE INVOICE</h1><div><b>${esc(d.number)}</b></div>
<div class="muted">Date ${esc(d.purchase_date)}${d.due_date ? `<br/>Due ${esc(d.due_date)}` : ""}${d.reference ? `<br/>Supplier ref ${esc(d.reference)}` : ""}</div>
<div style="margin-top:6px"><span class="badge ${d.balance_kobo > 0 ? "u" : ""}">${paid}</span></div></div></div>
<div style="margin-top:16px"><div class="muted">SUPPLIER</div><b>${esc(v?.name ?? "Supplier")}</b>
<div class="muted">${[v?.address, v?.email, v?.phone, v?.tin ? "TIN " + v.tin : ""].filter(Boolean).map(esc).join("<br/>")}</div></div>
<table><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Unit cost</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot"><div><span>Subtotal</span><span>${esc(formatNaira(d.subtotal_kobo))}</span></div><div><span>VAT</span><span>${esc(formatNaira(d.vat_kobo))}</span></div>
<div class="g"><span>Total</span><span>${esc(formatNaira(d.total_kobo))}</span></div><div><span>Paid</span><span>${esc(formatNaira(d.amount_paid_kobo))}</span></div><div><b>Balance due</b><b>${esc(formatNaira(d.balance_kobo))}</b></div></div>
${d.notes ? `<div class="foot">${esc(d.notes)}</div>` : ""}${b.document_footer ? `<div class="foot">${esc(b.document_footer)}</div>` : ""}
</body></html>`;
}
