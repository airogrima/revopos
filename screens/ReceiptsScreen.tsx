/**
 * Receipts — a review list, not a camera.
 *
 * Chose to build this rather than leave a placeholder because there IS data:
 * receipt_scans holds real rows with extraction results, confidence scores and
 * review flags, and being able to see what is waiting for confirmation is
 * useful on a phone even when capture is not wired up.
 *
 * What it deliberately does NOT do is offer a capture button. Photographing a
 * receipt, uploading it and running extraction is not built in either app —
 * receipt_capture and receipt_ocr are both 'planned' in plan_features. A camera
 * button that goes nowhere would be worse than none, so the screen says plainly
 * that capture is coming and shows what already exists.
 *
 * Amounts come from the extraction JSON, which is the model's reading of the
 * receipt and may be wrong — that is the entire point of a review queue. They
 * are labelled as extracted rather than presented as settled figures.
 */

import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatNaira, getClient } from "../lib/supabase";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { useOrgData } from "../lib/org";
import { C } from "../theme";
import {
  ActionButton, Card, EmptyState, ErrorView, Loading, Screen, ScreenTitle, Tile, TileGrid, u,
} from "../components/ui";

interface Scan {
  id: string;
  status: string;
  review_flags: string[] | null;
  extraction: { merchant?: string; total_kobo?: number; date?: string } | null;
  captured_at: string | null;
  confirmed_at: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  confirmed: C.success,
  extracted: C.primary,
  needs_review: C.warning,
  failed: C.danger,
  processing: C.text2,
  pending: C.text3,
};

export default function ReceiptsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { loading, refreshing, error, data: raw, reload, onRefresh } =
    useOrgData<Scan[]>(async (supabase, orgId) => {

      const { data, error: err } = await supabase
        .from("receipt_scans")
        .select("id,status,review_flags,extraction,captured_at,confirmed_at")
        .eq("org_id", orgId)
        .order("captured_at", { ascending: false, nullsFirst: false });
      if (err) throw new Error(err.message);
      return (data ?? []) as Scan[];
    });
  const rows = raw ?? [];

  if (loading) return <Loading label="Loading receipts…" />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  const awaiting = rows.filter((r) => r.status === "needs_review" || r.status === "extracted").length;
  const confirmed = rows.filter((r) => r.status === "confirmed").length;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle title="Receipts" subtitle={`${rows.length} scanned`} />

      <ActionButton label="Capture a receipt" onPress={() => nav.navigate("CaptureReceipt")} />

      <TileGrid>
        <Tile label="Awaiting review" value={String(awaiting)}
              color={awaiting > 0 ? C.warning : undefined} />
        <Tile label="Confirmed" value={String(confirmed)} dark />
      </TileGrid>

      <View style={s.notice}>
        <Text style={s.noticeText}>
          Use Capture a receipt to photograph and save one. Reading the amounts
          automatically is not available yet, so saved receipts wait here to be confirmed.
        </Text>
      </View>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="No receipts yet"
            /*
             * Wrong in both directions before. Capture IS built — the button
             * to do it is on this very screen — so "once receipt capture is
             * built" was stale. And it promised the merchant, date and total
             * would be "read off them for you", which nothing does:
             * receipt_ocr is still 'planned', and create_receipt_scan stores
             * what the person typed.
             */
            body="Photograph a receipt and file it against a category, and it appears here with the image kept alongside what you entered. Reading those figures off the photo automatically is not switched on yet — you type them, and nothing is guessed for you."
          />
        ) : (
          rows.map((r, i) => {
            const total = r.extraction?.total_kobo;
            const flag = r.review_flags?.[0];
            return (
              <View key={r.id} style={[u.listRow, i === 0 ? { borderTopWidth: 0, marginTop: 0 } : null]}>
                <View style={{ flex: 1 }}>
                  <View style={s.titleRow}>
                    <Text style={u.rowTitle} numberOfLines={1}>
                      {r.extraction?.merchant ?? "Unread receipt"}
                    </Text>
                    <View style={[s.chip, { backgroundColor: (STATUS_COLOR[r.status] ?? C.text3) + "1A" }]}>
                      <Text style={[s.chipText, { color: STATUS_COLOR[r.status] ?? C.text3 }]}>
                        {r.status.replace("_", " ")}
                      </Text>
                    </View>
                  </View>
                  <Text style={[u.rowMeta, flag ? { color: C.warning } : null]} numberOfLines={1}>
                    {flag ?? (r.captured_at ? String(r.captured_at).slice(0, 10) : "Not yet processed")}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={u.rowAmount}>
                    {typeof total === "number" ? formatNaira(total) : "—"}
                  </Text>
                  <Text style={u.rowMeta}>extracted</Text>
                </View>
              </View>
            );
          })
        )}
      </Card>

      <Text style={u.footer}>© 2026 Revo Space Enterprise Ltd.</Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  notice: {
    backgroundColor: "#FEF0C7", borderRadius: 12, padding: 12, marginBottom: 14,
  },
  noticeText: { fontSize: 12, color: "#7A2E0E", lineHeight: 18 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: { borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 },
  chipText: { fontSize: 10, fontWeight: "600", textTransform: "capitalize" },
});
