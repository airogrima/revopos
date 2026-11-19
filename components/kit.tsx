/**
 * The small design kit behind the redesigned screens (Stage 1: Dashboard, More,
 * Invoices, Create Invoice). Presentation only: no data access, no business
 * rules. Built from React Native primitives plus react-native-svg, which the
 * app already ships, so there is no new dependency.
 */

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, CARD_SHADOW } from "../theme";

/* ------------------------------------------------------------------ icons */

/** Line icons (24px grid, 2px stroke). Unknown names render nothing. */
const PATHS: Record<string, ReactNode> = {
  home: <><Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><Path d="M9 22V12h6v10" /></>,
  invoice: <><Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><Path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>,
  users: <><Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><Circle cx="9" cy="7" r="4" /><Path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  grid: <><Rect x="3" y="3" width="7" height="7" rx="1.5" /><Rect x="14" y="3" width="7" height="7" rx="1.5" /><Rect x="14" y="14" width="7" height="7" rx="1.5" /><Rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
  plus: <Path d="M12 5v14M5 12h14" />,
  close: <Path d="M18 6L6 18M6 6l12 12" />,
  user: <><Circle cx="12" cy="8" r="4" /><Path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></>,
  mail: <><Rect x="2" y="4" width="20" height="16" rx="3" /><Path d="M2 7l10 7 10-7" /></>,
  phone: <Path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />,
  store: <><Path d="M3 9l1.5-5h15L21 9" /><Path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" /><Path d="M5 12v8h14v-8M10 20v-5h4v5" /></>,
  eye: <><Path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><Circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><Path d="M17.9 17.9A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 5.1A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a18.6 18.6 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22" /></>,
  tick: <Path d="M20 6L9 17l-5-5" />,
  print: <><Path d="M6 9V2h12v7" /><Path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><Rect x="6" y="14" width="12" height="8" /></>,
  minus: <Path d="M5 12h14" />,
  cart: <><Circle cx="9" cy="21" r="1" /><Circle cx="20" cy="21" r="1" /><Path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></>,
  box: <><Path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><Path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" /></>,
  card: <><Rect x="1" y="4" width="22" height="16" rx="2" /><Path d="M1 10h22" /></>,
  chart: <Path d="M18 20V10M12 20V4M6 20v-6" />,
  trend: <Path d="M23 6l-9.5 9.5-5-5L1 18M17 6h6v6" />,
  sliders: <Path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  bell: <Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />,
  search: <><Circle cx="11" cy="11" r="8" /><Path d="M21 21l-4.35-4.35" /></>,
  right: <Path d="M9 18l6-6-6-6" />,
  left: <Path d="M15 18l-6-6 6-6" />,
  down: <Path d="M6 9l6 6 6-6" />,
  up: <Path d="M18 15l-6-6-6 6" />,
  calendar: <><Rect x="3" y="4" width="18" height="18" rx="2" /><Path d="M16 2v4M8 2v4M3 10h18" /></>,
  userPlus: <><Path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><Circle cx="8.5" cy="7" r="4" /><Path d="M20 8v6M23 11h-6" /></>,
  clipboard: <><Path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><Rect x="8" y="2" width="8" height="4" rx="1" /></>,
  briefcase: <><Rect x="2" y="7" width="20" height="14" rx="2" /><Path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>,
  check: <><Path d="M9 11l3 3L22 4" /><Path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  dollar: <Path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  layers: <Path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />,
  help: <><Circle cx="12" cy="12" r="10" /><Path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" /></>,
  bank: <Path d="M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M2 10l10-7 10 7" />,
  tag: <Path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01" />,
  lock: <><Rect x="3" y="11" width="18" height="11" rx="2" /><Path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  gift: <><Path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7" /><Path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></>,
};

export function Icon({ name, size = 22, color = C.text, strokeWidth = 2 }: {
  name: string; size?: number; color?: string; strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
         strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name] ?? null}
    </Svg>
  );
}

/* ----------------------------------------------------------------- header */

/** Page header: optional back chevron, title (left-aligned), optional right action. */
export function AppHeader({ title, subtitle, onBack, right, top = true }: {
  title: string; subtitle?: string; onBack?: () => void; right?: ReactNode; top?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[k.header, top && { paddingTop: insets.top + 10 }]}>
      {onBack && (
        <Pressable onPress={onBack} hitSlop={10} style={k.back} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="left" size={22} color={C.text} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <Text style={k.headerTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={k.headerSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** Round green "+" used at the top right of list screens. */
export function RoundAddButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} style={k.roundAdd} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <Icon name="plus" size={20} color="#fff" strokeWidth={2.6} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ cards */

export function StatCard({ icon, tint, label, value, note }: {
  icon: string; tint: string; label: string; value: string; note?: string;
}) {
  return (
    <View style={k.stat}>
      <View style={[k.statIcon, { backgroundColor: tint + "1F" }]}><Icon name={icon} size={18} color={tint} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={k.statLabel} numberOfLines={1}>{label}</Text>
        <Text style={k.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{value}</Text>
        {note ? <Text style={k.statNote} numberOfLines={1}>{note}</Text> : null}
      </View>
    </View>
  );
}

export function QuickAction({ icon, tint, label, onPress, onLongPress, pressRef, hint }: {
  icon: string; tint: string; label: string; onPress: () => void;
  /** Optional: a long press runs this instead of onPress (never both). */
  onLongPress?: () => void; pressRef?: React.Ref<View>; hint?: string;
}) {
  return (
    <Pressable ref={pressRef} onPress={onPress} onLongPress={onLongPress} delayLongPress={380}
      style={({ pressed }) => [k.qa, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={label}
      accessibilityHint={hint} accessibilityActions={onLongPress ? [{ name: "longpress", label: "More create options" }] : undefined}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === "longpress") onLongPress?.(); }}>
      <View style={[k.qaIcon, { backgroundColor: tint + "1F" }]}><Icon name={icon} size={22} color={tint} /></View>
      <Text style={k.qaLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={k.sectionHead}>
      <Text style={k.sectionTitle}>{title}</Text>
      {action ? <Pressable onPress={onAction} hitSlop={8}><Text style={k.sectionAction}>{action}</Text></Pressable> : null}
    </View>
  );
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={k.search}>
      <Icon name="search" size={18} color={C.text3} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.text3}
                 style={k.searchInput} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
    </View>
  );
}

export function FilterChips<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <View style={k.chips}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[k.chip, value === o.value && k.chipOn]}
                   accessibilityState={{ selected: value === o.value }}>
          <Text style={[k.chipText, value === o.value && k.chipTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const BADGES: Record<string, { fg: string; bg: string }> = {
  paid: { fg: "#067647", bg: "#DCF5E7" },
  pending: { fg: "#B54708", bg: "#FEF0C7" },
  overdue: { fg: "#B42318", bg: "#FEE4E2" },
  draft: { fg: "#475467", bg: "#F2F4F7" },
  void: { fg: "#475467", bg: "#F2F4F7" },
};
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const b = BADGES[status] ?? BADGES.draft;
  return (
    <View style={[k.badge, { backgroundColor: b.bg }]}>
      <Text style={[k.badgeText, { color: b.fg }]}>{label ?? status}</Text>
    </View>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.forestSoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: C.forest, fontWeight: "700", fontSize: size * 0.34 }}>{initials}</Text>
    </View>
  );
}

/** White rounded surface with the shared hairline + soft shadow. */
export function ListCard({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: object }) {
  if (!onPress) return <View style={[k.listCard, style]}>{children}</View>;
  return <Pressable onPress={onPress} style={({ pressed }) => [k.listCard, style, pressed && { opacity: 0.7 }]}>{children}</Pressable>;
}

export function PrimaryButton({ label, onPress, busy, disabled }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy || disabled} accessibilityRole="button"
               style={({ pressed }) => [k.primary, (pressed || busy || disabled) && { opacity: 0.75 }]}>
      <Text style={k.primaryText}>{busy ? "Please wait…" : label}</Text>
    </Pressable>
  );
}

const k = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: C.bg },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 22, fontWeight: "700", color: C.text, letterSpacing: -0.4 },
  headerSub: { fontSize: 12.5, color: C.text2, marginTop: 1 },
  roundAdd: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.forest, alignItems: "center", justifyContent: "center" },

  stat: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.card, borderRadius: 16, padding: 12, width: "48.5%", flexGrow: 1, ...CARD_SHADOW },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statLabel: { fontSize: 11.5, color: C.text2 },
  statValue: { fontSize: 18, fontWeight: "700", color: C.text, letterSpacing: -0.3, marginTop: 1 },
  statNote: { fontSize: 11, color: C.text3, marginTop: 1 },

  qa: { flex: 1, alignItems: "center", gap: 7, paddingVertical: 4 },
  qaIcon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  qaLabel: { fontSize: 12, color: C.text, fontWeight: "500", textAlign: "center" },

  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: C.text },
  sectionAction: { fontSize: 13, fontWeight: "600", color: C.forest },

  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 14, minHeight: 46, borderWidth: 1, borderColor: C.border },
  searchInput: { flex: 1, fontSize: 14.5, color: C.text, paddingVertical: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 12 },
  chip: { paddingHorizontal: 15, minHeight: 34, justifyContent: "center", borderRadius: 99, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: C.forest, borderColor: C.forest },
  chipText: { fontSize: 13, fontWeight: "600", color: C.text2 },
  chipTextOn: { color: "#fff" },

  badge: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },

  listCard: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 10, ...CARD_SHADOW },

  primary: { backgroundColor: C.forest, borderRadius: 14, minHeight: 54, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
