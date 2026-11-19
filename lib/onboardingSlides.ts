import type { ImageSourcePropType } from "react-native";

/** A tappable area over a button that is part of the poster artwork, as fractions of the poster (0–1). */
export interface Zone { x: number; y: number; w: number; h: number; action: "next" | "done"; label: string }

export interface Slide {
  key: string;
  title: string;                 // accessibility label for the whole poster
  image: ImageSourcePropType;
  /** Poster height / width, known up front so layout is right on first paint on every platform. */
  ratio: number;
  /** Colour behind the poster, matched to its edges so letterboxing is not a visible band. */
  bg: string;
  /** Native touch targets laid over the buttons drawn in the artwork (the artwork itself is not interactive). */
  zones: Zone[];
}

// Poster pixel boxes -> fractions. W/H are the poster's real pixel size.
const z = (W: number, H: number, x0: number, y0: number, x1: number, y1: number, action: Zone["action"], label: string): Zone =>
  ({ x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H, action, label });

/*
 * Order: Retail, Fashion, Electronics, Hotel, Construction, Pharmacy.
 */
export const SLIDES: Slide[] = [
  { key: "retail", image: require("../assets/onboarding/01-retail.png"), ratio: 1756 / 896, bg: "#f7fbfe", title: "Run your retail business smarter. Sales, inventory, customers, payments and reports in one place.",
    zones: [z(896, 1756, 45, 1565, 850, 1670, "done", "Get started"), z(896, 1756, 370, 1685, 530, 1735, "done", "Skip tour")] },
  { key: "fashion", image: require("../assets/onboarding/02-fashion.png"), ratio: 1.5, bg: "#f8f8fc", title: "Run your fashion business smarter. Sales, inventory, customers and payments in one place.",
    zones: [z(1024, 1536, 168, 1338, 856, 1442, "done", "Get started"), z(1024, 1536, 405, 1462, 620, 1505, "done", "Skip for now")] },
  { key: "electronics", image: require("../assets/onboarding/03-electronics.png"), ratio: 1.5, bg: "#e4f5f3", title: "Run your electronics business smarter.",
    zones: [z(1024, 1536, 163, 1342, 860, 1440, "done", "Get started"), z(1024, 1536, 430, 1462, 590, 1505, "done", "Skip tour")] },
  { key: "hotel", image: require("../assets/onboarding/04-hotel.png"), ratio: 1.5, bg: "#cfd7c5", title: "Run your hotel more efficiently. Reservations, rooms, guests, payments and operations.",
    zones: [z(1024, 1536, 217, 1385, 468, 1467, "done", "Skip"), z(1024, 1536, 534, 1385, 816, 1467, "next", "Next")] },
  { key: "construction", image: require("../assets/onboarding/05-construction.png"), ratio: 1.5, bg: "#e7f3f2", title: "Run your construction business with ease. Projects, estimates, materials, expenses and profits.",
    zones: [z(1024, 1536, 155, 1334, 870, 1434, "done", "Get started"), z(1024, 1536, 430, 1455, 590, 1495, "done", "Skip tour")] },
  { key: "pharmacy", image: require("../assets/onboarding/06-pharmacy.png"), ratio: 1.5, bg: "#ebeff6", title: "Run your pharmacy better. Sales, inventory, prescriptions and expiry dates.",
    zones: [z(1024, 1536, 210, 1402, 815, 1495, "done", "Get started"), z(1024, 1536, 880, 25, 990, 90, "done", "Skip")] },
];
