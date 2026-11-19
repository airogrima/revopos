import { Pressable, StyleSheet, View } from "react-native";
import { C } from "../theme";
import { Icon } from "./kit";

/** Move a row up or down. Disabled at the ends; 44px-ish touch targets via hitSlop. */
export default function MoveButtons({ index, count, onMove, disabled }: {
  index: number; count: number; onMove: (from: number, to: number) => void; disabled?: boolean;
}) {
  const btn = (dir: -1 | 1, icon: string, label: string, off: boolean) => (
    <Pressable onPress={() => onMove(index, index + dir)} disabled={disabled || off} hitSlop={8}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!(disabled || off) }}
      style={[s.btn, (disabled || off) && { opacity: 0.35 }]}>
      <Icon name={icon} size={16} color={C.text} />
    </Pressable>
  );
  return (
    <View style={s.row}>
      {btn(-1, "up", `Move item ${index + 1} up`, index === 0)}
      {btn(1, "down", `Move item ${index + 1} down`, index === count - 1)}
    </View>
  );
}

/** Pure helper so the reorder rule is testable: returns a new array with the item moved. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const c = list.slice(); const [x] = c.splice(from, 1); c.splice(to, 0, x!); return c;
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, marginRight: 14 },
  btn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.border2, alignItems: "center", justifyContent: "center" },
});
