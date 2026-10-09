"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { BonusDashboardClient } from "@/components/bonus-dashboard-client";
import { BonusPageLayout } from "@/components/bonus-page-layout";
import { QuarterlyBonusClient } from "@/components/quarterly-bonus-client";
import { BonusHistoryClient } from "@/components/bonus-history-client";
import { AppSelect } from "@/components/ui/app-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useShop } from "@/components/shop-provider";
import { shopPerformanceIndexQueryOptions } from "@/lib/performance-queries";
import { quarterSchema } from "@/lib/persistence-schemas";
import { formatReportingMonth } from "@/lib/reporting-month";
import { getPerformanceMonthsByImportRecency, getQuarterKey, type PerformanceIndexEntry } from "@/lib/types";

const EMPTY_INDEX: PerformanceIndexEntry[] = [];

export function BonusDashboardRoute({ shopId, requestedMonth, requestedQuarter, historyDetail }: { shopId: string; requestedMonth?: string; requestedQuarter?: string; historyDetail?: { kind: "monthly" | "quarterly"; period: string } }) {
  const { shops, selectedShop, setSelectedShop, selectedDatasetId } = useShop();
  const t = useTranslations("DetailedDashboard");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const view = requestedView === "quarterly" || requestedView === "history" ? requestedView : "monthly";
  const routeShop = shops.find(shop => shop.id === shopId);
  const indexQuery = useQuery({ ...shopPerformanceIndexQueryOptions(shopId), enabled: selectedShop?.id === shopId });
  const index = indexQuery.data ?? EMPTY_INDEX;
  const months = useMemo(
    () => getPerformanceMonthsByImportRecency(index, Object.keys(selectedShop?.monthlyData ?? {})),
    [index, selectedShop?.monthlyData],
  );
  const monthFromUrl = searchParams.get("month");
  const selectedMonth = monthFromUrl && months.includes(monthFromUrl)
    ? monthFromUrl
    : requestedMonth && months.includes(requestedMonth) ? requestedMonth
    : months.includes(selectedDatasetId) ? selectedDatasetId : months[0] ?? "";
  const parsedQuarter = quarterSchema.safeParse(searchParams.get("quarter"));
  const selectedQuarter = parsedQuarter.success ? parsedQuarter.data : requestedQuarter ?? (requestedMonth ? getQuarterKey(requestedMonth) : "");
  const currentQuarter = getQuarterKey(format(new Date(), "yyyy-MM"));
  const quarters = [...new Set([
    currentQuarter,
    ...(parsedQuarter.success ? [parsedQuarter.data] : requestedQuarter ? [requestedQuarter] : []),
    ...(requestedMonth ? [getQuarterKey(requestedMonth)] : []),
    ...Object.keys(selectedShop?.quarterSettings ?? {}),
    ...Object.keys(selectedShop?.monthlyData ?? {}).map(getQuarterKey),
    ...index.map(entry => getQuarterKey(entry.date)),
  ])].sort().reverse();
  const quarter = quarters.includes(selectedQuarter) ? selectedQuarter : quarters[0];

  useEffect(() => {
    if (routeShop && selectedShop?.id !== routeShop.id) setSelectedShop(routeShop);
  }, [routeShop, selectedShop?.id, setSelectedShop]);

  const selectMonth = (month: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("month", month);
    url.searchParams.delete("period");
    url.searchParams.delete("kind");
    window.history.replaceState(null, "", url);
  };
  const selectView = (nextView: string) => {
    const url = new URL(window.location.href);
    if (nextView === "quarterly" || nextView === "history") url.searchParams.set("view", nextView);
    else url.searchParams.delete("view");
    if (nextView !== "history") { url.searchParams.delete("period"); url.searchParams.delete("kind"); }
    window.history.replaceState(null, "", url);
  };
  const selectQuarter = (value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "quarterly");
    url.searchParams.set("quarter", value);
    url.searchParams.delete("period");
    url.searchParams.delete("kind");
    window.history.replaceState(null, "", url);
  };
  const navigation = <TabsList aria-label={t("bonusPage")}>
    <TabsTrigger value="monthly">{t("monthlyBonuses")}</TabsTrigger>
    <TabsTrigger value="quarterly">{t("quarterlyBonus")}</TabsTrigger>
    <TabsTrigger value="history">{t("bonusHistory")}</TabsTrigger>
  </TabsList>;

  if (selectedShop?.id === shopId) return <Tabs value={view} onValueChange={selectView} className="flex h-full flex-col">
    <BonusPageLayout
      title={`${t(view === "quarterly" ? "quarterlyBonus" : view === "history" ? "bonusHistory" : "bonusPage")}: ${selectedShop.name}`}
      navigation={navigation}
      periodSelector={view === "monthly"
        ? <Select disabled={!months.length} value={selectedMonth} onValueChange={selectMonth}>
          <SelectTrigger aria-label={t("bonusMonth")} className="h-9 w-full"><SelectValue><span className="sm:hidden">{formatReportingMonth(selectedMonth, locale, "short")}</span><span className="hidden sm:inline">{formatReportingMonth(selectedMonth, locale)}</span></SelectValue></SelectTrigger>
          <SelectContent>{months.map(month => <SelectItem key={month} value={month}>{formatReportingMonth(month, locale)}</SelectItem>)}</SelectContent>
        </Select>
        : view === "quarterly" ? <AppSelect aria-label={t("quarter")} value={quarter} onValueChange={selectQuarter} options={quarters.map(item => ({ value: item, label: item }))} /> : undefined}
    >
      <TabsContent value="monthly" className="mt-0 space-y-4">
        {indexQuery.isError ? <div className="p-6 text-destructive" role="alert">{t("tryAgain")}</div>
          : indexQuery.isPending ? <div className="flex min-h-64 items-center justify-center gap-2 p-6" role="status"><Loader2 className="h-5 w-5 animate-spin" />{t("loading")}</div>
          : !selectedMonth ? <p className="text-sm text-muted-foreground">{t("noData")}</p>
          : <BonusDashboardClient selectedMonth={selectedMonth} />}
      </TabsContent>
      <TabsContent value="quarterly" className="mt-0 space-y-4"><QuarterlyBonusClient quarter={quarter} /></TabsContent>
      <TabsContent value="history" className="mt-0 space-y-4"><BonusHistoryClient shopId={shopId} detail={historyDetail} /></TabsContent>
    </BonusPageLayout>
  </Tabs>;
  return (
    <div className="shop-page-content flex min-h-64 items-center justify-center">
      {routeShop
        ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>
        : <p>{t("shopNotFound")}</p>}
    </div>
  );
}
