/** Page geometry and the HTML variants for preview and print. Pure functions, no native modules, so they can be tested directly. */

/** A4 portrait in points (what expo-print takes) and in CSS pixels at 96 dpi (what the preview lays out at). */
export const A4_POINTS = { width: 595, height: 842 };
export const A4_PX = { width: 794, height: 1123 };
/** 10 mm page margin, and the slight overall scale (0.88) that lets a typical invoice sit on ONE page. Preview and print use the same two numbers. */
const MARGIN_MM = 10;
const MARGIN_PX = Math.round((MARGIN_MM / 25.4) * 96);
export const PAPER_ZOOM = 0.88;
/** Item table: figures and column headings never break across lines; only the description wraps (even a very long unbroken word). Same rules for preview and print. */
const TABLE_CSS = `.doc-lines{width:100%!important;table-layout:auto}
.doc-lines th,.doc-lines td{white-space:nowrap}
.doc-lines th:first-child,.doc-lines td:first-child{white-space:normal;overflow-wrap:anywhere;word-break:break-word}
.doc-lines tr{page-break-inside:avoid}
.doc-meta,.doc-billto,.doc-head{overflow-wrap:anywhere}`;

function intoHead(html: string, extra: string): string {
  const out = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${extra}`);
  return out === html ? extra + html : out;
}

/**
 * The page exactly as it is printed or saved as a PDF: the server's own layout and its own
 * @media print rules, on an A4 portrait sheet with the same 16 mm margins the web uses. Content
 * that fits stays on one page; longer documents break between rows (the template keeps rows whole
 * and repeats the column headings) instead of shrinking or cutting off.
 */
export function printableHtml(html: string): string {
  return intoHead(html, `<style>@page{size:A4 portrait;margin:${MARGIN_MM}mm}@media print{.doc{zoom:${PAPER_ZOOM}}${TABLE_CSS}}</style>`);
}

/**
 * The same page for the on-screen preview. It is laid out at A4 width (794 px) and the viewer
 * scales that whole sheet to the screen, so a phone shows the printed page, not a squeezed
 * mobile layout, and pinch-zoom only magnifies the view. The rules below are the screen-side
 * equivalent of the template's @media print rules (controls hidden, card chrome removed), so what
 * you see is what prints. Faint lines mark where an A4 page ends.
 */
export function previewHtml(html: string, own = false): string {
  // The server page carries its own viewport tag (device-width). Left in, it would win over ours.
  html = html.replace(/<meta\s+name=["']viewport["'][^>]*>/gi, "");
  if (own) {
    // A self-contained page (purchase invoice): same A4-width sheet, nothing to hide.
    return intoHead(html, `<meta name="viewport" content="width=${A4_PX.width}, minimum-scale=0.2, maximum-scale=5, user-scalable=yes"><style>html,body{margin:0;background:#fff}body{width:${A4_PX.width}px;box-sizing:border-box;padding:48px!important}</style>`);
  }
  const css = `
<meta name="viewport" content="width=${A4_PX.width}, minimum-scale=0.2, maximum-scale=5, user-scalable=yes">
<style>
html,body{margin:0!important;padding:0!important;background:#dfe5e9!important;-webkit-text-size-adjust:100%}
.no-print,.tabs,.create-panel,.print-bar,.sidebar,.footer,.share-bar,.nav-toggle,.nav-scrim,.pub-actions,.pub-pay,.pub-brand{display:none!important}
.pub-wrap,.doc-wrap,.print-root{padding:0!important;margin:0!important;max-width:none!important;width:auto!important;background:transparent!important}
.main{padding:0!important}
.doc{box-sizing:border-box!important;zoom:${PAPER_ZOOM};width:${A4_PX.width / PAPER_ZOOM}px!important;max-width:none!important;min-height:${A4_PX.height / PAPER_ZOOM}px;margin:0 auto!important;padding:${MARGIN_PX / PAPER_ZOOM}px!important;border-radius:0!important;box-shadow:0 0 0 1px rgba(0,0,0,.08)!important;
 background-color:#fff!important;
 background-image:repeating-linear-gradient(to bottom,transparent 0,transparent ${A4_PX.height / PAPER_ZOOM - 2}px,#c9d1d6 ${A4_PX.height / PAPER_ZOOM - 2}px,#c9d1d6 ${A4_PX.height / PAPER_ZOOM}px)!important}
${TABLE_CSS}
</style>`;
  return intoHead(html, css);
}

