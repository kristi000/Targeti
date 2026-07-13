"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BriefcaseBusiness, CalendarCheck, CheckCircle2, CircleDollarSign, Store, Users, UserX } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { fetchBonusSnapshots, saveBonusSnapshot } from "@/app/actions";
import { Header } from "@/components/header";
import { ManagerBonusCard } from "@/components/manager-bonus-card";
import { RepresentativeBonusCards } from "@/components/representative-bonus-cards";
import { ShopPageNav } from "@/components/shop-page-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useShop } from "@/components/shop-provider";
import { useToast } from "@/hooks/use-toast";
import { calculateManagerBonus, MANAGER_PAYOUT_TABLE_VERSION } from "@/lib/manager-bonus";
import { calculateRepresentativeBonus, REPRESENTATIVE_PAYOUT_TABLE_VERSION } from "@/lib/sales-representative-bonus";
import { getEqualRepresentativeTargets, roundRepresentativeTargets } from "@/lib/representative-targets";
import { getMonthlyRepresentatives, getPerformanceShopActuals, getShopMetrics, type BonusSnapshot, type PerformanceMetric, type Target } from "@/lib/types";

export function BonusDashboardClient() {
  const { selectedShop, allPerformanceData, allMonthlyTargets } = useShop();
  const t = useTranslations("DetailedDashboard");
  const locale = useLocale();
  const { toast } = useToast();
  const allData = selectedShop ? allPerformanceData[selectedShop.id] ?? [] : [];
  const months = useMemo(() => Array.from(new Set([
    ...allData.map(item => item.date.slice(0, 7)),
    ...Object.keys(selectedShop?.monthlyData ?? {}),
  ])).sort().reverse(), [allData, selectedShop?.monthlyData]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [snapshots, setSnapshots] = useState<Record<string, BonusSnapshot>>({});
  const [finalizing, setFinalizing] = useState(false);

  useEffect(() => { if (!selectedMonth && months[0]) setSelectedMonth(months[0]); }, [months, selectedMonth]);
  useEffect(() => { if (selectedShop) void fetchBonusSnapshots(selectedShop.id).then(setSnapshots).catch(() => setSnapshots({})); }, [selectedShop]);

  const legacyTargets = selectedShop ? allMonthlyTargets[selectedShop.id] : undefined;
  const monthData = selectedShop?.monthlyData?.[selectedMonth];
  const targets = monthData?.targets ?? legacyTargets;
  const metricSettings = monthData?.metricSettings ?? selectedShop?.metricSettings;
  const metrics = useMemo(() => getShopMetrics(selectedShop ? { ...selectedShop, metricOrder: monthData?.metricOrder ?? selectedShop.metricOrder, metricSettings } : undefined, targets), [selectedShop, monthData?.metricOrder, metricSettings, targets]);
  const performanceData = useMemo(() => allData.filter(entry => entry.date.startsWith(selectedMonth)), [allData, selectedMonth]);
  const totals = useMemo(() => {
    const reps = performanceData.reduce((result, day) => {
      day.reps.forEach(rep => metrics.forEach(metric => {
        result[rep.repId] ??= {} as Record<PerformanceMetric, number>;
        result[rep.repId][metric] = (result[rep.repId][metric] ?? 0) + (rep[metric] ?? 0);
      }));
      return result;
    }, {} as Record<string, Record<PerformanceMetric, number>>);
    return { shop: getPerformanceShopActuals(performanceData, metrics), reps };
  }, [performanceData, metrics]);
  if (!selectedShop || !targets) return null;

  const representatives = getMonthlyRepresentatives(selectedShop, selectedMonth);
  const collection = monthData?.collection ?? selectedShop.revenue;
  const individualTargets = monthData?.representativeTargets
    ? Object.fromEntries(Object.entries(monthData.representativeTargets).map(([repId, repTargets]) => [repId, roundRepresentativeTargets(repTargets)]))
    : Object.fromEntries(representatives.map(rep => [rep.id, getEqualRepresentativeTargets(targets, metrics, representatives.length)]));
  representatives.forEach(rep => { totals.reps[rep.id] ??= Object.fromEntries(metrics.map(metric => [metric, 0])) as Record<PerformanceMetric, number>; });
  const liveManager = collection === undefined ? null : calculateManagerBonus(collection, totals.shop, targets, metrics, metricSettings);
  const liveRepresentatives = collection === undefined ? [] : representatives.map(rep => ({ id: rep.id, name: rep.name, result: calculateRepresentativeBonus(collection, totals.reps[rep.id], individualTargets[rep.id], totals.shop, targets, metrics, metricSettings) }));
  const snapshot = snapshots[selectedMonth];
  const managerResult = snapshot?.manager ?? liveManager;
  const representativeResults = snapshot?.representatives ?? liveRepresentatives.map(item => ({ ...item, eligible: item.result.shopBonusEligible }));
  const displayRepresentatives = snapshot?.representatives.map(item => ({ id: item.id, name: item.name })) ?? representatives;
  const totalRepresentativePayout = representativeResults.reduce((sum, item) => sum + item.result.totalBonus, 0);
  const eligibleCount = representativeResults.filter(item => item.result.shopBonusEligible).length;
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", maximumFractionDigits: 0 });

  const finalize = async () => {
    if (collection === undefined || !liveManager || snapshot) return;
    setFinalizing(true);
    const nextSnapshot: BonusSnapshot = { month: selectedMonth, finalizedAt: new Date().toISOString(), calculationVersion: "bonus-calculation-2026-01", payoutTableVersion: `${MANAGER_PAYOUT_TABLE_VERSION};${REPRESENTATIVE_PAYOUT_TABLE_VERSION}`, inputs: { collection, targets, representativeTargets: individualTargets, metricSettings, metricOrder: [...metrics], shopActuals: totals.shop, representativeActuals: totals.reps }, manager: liveManager, representatives: liveRepresentatives.map(item => ({ ...item, eligible: item.result.shopBonusEligible })) };
    try {
      const result = await saveBonusSnapshot(selectedShop.id, nextSnapshot);
      if (!result.success) throw new Error(result.error);
      setSnapshots(current => ({ ...current, [selectedMonth]: nextSnapshot }));
      toast({ title: "Month finalized", description: `${selectedMonth} is now locked for payroll.` });
    } catch (error) { toast({ variant: "destructive", title: "Finalization failed", description: error instanceof Error ? error.message : "Could not save the payroll snapshot." }); }
    finally { setFinalizing(false); }
  };

  const cards = [
    { label: "Manager total", value: managerResult ? currency.format(managerResult.totalBonus) : "—", icon: CircleDollarSign },
    { label: "Representative payout", value: currency.format(totalRepresentativePayout), icon: Users },
    { label: "Shop collection group", value: managerResult?.groupName ?? "—", icon: Store },
    { label: "Representative eligibility", value: `${eligibleCount} eligible · ${representativeResults.length - eligibleCount} ineligible`, icon: UserX },
  ];

  return <div className="flex h-full flex-col"><Header title={`${t("bonusPage")}: ${selectedShop.name}`} /><div className="flex-1 overflow-y-auto p-3 md:p-4"><div className="space-y-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><Link href={`/${locale}/`} className={buttonVariants({ variant: "outline" })}><ArrowLeft className="mr-2" />{t("backToOverview")}</Link><ShopPageNav shopId={selectedShop.id} active="bonus" /></div><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-semibold">{t("monthlyBonuses")}</h2><p className="text-sm text-muted-foreground">{selectedMonth ? t("bonusMonthDescription", { month: format(parseISO(`${selectedMonth}-01`), "MMMM yyyy") }) : t("noData")}</p></div><div className="flex gap-2"><label className="grid gap-1 text-xs text-muted-foreground">Month<select className="h-9 rounded-md border bg-background px-3 text-sm text-foreground" value={selectedMonth} onChange={event => setSelectedMonth(event.target.value)}>{months.map(month => <option key={month} value={month}>{format(parseISO(`${month}-01`), "MMMM yyyy")}</option>)}</select></label><Button onClick={finalize} disabled={!liveManager || !!snapshot || finalizing}><CalendarCheck className="mr-2 h-4 w-4" />{snapshot ? "Finalized" : finalizing ? "Finalizing…" : "Finalize month"}</Button></div></div>{snapshot && <p className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />Payroll snapshot finalized {new Date(snapshot.finalizedAt).toLocaleString(locale)}. Displaying locked values.</p>}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(item => <Card key={item.label}><CardHeader className="flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">{item.label}</CardTitle><item.icon className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><p className="text-xl font-bold">{item.value}</p></CardContent></Card>)}</div>{collection !== undefined && managerResult ? <Tabs defaultValue="manager"><TabsList className="grid w-full grid-cols-2 sm:w-[420px]"><TabsTrigger value="manager"><BriefcaseBusiness className="mr-2 h-4 w-4" />{t("managerBonusButton")}</TabsTrigger><TabsTrigger value="representatives"><Users className="mr-2 h-4 w-4" />{t("representativeBonusButton")}</TabsTrigger></TabsList><TabsContent value="manager" className="mt-4"><ManagerBonusCard monthlyCollection={collection} actuals={totals.shop} targets={targets} metrics={metrics} metricSettings={metricSettings} result={managerResult} /></TabsContent><TabsContent value="representatives" className="mt-4"><RepresentativeBonusCards representatives={displayRepresentatives} individualActuals={totals.reps} individualTargets={individualTargets} shopActuals={totals.shop} shopTargets={targets} metrics={metrics} monthlyCollection={collection} metricSettings={metricSettings} savedResults={Object.fromEntries(representativeResults.map(item => [item.id, item.result]))} /></TabsContent></Tabs> : <p className="rounded-lg border p-6 text-sm text-muted-foreground">{t("managerBonusMissingCollection")}</p>}</div></div></div>;
}
