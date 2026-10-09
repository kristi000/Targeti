export const performanceMetricNames = ["CLS", "FCP", "INP", "LCP", "TTFB"] as const;
export const performanceRouteNames = [
  "dashboard", "insights", "bonuses", "shop-performance", "shop-bonus",
  "daily-closing", "daily-activity", "attendance", "procedures", "other",
] as const;

export type PerformanceMetricSample = {
  id: string;
  name: typeof performanceMetricNames[number];
  value: number;
  route: typeof performanceRouteNames[number];
  viewport: "mobile" | "desktop";
};

// Classify routes without sending shop IDs, query strings or other URL data.
export function getPerformanceRoute(pathname: string): PerformanceMetricSample["route"] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "en" || parts[0] === "sq") parts.shift();
  if (!parts.length) return "dashboard";
  if (parts[0] === "insights") return "insights";
  if (parts[0] === "bonuses") return "bonuses";
  if (parts[0] !== "shop" || !parts[1]) return "other";
  switch (parts[2]) {
    case undefined: return "shop-performance";
    case "bonus": return "shop-bonus";
    case "closing": return "daily-closing";
    case "daily-activity": return "daily-activity";
    case "attendance": return "attendance";
    case "procedures": return "procedures";
    default: return "other";
  }
}
