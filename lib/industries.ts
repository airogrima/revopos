/**
 * Industry choices. Mirrors apps/web/lib/industries.ts (the database's
 * set_org_industry is the authority on which keys are accepted).
 */
export const INDUSTRIES: { key: string; label: string }[] = [
  { key: "retail", label: "Retail / Supermarket" },
  { key: "restaurant", label: "Restaurant / Bar" },
  { key: "hotel", label: "Hotel / Hospitality" },
  { key: "pharmacy", label: "Pharmacy" },
  { key: "fashion", label: "Fashion" },
  { key: "electronics", label: "Electronics" },
  { key: "construction", label: "Construction" },
  { key: "professional_services", label: "Professional Services" },
  { key: "other", label: "Other" },
];
