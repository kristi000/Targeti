import { z } from "zod";

export const closingViewSchema = z.enum(["daily", "monthly", "debts", "unsubscribes", "cell"]);

export type ClosingView = z.infer<typeof closingViewSchema>;

export function getClosingView(value: string | null): ClosingView {
  const result = closingViewSchema.safeParse(value);
  return result.success ? result.data : "daily";
}

export function closingViewHref(basePath: string, view: ClosingView): string {
  return view === "daily" ? basePath : `${basePath}?view=${view}`;
}
