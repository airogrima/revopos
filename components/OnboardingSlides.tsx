import { useCallback, useRef, useState } from "react";
import {
  FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SLIDES, type Slide } from "../lib/onboardingSlides";

/**
 * First-run welcome tour: one full-screen poster per page, swipeable.
 *
 * The posters are finished artwork that already draw their own buttons, so no second set of
 * controls is stacked on top. Instead, transparent native touch targets sit exactly over the
 * drawn buttons (lib/onboardingSlides.ts, as fractions of the poster so they follow it at any
 * size). The artwork is never stretched or cropped: it is scaled with its aspect ratio kept to
 * the largest size that fits inside the safe area, and centred on a matching background colour.
 * Layout comes from useWindowDimensions, so it recomputes when a foldable (Galaxy Z Flip) is
 * opened or closed, or a tablet rotates. The one native control is a small "Next" arrow, shown
 * only on posters that do not draw a Next button of their own.
 */
export default function OnboardingSlides({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);

  // onScroll (not momentum-end): it also fires for the animated scroll a Next tap triggers, so the
  // current index can never lag behind.
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex((cur) => (cur === i ? cur : Math.max(0, Math.min(SLIDES.length - 1, i))));
  }, [width]);

  const goNext = useCallback(() => {
    if (index >= SLIDES.length - 1) { onDone(); return; }
    list.current?.scrollToIndex({ index: index + 1, animated: true });
  }, [index, onDone]);

  const room = { w: width, h: Math.max(height - insets.top - insets.bottom, 200) };

  const renderItem = ({ item }: { item: Slide }) => {
    // Largest size that fits both ways with the aspect ratio kept (contain).
    const pw = Math.min(room.w, room.h / item.ratio);
    const ph = pw * item.ratio;
    return (
      <View style={{ width, height, backgroundColor: item.bg, paddingTop: insets.top, paddingBottom: insets.bottom, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: pw, height: ph }}>
          <Image source={item.image} resizeMode="contain" style={{ width: pw, height: ph }} accessibilityLabel={item.title} fadeDuration={0} />
          {item.zones.map((zn) => (
            <Pressable key={zn.label} onPress={zn.action === "next" ? goNext : onDone}
              accessibilityRole="button" accessibilityLabel={zn.label}
              hitSlop={6}
              style={{ position: "absolute", left: zn.x * pw, top: zn.y * ph, width: zn.w * pw, height: Math.max(zn.h * ph, 44) }} />
          ))}
        </View>
      </View>
    );
  };

  const slide = SLIDES[index]!;
  const hasOwnNext = slide.zones.some((zn) => zn.action === "next");
  const last = index === SLIDES.length - 1;

  return (
    <View style={[s.root, { backgroundColor: slide.bg }]}>
      <FlatList
        ref={list}
        data={SLIDES}
        keyExtractor={(x) => x.key}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        extraData={`${width}x${height}`}
        initialNumToRender={2}
        windowSize={3}
        bounces={false}
      />
      {!hasOwnNext && !last ? (
        <Pressable onPress={goNext} accessibilityRole="button" accessibilityLabel="Next slide" hitSlop={8}
          style={[s.next, { right: 16, bottom: Math.max(insets.bottom, 12) + 6 }]}>
          <Text style={s.nextText}>›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  next: { position: "absolute", width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(11,107,61,0.92)", alignItems: "center", justifyContent: "center" },
  nextText: { color: "#fff", fontSize: 28, lineHeight: 30, fontWeight: "600" },
});
