/**
 * Palette lifted from the delivered designs — the same values the web app uses
 * in globals.css. Extracted from App.tsx so every screen shares one source
 * rather than each redeclaring its own near-miss greens.
 */
export const C = {
  // Brand
  green: "#22C875",
  greenBright: "#2FE58A",
  greenDark: "#0B7A4B",
  onBrand: "#04210F",
  // Dark surfaces
  ink: "#0B171B",
  inkRaised: "#132428",
  inkCard: "#102125",
  borderDark: "#24363A",
  textOnDark: "#F8FAFC",
  textOnDarkMuted: "#98A2B3",
  // Light surfaces
  bg: "#F7F8FA",
  card: "#FFFFFF",
  border: "#E5E7EB",
  border2: "#F2F4F7",
  brandBg: "#E9F9F0",
  // Text
  text: "#0B1520",
  text2: "#667085",
  text3: "#98A2B3",
  // Status
  success: "#22C875",
  danger: "#EF5A67",
  warning: "#B54708",
  amber: "#F5B942",
  expense: "#7C3AED",
  /** Text, links and icons on light surfaces; also fills that carry white text. */
  primary: "#0B7A4B",
  /** Stage-1 redesign: the deep Revo green of the hero card, primary buttons and active tab. */
  forest: "#0B6B3D",
  forestDeep: "#085A33",
  forestSoft: "#E8F5EE",
  /** Bright accent used on dark surfaces. */
  accent: "#2FE58A",
};

/** Shared spacing, so screens do not drift apart by a pixel at a time. */
export const SP = {
  screenPad: 16,
  cardRadius: 18,
  cardPad: 16,
  gap: 14,
};

/** Card chrome shared by every white card: hairline border and a soft shadow. */
export const CARD_SHADOW = {
  borderWidth: 1,
  borderColor: "#E5E7EB",
  shadowColor: "#0F172A",
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;
