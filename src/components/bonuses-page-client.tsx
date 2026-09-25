"use client";

import { useEffect, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { BonusOverviewClient } from "@/components/bonus-overview-client";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useShop } from "@/components/shop-provider";
import { formatReportingMonth } from "@/lib/reporting-month";
import type { DashboardPeriod } from "@/app/dashboard-actions";

export function BonusesPageClient({ periods }: { periods: DashboardPeriod[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("BonusOverview");
  const { setSelectedDatasetId } = useShop();
  const months = useMemo(() => periods.map(period => ({ id: period.month, name: formatReportingMonth(period.month, locale) })), [periods, locale]);
  const requestedMonth = searchParams.get("month");
  const month = months.some(item => item.id === requestedMonth) ? requestedMonth! : months[0]?.id ?? new Date().toISOString().slice(0, 7);

  useEffect(() => { setSelectedDatasetId(month); }, [month, setSelectedDatasetId]);

  const changeMonth = (nextMonth: string) => {
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("month", nextMonth);
    window.history.replaceState(null, "", `${pathname}?${parameters.toString()}`);
    setSelectedDatasetId(nextMonth);
  };

  return <div className="flex h-svh min-h-0 flex-col overflow-hidden bg-muted/20">
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 md:px-4"><SidebarTrigger className="h-9 w-9" /><span className="font-semibold">{t("title")}</span></header>
    <div className="min-h-0 flex-1 overflow-hidden"><BonusOverviewClient month={month} months={months} onMonthChange={changeMonth} /></div>
  </div>;
}
