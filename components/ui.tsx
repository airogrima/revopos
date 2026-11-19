/**
 * Shared screen furniture.
 *
 * Every screen loads from Supabase, so every screen needs the same three
 * non-happy states: loading, failed, and legitimately empty. Before this file
 * they existed only inside App.tsx, which meant a second screen would either
 * reinvent them or — far more likely — skip them and render a blank panel that
 * reads as a broken app.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo, ActivityIndicator, Animated, Easing, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Rect } from "react-native-svg";
import { C, SP, CARD_SHADOW } from "../theme";

export function Logo({ size = 34 }: { size?: number }) {
  const inset = size * 0.14;
  const inner = size - inset * 2;
  const barH = inner * 0.11;
  const gap = (inner - barH * 3) / 4;
  const bars = [
    { w: inner * 0.62, fill: "#0F4D3D" },
    { w: inner * 0.48, fill: "#2C6A52" },
    { w: inner * 0.30, fill: "#4F9E6B" },
  ];
  return (
    <Svg width={size} height={size}>
      <Rect width={size} height={size} rx={size * 0.22} fill="#16241D" />
      <Rect x={inset} y={inset} width={inner} height={inner} rx={size * 0.18} fill="#fff" />
      {bars.map((b, i) => (
        <Rect key={i} x={inset + inner * 0.16} y={inset + gap * (i + 1) + barH * i}
              width={b.w} height={barH} rx={barH / 2} fill={b.fill} />
      ))}
    </Svg>
  );
}

/**
 * Scrolling screen body.
 *
 * The top inset is taken from the device rather than the old hardcoded
 * paddingTop: 64, which was tuned for one notch height and would either crowd
 * the status bar or waste a band of space on anything else. The bottom pad
 * clears the tab bar AND the home indicator — a list whose last row sits under
 * the tab bar is the classic way this looks broken on a real iPhone.
 */
export function Screen({
  children, refreshing, onRefresh, topPad = true, scrollRef, bottomPad = 32,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** False when a header above already took the safe-area top inset. */
  topPad?: boolean;
  /** Lets a screen scroll itself (View Cart, jump-to-section). */
  scrollRef?: React.RefObject<ScrollView | null>;
  bottomPad?: number;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          padding: SP.screenPad,
          paddingTop: topPad ? insets.top + 12 : 4,
          paddingBottom: bottomPad,
        }}
        refreshControl={
          onRefresh
            ? (
              <RefreshControl
                refreshing={!!refreshing}
                onRefresh={onRefresh}
                /*
                 * tintColor is iOS-only and `colors` is Android-only — setting
                 * just one leaves the other platform on its default spinner.
                 * Android was showing the stock blue-grey against a green app.
                 */
                tintColor={C.primary}
                colors={[C.primary]}
                progressBackgroundColor="#FFFFFF"
                title=""
              />
            )
            : undefined
        }
      >
        {children}
      </ScrollView>

      {/* Sits outside the ScrollView so it stays put while the list moves. */}
      <RefreshedToast refreshing={refreshing} enabled={!!onRefresh} />
    </View>
  );
}

/**
 * A green "Updated" pill, shown briefly when a pull-to-refresh finishes.
 *
 * Pull-to-refresh has a confirmation problem: the spinner disappears whether
 * the data changed, stayed the same, or never arrived. On a slow connection
 * people pull again and again because nothing told them it worked. This says
 * so, then gets out of the way.
 *
 * Driven by the refreshing flag going true -> false, so it fires on a real
 * completed refresh and never on first load.
 */
function RefreshedToast({ refreshing, enabled }: { refreshing?: boolean; enabled: boolean }) {
  const opacity = useRef(new Animated.Value(0)).current;
  /*
   * Scale rather than translate. The pill used to sit at the top edge and slide
   * down from it, which reads as coming from somewhere. Centred, there is no
   * edge to come from, so it settles into place instead — starting slightly
   * small and springing to full size.
   */
  const scale = useRef(new Animated.Value(0.85)).current;
  const wasRefreshing = useRef(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    // Honouring this is not decoration: motion-sensitive users get headaches
    // and nausea from things that slide in unbidden.
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const finished = wasRefreshing.current && !refreshing;
    wasRefreshing.current = !!refreshing;
    if (!finished) return;

    // useNativeDriver keeps this on the UI thread, so it stays smooth even
    // while the screen is re-rendering with the data that just arrived.
    const appear = reduceMotion
      ? Animated.timing(opacity, { toValue: 1, duration: 1, useNativeDriver: true })
      : Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true,
          }),
          Animated.spring(scale, {
            toValue: 1, friction: 6, tension: 110, useNativeDriver: true,
          }),
        ]);

    const sequence = Animated.sequence([
      appear,
      Animated.delay(1100),
      Animated.timing(opacity, {
        toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true,
      }),
    ]);

    sequence.start(({ finished: done }) => {
      // Reset only when the animation ran to completion; interrupting it
      // mid-flight and snapping the pill back looks like a glitch.
      if (done) scale.setValue(0.85);
    });

    return () => sequence.stop();
  }, [refreshing, enabled, reduceMotion, opacity, scale]);

  if (!enabled) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[t.wrap, { opacity }]}
    >
      <Animated.View style={[t.pill, { transform: [{ scale }] }]}>
        <View style={t.dot} />
        <Text style={t.text}>Updated</Text>
      </Animated.View>
    </Animated.View>
  );
}

const t = StyleSheet.create({
  /*
   * Fills the screen and centres its child, so the pill lands in the middle
   * rather than at the top edge. pointerEvents="none" on the Animated.View
   * means this overlay never intercepts a tap, which matters because it covers
   * everything while it is visible.
   */
  wrap: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.primary, borderRadius: 999,
    paddingHorizontal: 26, paddingVertical: 15,
    // A pill floating over content needs separation from it. Heavier now that
    // it sits over the middle of the page rather than against the top edge.
    ...Platform.select({
      ios: {
        shadowColor: "#0B171B", shadowOpacity: 0.32,
        shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 8 },
    }),
  },
  dot: { width: 11, height: 11, borderRadius: 6, backgroundColor: C.accent },
  text: { color: "#fff", fontSize: 18, fontWeight: "600", letterSpacing: 0.2 },
});

/**
 * A full-width call to action, for the one thing a screen is for.
 *
 * Every list screen that gained a write path needs the same button, and the
 * alternative — a header "+" — is a small target and easy to miss on a phone
 * held one-handed.
 */
export function ActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [u.actionButton, pressed && { opacity: 0.75 }]}
    >
      <Text style={u.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

export function ScreenTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={u.title}>{title}</Text>
      {subtitle ? <Text style={u.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Card({
  title, subtitle, children,
}: { title?: string; subtitle?: string; children: ReactNode }) {
  return (
    <View style={u.card}>
      {title ? <Text style={u.cardTitle}>{title}</Text> : null}
      {subtitle ? <Text style={u.cardSub}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

export function Tile({ label, value, color, dark }: {
  label: string; value: string; color?: string; dark?: boolean;
}) {
  return (
    <View style={[u.tile, dark ? { backgroundColor: C.inkCard, borderColor: C.borderDark } : null]}>
      <Text style={[u.tileLabel, dark ? { color: C.textOnDarkMuted } : null]}>{label}</Text>
      <Text style={[u.tileValue, color ? { color } : null, dark ? { color: "#fff" } : null]}>{value}</Text>
    </View>
  );
}

export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={u.tileGrid}>{children}</View>;
}

export function Row({
  title, meta, amount, amountColor, onPress,
}: {
  title: string; meta?: string; amount?: string; amountColor?: string; onPress?: () => void;
}) {
  return (
    <View style={u.listRow}>
      <View style={{ flex: 1 }}>
        <Text style={u.rowTitle} numberOfLines={1}>{title}</Text>
        {meta ? <Text style={u.rowMeta}>{meta}</Text> : null}
      </View>
      {amount ? (
        <Text style={[u.rowAmount, amountColor ? { color: amountColor } : null]}>{amount}</Text>
      ) : null}
    </View>
  );
}

/**
 * Deliberate empty state — the same reasoning as the web app's EmptyState.
 * Several of these lists are legitimately empty, and a blank panel reads as a
 * broken screen. This says what is missing and what to do about it.
 */
export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={u.empty}>
      <Text style={u.emptyTitle}>{title}</Text>
      <Text style={u.emptyBody}>{body}</Text>
    </View>
  );
}

/**
 * The loading state, with the logo breathing gently.
 *
 * A bare spinner on a slow connection reads as a stall. A slow, continuous
 * pulse reads as work in progress — and because it is driven natively it keeps
 * moving even while the JS thread is busy parsing the response, which is
 * exactly when a JS-driven animation would freeze and look like a crash.
 */
export function Loading({ label = "Loading…" }: { label?: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <View style={u.center}>
      <Animated.View
        style={{
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }),
        }}
      >
        <Logo size={54} />
      </Animated.View>
      <ActivityIndicator color={C.primary} style={{ marginTop: 20 }} />
      <Text style={u.loadingText}>{label}</Text>
    </View>
  );
}

/**
 * A failed load with a way out of it.
 *
 * This used to be a message and nothing else, which made every dropped request
 * a dead end — the only recovery was force-quitting the app. On Nigerian mobile
 * data a request failing is routine, not exceptional, so recovery has to be one
 * tap away.
 *
 * `onRetry` is optional only so the component can still be used where no
 * refetch exists; every caller in the app passes it.
 */
export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={u.center}>
      <Text style={u.errorTitle}>Could not load</Text>
      <Text style={u.errorBody}>{message}</Text>
      {onRetry && (
        <Pressable
          onPress={onRetry}
          // 44pt is the minimum comfortable tap target; hitSlop covers the rest.
          hitSlop={8}
          style={({ pressed }) => [u.retryButton, pressed && { opacity: 0.7 }]}
        >
          <Text style={u.retryText}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

export const u = StyleSheet.create({
  actionButton: {
    backgroundColor: C.forest, borderRadius: 14, minHeight: 52,
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  actionButtonText: { color: "#fff", fontSize: 15.5, fontWeight: "700" },
  retryButton: {
    marginTop: 16, minHeight: 46, justifyContent: "center",
    paddingHorizontal: 24, borderRadius: 14, backgroundColor: C.forest,
  },
  retryText: { color: "#fff", fontSize: 15, fontWeight: "700", textAlign: "center" },
  center: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", padding: 32 },
  loadingText: { marginTop: 12, color: C.text2, fontSize: 13 },
  errorTitle: { fontSize: 17, fontWeight: "600", color: C.danger, marginBottom: 8 },
  errorBody: { fontSize: 13, color: C.text2, textAlign: "center", lineHeight: 20 },

  title: { fontSize: 24, fontWeight: "700", color: C.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: C.text2, marginTop: 3 },

  card: { backgroundColor: C.card, borderRadius: SP.cardRadius, padding: SP.cardPad, marginBottom: SP.gap, ...CARD_SHADOW },
  cardTitle: { fontSize: 16, fontWeight: "700", color: C.text },
  cardSub: { fontSize: 11.5, color: C.text2, marginTop: 3 },

  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: SP.gap },
  tile: { backgroundColor: C.card, borderRadius: SP.cardRadius, padding: 14, width: "48%", flexGrow: 1, ...CARD_SHADOW },
  tileLabel: { fontSize: 11, color: C.text2 },
  tileValue: { fontSize: 19, fontWeight: "700", color: C.text, marginTop: 4, letterSpacing: -0.3 },

  listRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border2, marginTop: 8,
  },
  rowTitle: { fontSize: 14, fontWeight: "600", color: C.text },
  rowMeta: { fontSize: 12, color: C.text2, marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: "700", color: C.text },

  empty: { alignItems: "center", paddingVertical: 28, paddingHorizontal: 8 },
  emptyTitle: { fontSize: 14.5, fontWeight: "600", color: C.text, marginBottom: 6 },
  emptyBody: { fontSize: 12.5, color: C.text2, textAlign: "center", lineHeight: 19 },

  footer: { fontSize: 10.5, color: C.text3, textAlign: "center", marginTop: 8 },
});
