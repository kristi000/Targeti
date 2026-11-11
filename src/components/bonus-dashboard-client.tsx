import { useEffect } from "react";
import { BriefcaseBusiness, CheckCircle2, Loader2, Users } from "lucide-react";
import { format } from "date-fns";
import { useLocale, useTranslations } from "use-intl";
import { ManagerBonusCard } from "@/components/manager-bonus-card";
import { RepresentativeBonusCards } from "@/components/representative-bonus-cards";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useShop } from "@/components/shop-provider";
import { useShopMonthBonuses } from "@/hooks/use-shop-month-bonuses";

export function BonusDashboardClient({ selectedMonth }: { selectedMonth: string }) {
  const { selectedShop, allMonthlyTargets, setSelectedDatasetId, setSelectedPerformanceId } = useShop();
  const t = useTranslations("DetailedDashboard");
  const locale = useLocale();
  useEffect(() => {
    if (selectedMonth) setSelectedDatasetId(selectedMonth);
    setSelectedPerformanceId(null);
  }, [selectedMonth, setSelectedDatasetId, setSelectedPerformanceId]);
  const legacyTargets = selectedShop ? allMonthlyTargets[selectedShop.id] : undefined;
  const {
    performanceQuery, snapshotQuery, snapshot, targets, metricSettings, collection,
    managerResult, representativeResults, displayRepresentatives, forecast,
  } = useShopMonthBonuses(selectedShop, selectedMonth, legacyTargets);

  if (!selectedShop) return null;
  const forecastAsOf = snapshot || snapshotQuery.isPending || !forecast ? undefined : format(forecast.asOfDate, "PP");

  if (performanceQuery.isError) return <div className="p-6 text-destructive" role="alert">{t("tryAgain")}</div>;
  if (selectedMonth && performanceQuery.isPending) return <div className="flex min-h-64 items-center justify-center gap-2 p-6" role="status"><Loader2 className="h-5 w-5 animate-spin" />{t("loading")}</div>;
  if (!selectedMonth || !targets) return <p className="text-sm text-muted-foreground">{t("noData")}</p>;
  return <>
    {snapshot && <p className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />Payroll snapshot finalized {new Date(snapshot.finalizedAt).toLocaleString(locale)}. Displaying locked values.</p>}
    {collection !== undefined && managerResult ? <Tabs defaultValue="manager">
      <TabsList className="grid w-full grid-cols-2 sm:w-[420px]"><TabsTrigger value="manager"><BriefcaseBusiness className="mr-2 h-4 w-4" />{t("managerBonusButton")}</TabsTrigger><TabsTrigger value="representatives"><Users className="mr-2 h-4 w-4" />{t("representativeBonusButton")}</TabsTrigger></TabsList>
      <TabsContent value="manager" className="mt-4"><ManagerBonusCard result={managerResult} forecast={forecastAsOf ? forecast?.manager : undefined} forecastAsOf={forecastAsOf} metricSettings={metricSettings} /></TabsContent>
      <TabsContent value="representatives" className="mt-4"><RepresentativeBonusCards representatives={displayRepresentatives} results={Object.fromEntries(representativeResults.map(item => [item.id, item.result]))} forecasts={forecastAsOf ? Object.fromEntries(forecast!.representatives.map(item => [item.id, item.result])) : undefined} forecastAsOf={forecastAsOf} metricSettings={metricSettings} /></TabsContent>
    </Tabs> : <p className="rounded-lg border p-6 text-sm text-muted-foreground">{t("managerBonusMissingCollection")}</p>}
  </>;
}
