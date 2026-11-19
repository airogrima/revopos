/**
 * The two-option "create an invoice" popover, shared by the tab-bar + button and
 * the Home "Create Invoice" quick action.
 *
 * A short tap keeps its normal action; only a long press opens this menu. React
 * Native's Pressable never fires onPress for a press that already fired
 * onLongPress, so the two cannot both run. The popover is a transparent Modal:
 * tapping outside or the system Back button (onRequestClose) dismisses it, and so
 * does choosing an option. It is anchored to the pressed element (measured in
 * window coordinates), opens above it when there is room and below it otherwise,
 * and is clamped inside the screen so it works on small phones.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "../theme";
import { Icon } from "./kit";

export interface Anchor { x: number; y: number; width: number; height: number }

const W = 268;            // popover width
const ROW = 52;           // row height
const PAD = 6;
const H = ROW * 2 + PAD * 2 + 1;

export function useCreateMenu(onSales: () => void, onPurchase: () => void) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const open = useCallback((a: Anchor) => setAnchor(a), []);
  const close = useCallback(() => setAnchor(null), []);
  const node = (
    <CreateMenu anchor={anchor} onClose={close}
      onSales={() => { close(); onSales(); }} onPurchase={() => { close(); onPurchase(); }} />
  );
  return { open, close, node };
}

/** Props for a Pressable: long press measures the element and opens the menu. */
export function useLongPressAnchor(open: (a: Anchor) => void) {
  const ref = useRef<View>(null);
  const onLongPress = useCallback((_e?: GestureResponderEvent) => {
    ref.current?.measureInWindow((x, y, width, height) => open({ x, y, width, height }));
  }, [open]);
  return { ref, onLongPress };
}

export default function CreateMenu({ anchor, onClose, onSales, onPurchase }: {
  anchor: Anchor | null; onClose: () => void; onSales: () => void; onPurchase: () => void;
}) {
  const { width: sw, height: sh } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const t = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (anchor) {
      setShown(true);
      t.setValue(0);
      Animated.timing(t, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else if (shown) {
      Animated.timing(t, { toValue: 0, duration: 110, useNativeDriver: true }).start(() => setShown(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  if (!shown && !anchor) return null;
  const a = anchor ?? { x: sw / 2, y: sh, width: 0, height: 0 };
  const margin = 12;
  const roomAbove = a.y - insets.top - margin;
  const above = roomAbove >= H + 10;
  const top = above ? a.y - H - 10 : Math.min(sh - insets.bottom - H - margin, a.y + a.height + 10);
  const left = Math.max(margin, Math.min(sw - W - margin, a.x + a.width / 2 - W / 2));
  const arrowLeft = Math.max(18, Math.min(W - 18, a.x + a.width / 2 - left)) - 7;

  const style = {
    opacity: t,
    transform: [
      { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [above ? 8 : -8, 0] }) },
      { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
    ],
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" accessibilityRole="button" />
      <Animated.View style={[s.card, { top, left, width: W }, style]} accessibilityViewIsModal>
        <Row icon="invoice" label="Create Sales Invoice" sub="Bill a customer" onPress={onSales} />
        <View style={s.sep} />
        <Row icon="cart" label="Create Purchase Invoice" sub="Record a supplier bill" onPress={onPurchase} />
        <View style={[s.arrow, above ? { bottom: -7 } : { top: -7 }, { left: arrowLeft }]} />
      </Animated.View>
    </Modal>
  );
}

function Row({ icon, label, sub, onPress }: { icon: string; label: string; sub: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: C.forest + "12" }]}>
      <View style={s.iconWrap}><Icon name={icon} size={18} color={C.forest} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.label} numberOfLines={2}>{label}</Text>
        <Text style={s.sub} numberOfLines={1}>{sub}</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    position: "absolute", backgroundColor: "#fff", borderRadius: 16, padding: PAD,
    borderWidth: 1, borderColor: C.border2,
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
  row: { height: ROW, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, borderRadius: 11 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.forest + "1A", alignItems: "center", justifyContent: "center" },
  label: { fontSize: 14, fontWeight: "700", color: C.text },
  sub: { fontSize: 11.5, color: C.text2, marginTop: 1 },
  sep: { height: 1, backgroundColor: C.border2, marginHorizontal: 8 },
  arrow: {
    position: "absolute", width: 14, height: 14, backgroundColor: "#fff", transform: [{ rotate: "45deg" }],
    borderRightWidth: Platform.OS === "web" ? 1 : 0, borderBottomWidth: Platform.OS === "web" ? 1 : 0, borderColor: C.border2,
  },
});
