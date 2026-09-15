"use client";

import { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { fetchDashboardPeriods } from "@/app/dashboard-actions";
import { useShop } from "@/components/shop-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatReportingDate, formatReportingMonth } from "@/lib/reporting-month";
import { dashboardPeriodsQueryKey } from "@/lib/query-keys";

export function ReportingDateSelector() {
  const t = useTranslations("Sidebar");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setSelectedDatasetId } = useShop();
  const periodsQuery = useQuery({
    queryKey: dashboardPeriodsQueryKey,
    queryFn: fetchDashboardPeriods,
    staleTime: 60_000,
  });
  const periods = useMemo(() => (periodsQuery.data ?? []).map(period => ({
    id: period.month,
    name: period.reportDate
      ? formatReportingDate(period.reportDate, locale)
      : formatReportingMonth(period.month, locale),
  })), [periodsQuery.data, locale]);
  const requestedMonth = searchParams.get("month");
  const activeMonth = periods.some(period => period.id === requestedMonth)
    ? requestedMonth!
    : periods[0]?.id;

  if (!activeMonth) return null;

  const changePeriod = (month: string) => {
    const parameters = new URLSearchParams(searchParams.toString());
    parameters.set("month", month);
    parameters.delete("page");
    parameters.delete("afterHasData");
    parameters.delete("afterType");
    parameters.delete("afterValue");
    parameters.delete("afterName");
    parameters.delete("afterId");
    router.replace(`${pathname}?${parameters.toString()}`, { scroll: false });
    setSelectedDatasetId(month);
  };

  return (
    <Select value={activeMonth} onValueChange={changePeriod}>
      <SelectTrigger
        aria-label={t("reportingDate")}
        className="h-9 justify-start gap-2 rounded-full border-sidebar-border bg-sidebar-accent/60 px-3 text-sidebar-foreground shadow-none transition-colors hover:border-primary/30 hover:bg-sidebar-accent focus:ring-sidebar-ring"
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
        <SelectValue className="min-w-0 flex-1 truncate text-left text-xs font-medium" />
      </SelectTrigger>
      <SelectContent>
        {periods.map(period => (
          <SelectItem key={period.id} value={period.id}>{period.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
