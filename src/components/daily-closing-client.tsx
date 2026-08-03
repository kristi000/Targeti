"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  CircleGauge,
  HandCoins,
  LockKeyhole,
  Plus,
  ReceiptText,
  RotateCcw,
  Save,
  Scale,
  Trash2,
} from "lucide-react";

import { fetchDailyClosing, handleFinalizeDailyClosing, handleReopenDailyClosing, handleSaveDailyClosing } from "@/app/actions";
import { Header } from "@/components/header";
import { ShopPageNav } from "@/components/shop-page-nav";
import { useShop } from "@/components/shop-provider";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { calculateDailyClosing, CASH_DENOMINATIONS, createEmptyCashCounts, DEFAULT_EXCHANGE_RATE, EURO_DENOMINATION_KEY, getDailyClosingMetricConfig } from "@/lib/daily-closing";
import { getCustomMetricLabel } from "@/lib/metric-definitions";
import { type DailyClosing, type DailyClosingDebt, type DailyClosingUnsubscribeEntry, type PerformanceMetric } from "@/lib/types";
import { cn } from "@/lib/utils";

type Adjustments = { boss: number; invoice: number; unsubscribe: number };

const EMPTY_ADJUSTMENTS: Adjustments = { boss: 0, invoice: 0, unsubscribe: 0 };

function numericValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function DailyClosingClient() {
  const locale = useLocale();
  const t = useTranslations("DailyClosing");
  const metricTranslations = useTranslations("Metrics");
  const { toast } = useToast();
  const { selectedShop, actor } = useShop();
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [closing, setClosing] = useState<DailyClosing | null>(null);
  const [cashCounts, setCashCounts] = useState<Record<string, number>>(() => createEmptyCashCounts());
  const [exchangeRate, setExchangeRate] = useState(DEFAULT_EXCHANGE_RATE);
  const [adjustments, setAdjustments] = useState<Adjustments>(EMPTY_ADJUSTMENTS);
  const [debts, setDebts] = useState<DailyClosingDebt[]>([]);
  const [unsubscribeEntries, setUnsubscribeEntries] = useState<DailyClosingUnsubscribeEntry[]>([]);
  const [activities, setActivities] = useState<Partial<Record<PerformanceMetric, number>>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<"save" | "finalize" | "reopen" | null>(null);

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
    void fetchDailyClosing(selectedShop.id, date).then(data => {
      if (!active) return;
      setClosing(data);
      setCashCounts(data?.cashCounts ?? createEmptyCashCounts());
      setExchangeRate(data?.exchangeRate ?? DEFAULT_EXCHANGE_RATE);
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
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [selectedShop?.id, date, t, toast]);

  if (!selectedShop) return null;

  const isFinalized = closing?.status === "finalized";
  const isReadOnly = isFinalized || actor.role === "viewer";
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const percentFormatter = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const payload = () => ({
    shopId: selectedShop.id,
    date,
    cashCounts,
    exchangeRate,
    adjustments: effectiveAdjustments,
    debts: debts.filter(debt => debt.description.trim() || debt.amount > 0),
    unsubscribeEntries: unsubscribeEntries.filter(entry => entry.invoice.trim() || entry.msisdn.trim() || entry.amount > 0),
    activities: Object.fromEntries(metrics.map(metric => [metric, activities[metric] ?? 0])),
  });

  const applySavedClosing = (data: DailyClosing) => {
    setClosing(data);
    setCashCounts(data.cashCounts);
    setExchangeRate(data.exchangeRate);
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
    const result = await handleReopenDailyClosing(selectedShop.id, date);
    setSubmitting(null);
    if (!result.success) return toast({ variant: "destructive", title: t("reopenFailed"), description: result.error });
    applySavedClosing(result.data);
    toast({ title: t("reopened"), description: t("reopenedDescription") });
  };

  const metricLabel = (metric: PerformanceMetric) => metric.startsWith("custom_")
    ? getCustomMetricLabel(metric, metricSettings)
    : metricTranslations(metric as Parameters<typeof metricTranslations>[0]);

  const summaryCards = [
    { label: t("countedCash"), value: `${formatter.format(calculation.totals.countedCash)} Lek`, icon: Banknote },
    { label: t("expectedCash"), value: `${formatter.format(calculation.totals.expectedCash)} Lek`, icon: HandCoins },
    { label: t("difference"), value: `${formatter.format(calculation.totals.difference)} Lek`, icon: Scale, alert: calculation.totals.difference !== 0 },
    { label: t("dailyIncrease"), value: percentFormatter.format(calculation.totals.performanceScore), icon: CircleGauge },
  ];

  return <div className="flex h-full flex-col">
    <Header title={`${t("pageTitle")}: ${selectedShop.name}`} actions={<>
      <Link href={`/${locale}/`} className={buttonVariants({ variant: "outline", size: "sm" })}><ArrowLeft className="mr-1.5 h-4 w-4" />{t("back")}</Link>
      <ShopPageNav shopId={selectedShop.id} active="closing" />
      <Input aria-label={t("date")} type="date" className="h-9 w-40" value={date} onChange={event => setDate(event.target.value)} />
    </>} />
    <main className="flex-1 overflow-y-auto p-2 md:p-3">
      <div className="mx-auto w-full max-w-[1500px] space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-lg font-semibold leading-tight md:text-xl">{t("heading")}</h2><p className="text-xs text-muted-foreground">{t("description")}</p></div>
          <Badge variant={isFinalized ? "default" : "secondary"} className="gap-1.5"><LockKeyhole className="h-3.5 w-3.5" />{t(isFinalized ? "statusFinalized" : "statusDraft")}</Badge>
        </div>

        {isFinalized && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{t("lockedMessage")}</span>{actor.role === "admin" && <Button size="sm" variant="outline" className="h-7" disabled={submitting !== null} onClick={() => void reopen()}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />{submitting === "reopen" ? t("reopening") : t("reopen")}</Button>}</div>}

        {loading ? <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">{t("loading")}</div> : <>
          <div className="grid items-start gap-2.5 xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,1fr)]">
            <div className="min-w-0 space-y-2.5">
              <div className="grid items-start gap-2.5 md:grid-cols-[minmax(17rem,0.65fr)_minmax(20rem,0.85fr)]">
                <Card><CardHeader className="px-3 py-2"><CardTitle className="flex items-center gap-1.5 text-sm"><Banknote className="h-3.5 w-3.5" />{t("cashCount")}</CardTitle><CardDescription className="text-[10px] leading-tight">{t("cashCountDescription")}</CardDescription></CardHeader><CardContent className="px-3 pb-2 pt-0">
              <div className="grid gap-0.5">
                {CASH_DENOMINATIONS.map(item => <div key={item.key} className="grid min-h-5 grid-cols-[minmax(4.5rem,0.8fr)_5.25rem_minmax(5.5rem,1fr)] items-center gap-1 rounded border px-2"><span className="text-xs font-medium tabular-nums">{item.label} Lek</span><Input aria-label={`${item.label} ${t("quantity")}`} type="number" min={0} step={1} disabled={isReadOnly} className="h-5 rounded px-1 text-center text-xs" value={cashCounts[item.key] ?? 0} onChange={event => setCashCounts(current => ({ ...current, [item.key]: Math.floor(numericValue(event.target.value)) }))} /><span className="text-right text-xs font-medium tabular-nums">{formatter.format(item.value * (cashCounts[item.key] ?? 0))}</span></div>)}
                <div className="grid min-h-5 grid-cols-[minmax(4.5rem,0.8fr)_5.25rem_minmax(5.5rem,1fr)] items-center gap-1 rounded border px-2"><div className="flex items-center gap-1"><span className="text-xs font-medium">EUR</span><Input aria-label={t("exchangeRate")} type="number" min={0.01} step={0.01} disabled={isReadOnly} className="h-5 w-12 rounded px-0.5 text-center text-[10px]" value={exchangeRate} onChange={event => setExchangeRate(numericValue(event.target.value))} /></div><Input aria-label={`EUR ${t("quantity")}`} type="number" min={0} step={1} disabled={isReadOnly} className="h-5 rounded px-1 text-center text-xs" value={cashCounts[EURO_DENOMINATION_KEY] ?? 0} onChange={event => setCashCounts(current => ({ ...current, [EURO_DENOMINATION_KEY]: Math.floor(numericValue(event.target.value)) }))} /><span className="text-right text-xs font-medium tabular-nums">{formatter.format((cashCounts[EURO_DENOMINATION_KEY] ?? 0) * exchangeRate)}</span></div>
              </div>
                </CardContent></Card>

                <div className="space-y-2.5">
                  <Card><CardHeader className="p-3 pb-2"><CardTitle className="flex items-center gap-2 text-base"><ReceiptText className="h-4 w-4" />{t("reconciliation")}</CardTitle><CardDescription className="text-xs">{t("reconciliationDescription")}</CardDescription></CardHeader><CardContent className="space-y-2 p-3 pt-0">
                {(["boss", "invoice"] as const).map(key => <div key={key} className="grid grid-cols-[1fr_8rem] items-center gap-2"><Label className="text-sm" htmlFor={`adjustment-${key}`}>{t(key)}</Label><Input id={`adjustment-${key}`} type="number" min={0} step={1} disabled={isReadOnly} className="h-8 text-right" value={adjustments[key]} onChange={event => setAdjustments(current => ({ ...current, [key]: numericValue(event.target.value) }))} /></div>)}
                <div className="grid grid-cols-2 gap-2 border-t pt-2 text-xs sm:grid-cols-4"><div><span className="block text-muted-foreground">{t("debtTotal")}</span><strong>{formatter.format(calculation.totals.debtTotal)} Lek</strong></div><div><span className="block text-muted-foreground">{t("unsubscribe")}</span><strong>{formatter.format(unsubscribeTotal)} Lek</strong></div><div><span className="block text-muted-foreground">{t("expectedCash")}</span><strong>{formatter.format(calculation.totals.expectedCash)} Lek</strong></div><div className={cn("rounded-md px-2 py-1", calculation.totals.difference === 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-200")}><span className="block">{t("difference")}</span><strong>{formatter.format(calculation.totals.difference)} Lek</strong></div></div>
                  </CardContent></Card>

                  <Card><CardHeader className="flex-row items-center justify-between space-y-0 p-3 pb-2"><div><CardTitle className="text-base">{t("unsubscribeEntries")}</CardTitle><CardDescription className="text-xs">{t("unsubscribeEntriesDescription")}</CardDescription></div><Button type="button" variant="outline" size="sm" className="h-7" disabled={isReadOnly} onClick={() => setUnsubscribeEntries(current => [...current, { id: crypto.randomUUID(), invoice: "", msisdn: "", amount: 0 }])}><Plus className="mr-1 h-3.5 w-3.5" />{t("addUnsubscribe")}</Button></CardHeader><CardContent className="max-h-32 space-y-1.5 overflow-y-auto p-3 pt-0">{unsubscribeEntries.length === 0 ? <p className="rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">{t("noUnsubscribeEntries")}</p> : unsubscribeEntries.map((entry, index) => <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_2rem] gap-1.5"><Input aria-label={t("unsubscribeInvoice", { number: index + 1 })} placeholder={t("invoicePlaceholder")} disabled={isReadOnly} className="h-8" value={entry.invoice} onChange={event => setUnsubscribeEntries(current => current.map(item => item.id === entry.id ? { ...item, invoice: event.target.value } : item))} /><Input aria-label={t("unsubscribeMsisdn", { number: index + 1 })} placeholder={t("msisdnPlaceholder")} disabled={isReadOnly} className="h-8" value={entry.msisdn} onChange={event => setUnsubscribeEntries(current => current.map(item => item.id === entry.id ? { ...item, msisdn: event.target.value } : item))} /><Input aria-label={t("unsubscribeAmount", { number: index + 1 })} type="number" min={0} step={1} disabled={isReadOnly} className="h-8 text-right" value={entry.amount} onChange={event => setUnsubscribeEntries(current => current.map(item => item.id === entry.id ? { ...item, amount: numericValue(event.target.value) } : item))} /><Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={isReadOnly} aria-label={t("removeUnsubscribe")} onClick={() => setUnsubscribeEntries(current => current.filter(item => item.id !== entry.id))}><Trash2 className="h-4 w-4" /></Button></div>)}</CardContent></Card>

                  <Card><CardHeader className="flex-row items-center justify-between space-y-0 p-3 pb-2"><div><CardTitle className="text-base">{t("debts")}</CardTitle><CardDescription className="text-xs">{t("debtsDescription")}</CardDescription></div><Button type="button" variant="outline" size="sm" className="h-7" disabled={isReadOnly} onClick={() => setDebts(current => [...current, { id: crypto.randomUUID(), description: "", amount: 0 }])}><Plus className="mr-1 h-3.5 w-3.5" />{t("addDebt")}</Button></CardHeader><CardContent className="max-h-32 space-y-1.5 overflow-y-auto p-3 pt-0">{debts.length === 0 ? <p className="rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">{t("noDebts")}</p> : debts.map((debt, index) => <div key={debt.id} className="grid grid-cols-[minmax(0,1fr)_7rem_2rem] gap-1.5"><Input aria-label={t("debtDescription", { number: index + 1 })} placeholder={t("debtPlaceholder")} disabled={isReadOnly} className="h-8" value={debt.description} onChange={event => setDebts(current => current.map(item => item.id === debt.id ? { ...item, description: event.target.value } : item))} /><Input aria-label={t("debtAmount", { number: index + 1 })} type="number" min={0} step={1} disabled={isReadOnly} className="h-8 text-right" value={debt.amount} onChange={event => setDebts(current => current.map(item => item.id === debt.id ? { ...item, amount: numericValue(event.target.value) } : item))} /><Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={isReadOnly} aria-label={t("removeDebt")} onClick={() => setDebts(current => current.filter(item => item.id !== debt.id))}><Trash2 className="h-4 w-4" /></Button></div>)}</CardContent></Card>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{summaryCards.map(card => <Card key={card.label} className={cn(card.alert && "border-amber-500/60 bg-amber-500/5")}><CardContent className="flex items-center justify-between gap-2 p-3"><div className="min-w-0"><p className="truncate text-xs font-medium text-muted-foreground">{card.label}</p><p className="truncate text-lg font-bold tabular-nums">{card.value}</p></div><card.icon className="h-4 w-4 shrink-0 text-muted-foreground" /></CardContent></Card>)}</div>
            </div>

            <Card><CardHeader className="p-3 pb-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle className="flex items-center gap-2 text-base"><CircleGauge className="h-4 w-4" />{t("dailyActivity")}</CardTitle><CardDescription className="text-xs">{t("dailyActivityDescription")}</CardDescription></div><div className="text-right"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("dailyIncrease")}</p><p className="text-sm font-semibold">{percentFormatter.format(calculation.totals.performanceScore)}</p></div></div></CardHeader><CardContent className="p-3 pt-0"><div className="grid gap-1.5">{metrics.map(metric => <div key={metric} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-1.5 rounded-md border px-2 py-1"><div className="min-w-0"><p className="truncate text-xs font-medium" title={metricLabel(metric)}>{metricLabel(metric)}</p><p className="text-[10px] text-muted-foreground">{t("targetAndWeight", { target: formatter.format(targets?.[metric] ?? 0), weight: percentFormatter.format(calculation.metricWeights[metric] ?? 0) })}</p></div><Input aria-label={`${metricLabel(metric)} ${t("quantity")}`} type="number" min={0} step="any" disabled={isReadOnly} className="h-7 px-2 text-right text-xs" value={activities[metric] ?? 0} onChange={event => setActivities(current => ({ ...current, [metric]: numericValue(event.target.value) }))} /><span className="text-right text-xs font-medium tabular-nums">{percentFormatter.format(calculation.totals.activityContributions[metric] ?? 0)}</span></div>)}</div></CardContent></Card>

          </div>

          {actor.role !== "viewer" && !isFinalized && <div className="sticky bottom-2 flex justify-end gap-2 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur"><Button size="sm" variant="outline" disabled={submitting !== null} onClick={() => void save()}><Save className="mr-1.5 h-4 w-4" />{submitting === "save" ? t("saving") : t("saveDraft")}</Button><AlertDialog><AlertDialogTrigger asChild><Button size="sm" disabled={submitting !== null}><CheckCircle2 className="mr-1.5 h-4 w-4" />{t("finalize")}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("finalizeTitle")}</AlertDialogTitle><AlertDialogDescription>{t("finalizeDescription")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void finalize()}>{submitting === "finalize" ? t("finalizing") : t("confirmFinalize")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>}
        </>}
      </div>
    </main>
  </div>;
}
