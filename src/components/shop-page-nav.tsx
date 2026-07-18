"use client";

import Link from "next/link";
import { BarChart3, BadgeDollarSign } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type Props = { shopId: string; active: "performance" | "bonus" };

export function ShopPageNav({ shopId, active }: Props) {
  const locale = useLocale();
  const t = useTranslations("DetailedDashboard");
  const itemClass = (selected: boolean) => cn("flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:gap-2 sm:px-4 sm:py-2 sm:text-sm", selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");
  return <nav aria-label={t("shopPageNavigation")} className="grid w-full grid-cols-2 rounded-lg bg-muted p-1 sm:w-fit">
    <Link href={`/${locale}/shop/${shopId}`} className={itemClass(active === "performance")}><BarChart3 className="h-4 w-4" />{t("performancePage")}</Link>
    <Link href={`/${locale}/shop/${shopId}/bonus`} className={itemClass(active === "bonus")}><BadgeDollarSign className="h-4 w-4" />{t("bonusPage")}</Link>
  </nav>;
}
