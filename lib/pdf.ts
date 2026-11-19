import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { A4_POINTS, printableHtml } from "./paper";
export { A4_POINTS, A4_PX, previewHtml, printableHtml } from "./paper";

/**
 * PDF and printing on the phone.
 *
 * THE LAYOUT IS NOT REIMPLEMENTED HERE, and that is the whole design.
 *
 * The obvious approach — build invoice HTML in the mobile app from the document
 * row — means a second invoice layout in a second codebase. The two drift, and
 * the day they disagree a customer receives a document whose total does not
 * match the one in the app. So instead this fetches the SAME page the customer
 * gets, /d/<token>, and prints that. One layout, rendered by the server, on
 * every surface.
 *
 * A <base> tag is injected because Next serves its stylesheets as root-relative
 * paths (/_next/static/...), and the print renderer has no origin of its own to
 * resolve them against. Without it the PDF comes out as unstyled text.
 *
 * The share page's own controls — Pay now, Download, the RevoPass footer — are
 * already hidden by the @media print rules in globals.css, so they do not reach
 * the paper. That is deliberate reuse, not luck.
 *
 * CONSEQUENCES, stated because they are real limits and not bugs:
 *   - It needs the network and the deployed site. Offline, there is no PDF.
 *   - Drafts have no shareable page (get_public_document refuses them), so
 *     drafts cannot be exported. Callers must not offer it for a draft.
 */

export const APP_URL = process.env.EXPO_PUBLIC_APP_URL ?? "";

/** Anything that goes wrong is reported in words a user can act on. */
export class PdfError extends Error {}

export async function documentHtml(publicToken: string): Promise<string> {
  if (!APP_URL) {
    throw new PdfError("This build has no app URL configured, so it cannot build a PDF.");
  }

  const url = `${APP_URL.replace(/\/$/, "")}/d/${publicToken}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new PdfError("Could not reach RevoPass. Check your connection and try again.");
  }

  if (!res.ok) {
    throw new PdfError(
      res.status === 404
        ? "This document is no longer shared, so it cannot be exported."
        : `RevoPass returned ${res.status} while building the document.`,
    );
  }

  const html = await res.text();

  /*
   * Injected immediately after <head> so it precedes every stylesheet link —
   * a <base> that appears after a <link> does not apply to it.
   */
  const withBase = html.replace(
    /<head(\s[^>]*)?>/i,
    (m) => `${m}<base href="${APP_URL.replace(/\/$/, "")}/">`,
  );

  // If <head> was missing the replace is a no-op and the PDF would be unstyled.
  // Better to say so than to hand someone a broken invoice.
  if (withBase === html) {
    throw new PdfError("The document could not be prepared for printing.");
  }

  return withBase;
}

/** Build the PDF and hand it to the share sheet — WhatsApp, email, Files. */
export async function shareDocumentPdf(publicToken: string): Promise<void> {
  await shareHtmlPdf(await documentHtml(publicToken));
}

/** PDF from already-built HTML (A4), then the share sheet. Also how "Save PDF" works on a phone. */
export async function shareHtmlPdf(html: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: printableHtml(html), ...A4_POINTS });

  if (!(await Sharing.isAvailableAsync())) {
    throw new PdfError("Sharing is not available on this device.");
  }

  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle: "Send invoice",
  });
}

/** Send it straight to a printer — AirPrint on iOS, the print service on Android. */
export async function printDocument(publicToken: string): Promise<void> {
  await Print.printAsync({ html: printableHtml(await documentHtml(publicToken)), ...A4_POINTS });
}

/** Print HTML that is already built (used for documents with no public page, e.g. purchase invoices). */
export async function printHtml(html: string): Promise<void> {
  await Print.printAsync({ html: printableHtml(html), ...A4_POINTS });
}
