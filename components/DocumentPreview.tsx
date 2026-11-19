/**
 * In-app preview of an invoice, receipt or purchase invoice, with Close (X) and Print.
 *
 * Sales invoices and receipts show the SAME server-rendered page the customer
 * receives (documentHtml, see lib/pdf.ts): one layout, logo, business and customer
 * details, lines, tax, discounts, totals and payment status all come from the
 * server. Purchase invoices have no public page, so their print-ready HTML is
 * built by lib/purchaseHtml.ts. It is a modal over the current screen: Close just
 * dismisses it, so nothing underneath (including unsaved work) is touched.
 *
 * Print opens the operating system print dialog (AirPrint / Android print
 * service, which covers wireless and network printers). A draft is never
 * printable: drafts have no issued document and must not look like a paid receipt.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { APP_URL, documentHtml, previewHtml, printHtml, shareHtmlPdf } from "../lib/pdf";
import { C } from "../theme";
import { Icon } from "./kit";

export type PreviewSource =
  | { kind: "public"; token: string }
  | { kind: "html"; html: string };

export default function DocumentPreview({ visible, title, status, source, onClose }: {
  visible: boolean; title: string; status?: string; source: PreviewSource | null; onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const isDraft = status === "draft";

  const load = useCallback(async () => {
    if (!source) return;
    setBusy(true); setError(null); setHtml(null);
    try {
      if (isDraft) throw new Error("This is a draft. Issue it first, then it can be previewed and printed.");
      setHtml(source.kind === "html" ? source.html : await documentHtml(source.token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The document could not be loaded.");
    } finally { setBusy(false); }
  }, [source, isDraft]);

  useEffect(() => { if (visible) void load(); else { setHtml(null); setError(null); } }, [visible, load]);

  const print = async () => {
    if (!html || isDraft || printing) return;
    setPrinting(true);
    try { await printHtml(html); } catch (e) { setError(e instanceof Error ? e.message : "Could not open the print dialog."); }
    finally { setPrinting(false); }
  };

  const share = async () => {
    if (!html || isDraft || sharing) return;
    setSharing(true);
    try { await shareHtmlPdf(html); } catch (e) { setError(e instanceof Error ? e.message : "Could not create the PDF."); }
    finally { setSharing(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}
      supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}>
      <SafeAreaView style={s.root} edges={["top", "left", "right", "bottom"]}>
        <View style={s.bar}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close preview" style={s.iconBtn}>
            <Icon name="close" size={20} color={C.text} />
          </Pressable>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          <Pressable onPress={() => void share()} disabled={!html || isDraft || sharing} accessibilityRole="button" accessibilityLabel="Share or save PDF"
            style={[s.shareBtn, (!html || isDraft || sharing) && { opacity: 0.4 }]}>
            <Text style={s.shareText}>{sharing ? "…" : "PDF"}</Text>
          </Pressable>
          <Pressable onPress={() => void print()} disabled={!html || isDraft || printing} accessibilityRole="button" accessibilityLabel="Print"
            style={[s.printBtn, (!html || isDraft || printing) && { opacity: 0.4 }]}>
            <Icon name="print" size={16} color="#fff" />
            <Text style={s.printText}>{printing ? "Opening…" : "Print"}</Text>
          </Pressable>
        </View>
        <View style={s.body}>
          {busy ? (
            <View style={s.center}><ActivityIndicator color={C.forest} /><Text style={s.note}>Loading document…</Text></View>
          ) : error ? (
            <View style={s.center}>
              <Text style={s.errTitle}>{isDraft ? "Draft document" : "Could not load the document"}</Text>
              <Text style={s.note}>{error}</Text>
              {!isDraft ? <Pressable onPress={() => void load()} style={s.retry} accessibilityRole="button"><Text style={s.retryText}>Try again</Text></Pressable> : null}
            </View>
          ) : html ? (
            Platform.OS === "web"
              ? <iframe title={title} srcDoc={previewHtml(html, source?.kind === "html")} style={{ border: 0, width: "100%", height: "100%" }} />
              : <WebView originWhitelist={["*"]} source={{ html: previewHtml(html, source?.kind === "html"), baseUrl: APP_URL ? APP_URL.replace(/\/$/, "") + "/" : undefined }}
                  style={{ flex: 1, backgroundColor: "#dfe5e9" }} scalesPageToFit startInLoadingState
                  setBuiltInZoomControls={false} setDisplayZoomControls={false} bounces={false}
                  onError={() => setError("The document could not be displayed.")} setSupportMultipleWindows={false} />
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  bar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border2, backgroundColor: "#fff" },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.border2, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 15, fontWeight: "700", color: C.text },
  printBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.forest, borderRadius: 19, paddingHorizontal: 14, height: 38 },
  shareBtn: { height: 38, borderRadius: 19, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", backgroundColor: C.forestSoft },
  shareText: { color: C.forest, fontWeight: "700", fontSize: 13.5 },
  printText: { color: "#fff", fontWeight: "700", fontSize: 13.5 },
  body: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  note: { color: C.text2, fontSize: 13.5, textAlign: "center", lineHeight: 19 },
  errTitle: { fontSize: 16, fontWeight: "700", color: C.text },
  retry: { marginTop: 6, backgroundColor: C.forest, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: "#fff", fontWeight: "700" },
});
