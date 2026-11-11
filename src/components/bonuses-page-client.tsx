import { useEffect, useMemo } from "react";
import { useLocale, useTranslations } from "use-intl";
import { usePathname, useSearchParams, replaceUrl } from "@/lib/navigation";
import { BonusOverviewClient } from "@/components/bonus-overview-client";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useShop } from "@/components/shop-provider";
import { formatReportingMonth, resolveReportingMonth } from "@/lib/reporting-month";
import type { DashboardPeriod } from "@/server/actions/dashboard";

export function BonusesPageClient({ periods }: { periods: DashboardPeriod[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("BonusOverview");
  const { setSelectedDatasetId } = useShop();
  const months = useMemo(() => periods.map(period => ({ id: period.month, name: formatReportingMonth(period.month, locale) })), [periods, locale]);
  const requestedMonth = searchParams.get("month");
  const month = resolveReportingMonth(periods, requestedMonth);

  useEffect(() => { setSelectedDatasetId(month); }, [month, setSelectedDatasetId]);

  const changeMonth = (nextMonth: string) => {
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("month", nextMonth);
    replaceUrl(`${pathname}?${parameters.toString()}`);
    setSelectedDatasetId(nextMonth);
  };

  return <div className="flex h-[calc(100svh-var(--bottom-nav-height))] min-h-0 flex-col overflow-hidden bg-muted/20">
    <header className="glass mx-2 mt-2 flex h-12 shrink-0 items-center gap-2 rounded-2xl px-3 md:mx-3 md:px-4"><SidebarTrigger className="h-9 w-9" /><h1 className="font-semibold">{t("title")}</h1></header>
    <div className="min-h-0 flex-1 overflow-hidden"><BonusOverviewClient month={month} months={months} onMonthChange={changeMonth} /></div>
  </div>;
}
