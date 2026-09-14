"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import {
  Banknote,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ClipboardCopy,
  CircleAlert,
  CircleGauge,
  Clock3,
  HandCoins,
  LockKeyhole,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  Smartphone,
  Trash2,
  UserMinus,
  Wallet,
} from "lucide-react";

import { fetchDailyClosing, handleFinalizeDailyClosing, handleReopenDailyClosing, handleSaveDailyClosing } from "@/app/actions";
import { Header } from "@/components/header";
import { MonthlyClosingSummary } from "@/components/monthly-closing-summary";
import { MonthlyCellSummary } from "@/components/monthly-cell-summary";
import { MonthlyDebts } from "@/components/monthly-debts";
import { MonthlyUnsubscribes } from "@/components/monthly-unsubscribes";
import { closingMonthSchema, monthlyCellQueryKey, monthlyClosingQueryKey, monthlyDebtsQueryKey, monthlyUnsubscribesQueryKey } from "@/lib/monthly-closing";
import { useShop } from "@/components/shop-provider";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { calculateDailyClosing, CASH_DENOMINATIONS, createDailyClosingSummary, createEmptyCashCounts, DEFAULT_EXCHANGE_RATE, EURO_DENOMINATION_KEY, getDailyClosingMetricConfig } from "@/lib/daily-closing";
import { getCustomMetricLabel } from "@/lib/metric-definitions";
import { type DailyClosing, type DailyClosingDebt, type DailyClosingUnsubscribeEntry, type PerformanceMetric } from "@/lib/types";
import { cn } from "@/lib/utils";

type Adjustments = { boss: number; invoice: number; unsubscribe: number };
type AutosaveStatus = "ready" | "pending" | "saving" | "saved" | "error";

const EMPTY_ADJUSTMENTS: Adjustments = { boss: 0, invoice: 0, unsubscribe: 0 };

const primaryAmountInputClassName = "h-9 border-primary/40 bg-primary/[0.06] pr-10 text-right text-base font-semibold tabular-nums shadow-sm focus-visible:ring-primary/40 dark:bg-primary/10";

function numericValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function DailyClosingClient() {
  const locale = useLocale();
  const monthlyTranslations = useTranslations("MonthlyClosing");
  const debtTranslations = useTranslations("MonthlyDebts");
  const unsubscribeTranslations = useTranslations("MonthlyUnsubscribes");
  const cellTranslations = useTranslations("MonthlyCell");
  const queryClient = useQueryClient();
  const [view, setView] = useState<"daily" | "monthly" | "debts" | "unsubscribes" | "cell">("daily");
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const t = useTranslations("DailyClosing");
  const metricTranslations = useTranslations("Metrics");
  const { toast } = useToast();
  const { selectedShop, actor, setSelectedDatasetId, setSelectedPerformanceId } = useShop();
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [debtRevision, setDebtRevision] = useState(0);
  const [closing, setClosing] = useState<DailyClosing | null>(null);
  const [cashCounts, setCashCounts] = useState<Record<string, number>>(() => createEmptyCashCounts());
  const [exchangeRate, setExchangeRate] = useState(DEFAULT_EXCHANGE_RATE);
  const [cell, setCell] = useState({ amount: 0, note: "" });
  const [adjustments, setAdjustments] = useState<Adjustments>(EMPTY_ADJUSTMENTS);
  const [debts, setDebts] = useState<DailyClosingDebt[]>([]);
  const [unsubscribeEntries, setUnsubscribeEntries] = useState<DailyClosingUnsubscribeEntry[]>([]);
  const [activities, setActivities] = useState<Partial<Record<PerformanceMetric, number>>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<"save" | "finalize" | "reopen" | null>(null);
  const [autosaveReady, setAutosaveReady] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("ready");
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const autosaveBaselineRef = useRef<string | null>(null);

  useEffect(() => {
    setSelectedDatasetId(view === "daily" ? date.slice(0, 7) : month);
    setSelectedPerformanceId(null);
  }, [date, month, view, setSelectedDatasetId, setSelectedPerformanceId]);

  const metricConfig = useMemo(
    () => selectedShop ? getDailyClosingMetricConfig(selectedShop, date) : { metrics: [], metricSettings: undefined, targets: undefined },
    [selectedShop, date],
  );
  const { metrics, metricSettings, targets } = metricConfig;
  const unsubscribeTotal = useMemo(
    () => unsubscribeEntries.reduce((total, entry) => total + entry.amount, 0),
    [unsubscribeEntries],
  );
  const effectiveAdjustments = useMemo(
    () => ({ ...adjustments, unsubscribe: unsubscribeTotal }),
    [adjustments, unsubscribeTotal],
  );

  const calculation = useMemo(() => calculateDailyClosing({
    cashCounts,
    exchangeRate,
    adjustments: effectiveAdjustments,
    debts,
    activities,
    metrics,
    metricSettings,
    targets,
  }), [cashCounts, exchangeRate, effectiveAdjustments, debts, activities, metrics, metricSettings, targets]);

  useEffect(() => {
    if (!selectedShop) return;
    let active = true;
    setLoading(true);
    setAutosaveReady(false);
    setAutosaveStatus("ready");
    autosaveBaselineRef.current = null;
    void fetchDailyClosing(selectedShop.id, date).then(data => {
      if (!active) return;
      setClosing(data);
      setCashCounts(data?.cashCounts ?? createEmptyCashCounts());
      setExchangeRate(data?.exchangeRate ?? DEFAULT_EXCHANGE_RATE);
      setCell(data?.cell ?? { amount: 0, note: "" });
      setAdjustments(data?.adjustments ?? EMPTY_ADJUSTMENTS);
      setDebts(data?.debts ?? []);
      setUnsubscribeEntries(data?.unsubscribeEntries?.length
        ? data.unsubscribeEntries
        : data?.adjustments.unsubscribe
          ? [{ id: "legacy-unsubscribe", invoice: t("legacyEntry"), msisdn: "-", amount: data.adjustments.unsubscribe }]
          : []);
      setActivities(data?.activities ?? {});
    }).catch(error => {
      console.error("Failed to load daily closing:", error);
      if (active) toast({ variant: "destructive", title: t("loadFailed"), description: t("tryAgain") });
    }).finally(() => {
      if (active) {
        setLoading(false);
        setAutosaveReady(true);
      }
    });
    return () => { active = false; };
  }, [selectedShop, date, t, toast, debtRevision]);

  const isFinalized = closing?.status === "finalized";
  const isReadOnly = isFinalized || actor.role === "viewer";
  const isCellReadOnly = isFinalized || actor.role !== "admin";
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const percentFormatter = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const payload = () => ({
    shopId: selectedShop?.id ?? "",
    date,
    expectedUpdatedAt: closing?.updatedAt ?? null,
    cashCounts,
    exchangeRate,
    cell,
    adjustments: effectiveAdjustments,
    debts: debts.filter(debt => debt.description.trim() || debt.amount > 0),
    unsubscribeEntries: unsubscribeEntries.filter(entry => entry.invoice.trim() || entry.msisdn.trim() || entry.amount > 0),
    activities: Object.fromEntries(metrics.map(metric => [metric, activities[metric] ?? 0])),
  });

  const autosaveSnapshot = useMemo(() => JSON.stringify({
    shopId: selectedShop?.id,
    date,
    cashCounts,
    exchangeRate,
    cell,
    adjustments: effectiveAdjustments,
    debts: debts.filter(debt => debt.description.trim() || debt.amount > 0),
    unsubscribeEntries: unsubscribeEntries.filter(entry => entry.invoice.trim() || entry.msisdn.trim() || entry.amount > 0),
    activities: Object.fromEntries(metrics.map(metric => [metric, activities[metric] ?? 0])),
  }), [selectedShop?.id, date, cashCounts, exchangeRate, cell, effectiveAdjustments, debts, unsubscribeEntries, metrics, activities]);

  const applySavedClosing = (data: DailyClosing) => {
    const shopId = selectedShop?.id ?? "";
    void queryClient.invalidateQueries({ queryKey: monthlyClosingQueryKey(shopId, data.date.slice(0, 7)) });
    void queryClient.invalidateQueries({ queryKey: monthlyDebtsQueryKey(shopId, data.date.slice(0, 7)) });
    void queryClient.invalidateQueries({ queryKey: monthlyUnsubscribesQueryKey(shopId, data.date.slice(0, 7)) });
    void queryClient.invalidateQueries({ queryKey: monthlyCellQueryKey(shopId, data.date.slice(0, 7)) });
    setClosing(data);
    setCashCounts(data.cashCounts);
    setExchangeRate(data.exchangeRate);
    setCell(data.cell);
    setAdjustments(data.adjustments);
    setDebts(data.debts);
    setUnsubscribeEntries(data.unsubscribeEntries ?? []);
    setActivities(data.activities);
  };

  const save = async () => {
    setSubmitting("save");
    const result = await handleSaveDailyClosing(payload());
    setSubmitting(null);
    if (!result.success) return toast({ variant: "destructive", title: t("saveFailed"), description: result.error });
    autosaveBaselineRef.current = autosaveSnapshot;
    setAutosaveStatus("saved");
    applySavedClosing(result.data);
    toast({ title: t("saved"), description: t("savedDescription") });
  };

  const finalize = async () => {
    setSubmitting("finalize");
    const result = await handleFinalizeDailyClosing(payload());
    setSubmitting(null);
    if (!result.success) return toast({ variant: "destructive", title: t("finalizeFailed"), description: result.error });
    applySavedClosing(result.data);
    toast({ title: t("finalized"), description: t("finalizedDescription") });
  };

  const reopen = async () => {
    setSubmitting("reopen");
    const result = await handleReopenDailyClosing(selectedShop?.id ?? "", date);
    setSubmitting(null);
    if (!result.success) return toast({ variant: "destructive", title: t("reopenFailed"), description: result.error });
    applySavedClosing(result.data);
    toast({ title: t("reopened"), description: t("reopenedDescription") });
  };

  useEffect(() => {
    if (!selectedShop || !autosaveReady || loading || isFinalized || actor.role === "viewer") return;

    if (autosaveBaselineRef.current === null) {
      autosaveBaselineRef.current = autosaveSnapshot;
      setAutosaveStatus("ready");
      return;
    }
    if (autosaveBaselineRef.current === autosaveSnapshot) return;

    setAutosaveStatus("pending");
    const timer = window.setTimeout(() => {
      if (submitting !== null) return;

      void (async () => {
        setAutosaveStatus("saving");
        setSubmitting("save");
        const result = await handleSaveDailyClosing(payload());
        setSubmitting(null);
        if (!result.success) {
          setAutosaveStatus("error");
          toast({ variant: "destructive", title: t("saveFailed"), description: result.error });
          return;
        }
        autosaveBaselineRef.current = autosaveSnapshot;
        setAutosaveStatus("saved");
        applySavedClosing(result.data);
      })();
    }, 10_000);

    return () => window.clearTimeout(timer);
  }, [actor.role, autosaveReady, autosaveSnapshot, isFinalized, loading, selectedShop, submitting]);

  if (!selectedShop) return null;

  const metricLabel = (metric: PerformanceMetric) => metric.startsWith("custom_")
    ? getCustomMetricLabel(metric, metricSettings)
    : metricTranslations(metric as Parameters<typeof metricTranslations>[0]);

  const differenceColor = calculation.totals.difference > 0
    ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : calculation.totals.difference < 0
      ? "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-300"
      : "";

  const summaryCards = [
    { label: t("countedCash"), value: `${formatter.format(calculation.totals.countedCash)} Lek`, icon: Banknote },
    { label: t("expectedCash"), value: `${formatter.format(calculation.totals.expectedCash)} Lek`, icon: HandCoins },
    { label: t("difference"), value: `${formatter.format(calculation.totals.difference)} Lek`, icon: Scale, className: differenceColor },
    { label: t("dailyIncrease"), value: percentFormatter.format(calculation.totals.performanceScore), icon: CircleGauge },
  ];

  const dailySummary = createDailyClosingSummary({
    shopName: selectedShop.name,
    boss: adjustments.boss,
    invoice: adjustments.invoice,
    activities,
    metrics,
    metricSettings,
    performanceScore: calculation.totals.performanceScore,
    formatNumber: value => formatter.format(value),
  });

  const copyDailySummary = async () => {
    try {
      await navigator.clipboard.writeText(dailySummary);
      toast({ title: t("summaryCopied"), description: t("summaryCopiedDescription") });
    } catch {
      toast({ variant: "destructive", title: t("summaryCopyFailed"), description: t("summaryCopyFailedDescription") });
    }
  };

  const debtEntriesCard = <Card><CardHeader className="flex-row items-center justify-between space-y-0 p-3 pb-2"><CardTitle className="text-base">{t("debts")}</CardTitle><Button type="button" variant="outline" size="sm" className="h-7" disabled={isReadOnly} onClick={() => setDebts(current => [...current, { id: crypto.randomUUID(), description: "", amount: 0 }])}><Plus className="mr-1 h-3.5 w-3.5" />{t("addDebt")}</Button></CardHeader><CardContent className="space-y-1.5 p-3 pt-0">{debts.length === 0 ? <p className="rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">{t("noDebts")}</p> : debts.map((debt, index) => <div key={debt.id} className="grid grid-cols-[minmax(0,1fr)_7rem_2rem] gap-1.5"><Input aria-label={t("debtDescription", { number: index + 1 })} placeholder={t("debtPlaceholder")} disabled={isReadOnly} className="h-8" value={debt.description} onChange={event => setDebts(current => current.map(item => item.id === debt.id ? { ...item, description: event.target.value } : item))} /><Input aria-label={t("debtAmount", { number: index + 1 })} type="number" min={0} step={1} disabled={isReadOnly} className="h-8 text-right" value={debt.amount} onChange={event => setDebts(current => current.map(item => item.id === debt.id ? { ...item, amount: numericValue(event.target.value) } : item))} /><Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={isReadOnly} aria-label={t("removeDebt")} onClick={() => setDebts(current => current.filter(item => item.id !== debt.id))}><Trash2 className="h-4 w-4" /></Button></div>)}</CardContent></Card>;

  const unsubscribeEntriesCard = <Card><CardHeader className="flex-row items-center justify-between space-y-0 p-3 pb-2"><CardTitle className="text-base">{t("unsubscribeEntries")}</CardTitle><Button type="button" variant="outline" size="sm" className="h-7" disabled={isReadOnly} onClick={() => setUnsubscribeEntries(current => [...current, { id: crypto.randomUUID(), invoice: "", msisdn: "", amount: 0 }])}><Plus className="mr-1 h-3.5 w-3.5" />{t("addUnsubscribe")}</Button></CardHeader><CardContent className="max-h-32 space-y-1.5 overflow-y-auto p-3 pt-0">{unsubscribeEntries.length === 0 ? <p className="rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">{t("noUnsubscribeEntries")}</p> : unsubscribeEntries.map((entry, index) => <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_2rem] gap-1.5"><Input aria-label={t("unsubscribeInvoice", { number: index + 1 })} placeholder={t("invoicePlaceholder")} disabled={isReadOnly} className="h-8" value={entry.invoice} onChange={event => setUnsubscribeEntries(current => current.map(item => item.id === entry.id ? { ...item, invoice: event.target.value } : item))} /><Input aria-label={t("unsubscribeMsisdn", { number: index + 1 })} placeholder={t("msisdnPlaceholder")} disabled={isReadOnly} className="h-8" value={entry.msisdn} onChange={event => setUnsubscribeEntries(current => current.map(item => item.id === entry.id ? { ...item, msisdn: event.target.value } : item))} /><Input aria-label={t("unsubscribeAmount", { number: index + 1 })} type="number" min={0} step={1} disabled={isReadOnly} className="h-8 text-right" value={entry.amount} onChange={event => setUnsubscribeEntries(current => current.map(item => item.id === entry.id ? { ...item, amount: numericValue(event.target.value) } : item))} /><Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={isReadOnly} aria-label={t("removeUnsubscribe")} onClick={() => setUnsubscribeEntries(current => current.filter(item => item.id !== entry.id))}><Trash2 className="h-4 w-4" /></Button></div>)}</CardContent></Card>;

  const cashCountCard = <Card><CardContent className="px-3 py-2"><div className="grid gap-px">{CASH_DENOMINATIONS.map(item => <div key={item.key} className="grid min-h-6 grid-cols-[minmax(4.5rem,0.8fr)_6rem_minmax(5.5rem,1fr)] items-center gap-1 rounded border px-2"><span className="text-xs font-medium tabular-nums">{item.label} Lek</span><Input aria-label={`${item.label} ${t("quantity")}`} type="number" min={0} step={1} disabled={isReadOnly} className="h-6 rounded px-1 text-center text-sm tabular-nums" value={cashCounts[item.key] ?? 0} onChange={event => setCashCounts(current => ({ ...current, [item.key]: Math.floor(numericValue(event.target.value)) }))} /><span className="text-right text-xs font-medium tabular-nums">{formatter.format(item.value * (cashCounts[item.key] ?? 0))}</span></div>)}<div className="grid min-h-6 grid-cols-[minmax(4.5rem,0.8fr)_6rem_minmax(5.5rem,1fr)] items-center gap-1 rounded border px-2"><div className="flex items-center gap-1"><span className="text-xs font-medium">EUR</span><Input aria-label={t("exchangeRate")} type="number" min={0.01} step={0.01} disabled={isReadOnly} className="h-6 w-12 rounded px-0.5 text-center text-xs" value={exchangeRate} onChange={event => setExchangeRate(numericValue(event.target.value))} /></div><Input aria-label={`EUR ${t("quantity")}`} type="number" min={0} step={1} disabled={isReadOnly} className="h-6 rounded px-1 text-center text-sm tabular-nums" value={cashCounts[EURO_DENOMINATION_KEY] ?? 0} onChange={event => setCashCounts(current => ({ ...current, [EURO_DENOMINATION_KEY]: Math.floor(numericValue(event.target.value)) }))} /><span className="text-right text-xs font-medium tabular-nums">{formatter.format((cashCounts[EURO_DENOMINATION_KEY] ?? 0) * exchangeRate)}</span></div><div className="grid min-h-8 grid-cols-[minmax(4.5rem,0.8fr)_6rem_minmax(5.5rem,1fr)] items-center gap-1 rounded border border-primary/30 bg-primary/[0.06] px-2 font-semibold"><span className="col-span-2 text-sm">{t("total")}</span><span className="text-right text-sm tabular-nums">{formatter.format(calculation.totals.countedCash)} Lek</span></div></div></CardContent></Card>;

  const dailyActivityCard = <Card><CardHeader className="p-2.5 pb-1.5"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="flex items-center gap-1.5 text-sm"><CircleGauge className="h-3.5 w-3.5" />{t("dailyActivity")}</CardTitle><div className="text-right"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("dailyIncrease")}</p><p className="text-xs font-semibold">{percentFormatter.format(calculation.totals.performanceScore)}</p></div></div></CardHeader><CardContent className="p-2.5 pt-0"><div className="grid gap-1">{metrics.map(metric => <div key={metric} className="grid grid-cols-[minmax(0,1fr)_4rem_3.5rem] items-center gap-1 rounded border px-2 py-0.5"><div className="min-w-0"><p className="truncate text-xs font-medium leading-tight" title={metricLabel(metric)}>{metricLabel(metric)}</p><p className="truncate text-[10px] leading-tight text-muted-foreground">{t("targetAndWeight", { target: formatter.format(targets?.[metric] ?? 0), weight: percentFormatter.format(calculation.metricWeights[metric] ?? 0) })}</p></div><Input aria-label={`${metricLabel(metric)} ${t("quantity")}`} type="number" min={0} step="any" disabled={isReadOnly} className="h-7 px-1.5 text-right text-sm tabular-nums" value={activities[metric] ?? 0} onChange={event => setActivities(current => ({ ...current, [metric]: numericValue(event.target.value) }))} /><span className="text-right text-xs font-medium tabular-nums">{percentFormatter.format(calculation.totals.activityContributions[metric] ?? 0)}</span></div>)}</div></CardContent></Card>;

  return <div className="flex h-full flex-col">
    <Header title={`${view === "daily" ? t("pageTitle") : view === "debts" ? debtTranslations("title") : view === "unsubscribes" ? unsubscribeTranslations("title") : view === "cell" ? cellTranslations("title") : monthlyTranslations("title")}: ${selectedShop.name}`} actions={
      view === "daily"
        ? <Input aria-label={t("date")} type="date" className="h-9 w-32 sm:w-40" value={date} onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setDate(event.target.value); }} />
        : <Input aria-label={monthlyTranslations("month")} type="month" className="h-9 w-32 sm:w-44" value={month} onChange={event => { if (closingMonthSchema.safeParse(event.target.value).success) setMonth(event.target.value); }} />
    } />
    <main className="flex-1 overflow-y-auto p-2 md:p-3">
      <div className="mx-auto w-full max-w-[1500px] space-y-2.5">
        <div className="flex gap-2" role="group" aria-label={monthlyTranslations("view")}>
          <Button size="sm" variant={view === "daily" ? "default" : "outline"} aria-pressed={view === "daily"} onClick={() => setView("daily")}><CalendarDays className="mr-1.5 h-4 w-4" />{monthlyTranslations("daily")}</Button>
          <Button size="sm" variant={view === "monthly" ? "default" : "outline"} aria-pressed={view === "monthly"} onClick={() => { if (view === "daily") setMonth(date.slice(0, 7)); setView("monthly"); }}><CalendarRange className="mr-1.5 h-4 w-4" />{monthlyTranslations("monthly")}</Button>
          <Button size="sm" variant={view === "debts" ? "default" : "outline"} aria-pressed={view === "debts"} onClick={() => { if (view === "daily") setMonth(date.slice(0, 7)); setView("debts"); }}><Wallet className="mr-1.5 h-4 w-4" />{debtTranslations("title")}</Button>
          <Button size="sm" variant={view === "unsubscribes" ? "default" : "outline"} aria-pressed={view === "unsubscribes"} onClick={() => { if (view === "daily") setMonth(date.slice(0, 7)); setView("unsubscribes"); }}><UserMinus className="mr-1.5 h-4 w-4" />{unsubscribeTranslations("title")}</Button>
          <Button size="sm" variant={view === "cell" ? "default" : "outline"} aria-pressed={view === "cell"} onClick={() => { if (view === "daily") setMonth(date.slice(0, 7)); setView("cell"); }}><Smartphone className="mr-1.5 h-4 w-4" />{cellTranslations("tab")}</Button>
        </div>
        {view === "monthly" && <MonthlyClosingSummary shopId={selectedShop.id} month={month} />}
        {view === "debts" && <MonthlyDebts canEdit={actor.role !== "viewer"} onUpdated={() => setDebtRevision(current => current + 1)} key={`${selectedShop.id}:${month}`} shopId={selectedShop.id} month={month} onOpenReport={reportDate => { setDate(reportDate); setView("daily"); }} />}
        {view === "unsubscribes" && <MonthlyUnsubscribes key={`${selectedShop.id}:${month}`} shopId={selectedShop.id} month={month} onOpenReport={reportDate => { setDate(reportDate); setView("daily"); }} />}
        {view === "cell" && <MonthlyCellSummary shopId={selectedShop.id} shopName={selectedShop.name} month={month} onOpenReport={reportDate => { setDate(reportDate); setView("daily"); }} />}
        <div hidden={view !== "daily"} className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold leading-tight md:text-xl">{t("heading")}</h2>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="h-8" disabled={loading} onClick={() => setIsSummaryOpen(true)}><ClipboardCopy className="mr-1.5 h-4 w-4" />{t("generateSummary")}</Button>
            <Button type="button" size="sm" variant="outline" className="h-8" disabled={loading || submitting !== null} onClick={() => setDebtRevision(current => current + 1)}><RefreshCw className="mr-1.5 h-4 w-4" />{t("refresh")}</Button>
            {!isFinalized && actor.role !== "viewer" && <Badge variant="outline" className={cn("gap-1.5", autosaveStatus === "error" && "border-destructive/50 text-destructive", autosaveStatus === "saved" && "border-emerald-500/50 text-emerald-700 dark:text-emerald-300")}>
              {autosaveStatus === "saving" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : autosaveStatus === "error" ? <CircleAlert className="h-3.5 w-3.5" /> : autosaveStatus === "saved" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
              {autosaveStatus === "pending" ? "Autosaving in 10 seconds" : autosaveStatus === "saving" ? "Autosaving" : autosaveStatus === "saved" ? "Autosaved" : autosaveStatus === "error" ? "Autosave failed" : "Autosave ready"}
            </Badge>}
            <Badge variant={isFinalized ? "default" : "secondary"} className="gap-1.5"><LockKeyhole className="h-3.5 w-3.5" />{t(isFinalized ? "statusFinalized" : "statusDraft")}</Badge>
          </div>
        </div>

        {isFinalized && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{t("lockedMessage")}</span>{actor.role === "admin" && <Button size="sm" variant="outline" className="h-7" disabled={submitting !== null} onClick={() => void reopen()}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />{submitting === "reopen" ? t("reopening") : t("reopen")}</Button>}</div>}

        {loading ? <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">{t("loading")}</div> : <>
          <div className="grid items-start gap-2.5 xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,1fr)]">
            <div className="min-w-0 space-y-2.5">
              <div className="grid items-start gap-2.5 md:grid-cols-[minmax(15rem,0.5fr)_minmax(18rem,0.65fr)]">
                <div className="space-y-2.5">
                {dailyActivityCard}

                <Card><CardHeader className="px-3 py-2"><CardTitle className="flex items-center gap-1.5 text-sm"><Smartphone className="h-3.5 w-3.5" />{t("cell")}</CardTitle></CardHeader><CardContent className="space-y-2 px-3 pb-3 pt-0">
                  <div className="grid grid-cols-[1fr_9.5rem] items-center gap-3"><Label className="text-sm font-medium" htmlFor="cell-amount">{t("cellAmount")}</Label><div className="relative"><Input id="cell-amount" aria-label={t("cellAmount")} type="number" min={0} step={1} disabled={isCellReadOnly} className={primaryAmountInputClassName} value={cell.amount} onChange={event => setCell(current => ({ ...current, amount: numericValue(event.target.value) }))} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">Lek</span></div></div>
                  <div className="space-y-1"><Label className="text-sm" htmlFor="cell-note">{t("cellNote")}</Label><Input id="cell-note" aria-label={t("cellNote")} maxLength={500} disabled={isCellReadOnly} className="h-8" placeholder={t("cellNotePlaceholder")} value={cell.note} onChange={event => setCell(current => ({ ...current, note: event.target.value }))} /></div>
                </CardContent></Card>
                </div>

                <div className="space-y-2.5">
                  <Card><CardContent className="space-y-1.5 p-2.5">
                {(["boss", "invoice"] as const).map(key => <div key={key} className="grid grid-cols-[1fr_8.5rem] items-center gap-2"><Label className="text-sm font-medium" htmlFor={`adjustment-${key}`}>{t(key)}</Label><div className="relative"><Input id={`adjustment-${key}`} type="number" min={0} step={1} disabled={isReadOnly} className={primaryAmountInputClassName} value={adjustments[key]} onChange={event => setAdjustments(current => ({ ...current, [key]: numericValue(event.target.value) }))} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">Lek</span></div></div>)}
                <div className="grid grid-cols-2 gap-1.5 border-t pt-1.5 text-xs sm:grid-cols-4"><div><span className="block text-muted-foreground">{t("debtTotal")}</span><strong>{formatter.format(calculation.totals.debtTotal)} Lek</strong></div><div><span className="block text-muted-foreground">{t("unsubscribe")}</span><strong>{formatter.format(unsubscribeTotal)} Lek</strong></div><div><span className="block text-muted-foreground">{t("expectedCash")}</span><strong>{formatter.format(calculation.totals.expectedCash)} Lek</strong></div><div className={cn("rounded px-1.5 py-0.5", differenceColor)}><span className="block">{t("difference")}</span><strong>{formatter.format(calculation.totals.difference)} Lek</strong></div></div>
                  </CardContent></Card>

                  {cashCountCard}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{summaryCards.map(card => <Card key={card.label} className={card.className}><CardContent className="flex items-center justify-between gap-2 p-3"><div className="min-w-0"><p className={cn("truncate text-xs font-medium", card.className ? "text-current opacity-80" : "text-muted-foreground")}>{card.label}</p><p className="truncate text-lg font-bold tabular-nums">{card.value}</p></div><card.icon className={cn("h-4 w-4 shrink-0", card.className ? "text-current" : "text-muted-foreground")} /></CardContent></Card>)}</div>
            </div>

            <div className="space-y-2.5">
              {unsubscribeEntriesCard}
              {debtEntriesCard}
            </div>

          </div>

          {actor.role !== "viewer" && !isFinalized && <div className="sticky bottom-2 flex justify-end gap-2 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur"><Button size="sm" variant="outline" disabled={submitting !== null} onClick={() => void save()}><Save className="mr-1.5 h-4 w-4" />{submitting === "save" ? t("saving") : t("saveDraft")}</Button><AlertDialog><AlertDialogTrigger asChild><Button size="sm" disabled={submitting !== null}><CheckCircle2 className="mr-1.5 h-4 w-4" />{t("finalize")}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("finalizeTitle")}</AlertDialogTitle><AlertDialogDescription>{t("finalizeDescription")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void finalize()}>{submitting === "finalize" ? t("finalizing") : t("confirmFinalize")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>}
        </>}
        </div>
        <Dialog open={isSummaryOpen} onOpenChange={setIsSummaryOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("summaryTitle")}</DialogTitle>
              <DialogDescription>{t("summaryDescription")}</DialogDescription>
            </DialogHeader>
            <Textarea aria-label={t("summaryTitle")} readOnly value={dailySummary} className="min-h-72 resize-none font-mono text-sm leading-6" />
            <DialogFooter>
              <Button type="button" onClick={() => void copyDailySummary()}><ClipboardCopy className="mr-1.5 h-4 w-4" />{t("copySummary")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  </div>;
}
