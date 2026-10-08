"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  CircleAlert,
  Clock3,
  LockKeyhole,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";

import { fetchDailyClosing, handleFinalizeDailyClosing, handleReopenDailyClosing, handleSaveDailyClosing } from "@/app/actions/daily-closing";
import { Header } from "@/components/header";
import { ShopPageToolbar } from "@/components/shop-page-toolbar";
import { AttendanceEditor } from "@/components/attendance-editor";
import { ProcedureEntry } from "@/components/procedure-entry";
import { attendanceQueryKey } from "@/lib/attendance";
import { RestrictedAccessDialog } from "@/components/restricted-access";
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
import { useRestrictedAccess } from "@/hooks/use-restricted-access";
import { calculateDailyClosing, CASH_DENOMINATIONS, createDailyClosingSummary, createEmptyCashCounts, DEFAULT_EXCHANGE_RATE, EURO_DENOMINATION_KEY, getDailyClosingMetricConfig } from "@/lib/daily-closing";
import { getClosingView, type ClosingView } from "@/lib/closing-navigation";
import { getCustomMetricLabel } from "@/lib/metric-definitions";
import { type DailyClosing, type DailyClosingDebt, type DailyClosingUnsubscribeEntry, type PerformanceMetric } from "@/lib/types";
import { cn } from "@/lib/utils";

function MonthlyViewLoading() {
  return <div className="min-h-64 animate-pulse rounded-lg border bg-muted/30" aria-hidden="true" />;
}

const MonthlyClosingSummary = dynamic(() => import("@/components/monthly-closing-summary").then(module => module.MonthlyClosingSummary), { loading: MonthlyViewLoading });
const MonthlyCellSummary = dynamic(() => import("@/components/monthly-cell-summary").then(module => module.MonthlyCellSummary), { loading: MonthlyViewLoading });
const MonthlyDebts = dynamic(() => import("@/components/monthly-debts").then(module => module.MonthlyDebts), { loading: MonthlyViewLoading });
const MonthlyUnsubscribes = dynamic(() => import("@/components/monthly-unsubscribes").then(module => module.MonthlyUnsubscribes), { loading: MonthlyViewLoading });

type Adjustments = { boss: number; invoice: number; unsubscribe: number };
type AutosaveStatus = "ready" | "pending" | "saving" | "saved" | "error";
const EMPTY_ADJUSTMENTS: Adjustments = { boss: 0, invoice: 0, unsubscribe: 0 };

const closingToolbarItemClassName = "h-9 gap-1.5 rounded-md px-3 py-0 text-xs font-medium whitespace-nowrap shadow-none";
const primaryAmountInputClassName = "h-9 border-primary/40 bg-primary/[0.06] px-2 text-right text-base font-semibold tabular-nums shadow-sm focus-visible:ring-primary/40 dark:bg-primary/10";

function numericValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function DailyClosingClient() {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const monthlyTranslations = useTranslations("MonthlyClosing");
  const debtTranslations = useTranslations("MonthlyDebts");
  const unsubscribeTranslations = useTranslations("MonthlyUnsubscribes");
  const cellTranslations = useTranslations("MonthlyCell");
  const queryClient = useQueryClient();
  const accessQuery = useRestrictedAccess();
  const requestedView = getClosingView(searchParams.get("view"));
  const hasRestrictedAccess = accessQuery.data === true;
  const accessChecked = !accessQuery.isPending;
  const [isAccessDialogOpen, setIsAccessDialogOpen] = useState(false);
  const previousViewRef = useRef<ClosingView>("daily");
  const view = requestedView === "daily" || hasRestrictedAccess ? requestedView : "daily";
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const t = useTranslations("DailyClosing");
  const attendanceTranslations = useTranslations("Attendance");
  const [attendanceDirty, setAttendanceDirty] = useState(false);
  const [procedureDirty, setProcedureDirty] = useState(false);
  const [attendanceMinimized, setAttendanceMinimized] = useState(true);
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
  const [autosaveAttempt, setAutosaveAttempt] = useState(0);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const autosaveBaselineRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const activeScopeRef = useRef("");
  const shopId = selectedShop?.id ?? "";
  const closingPath = `/${locale}/shop/${shopId}/closing`;
  const activeScope = `${shopId}:${date}`;
  activeScopeRef.current = activeScope;

  useEffect(() => {
    if (requestedView !== "daily" && previousViewRef.current === "daily") setMonth(date.slice(0, 7));
    previousViewRef.current = requestedView;
  }, [requestedView, date]);

  useEffect(() => {
    if (requestedView === "daily" || hasRestrictedAccess) setIsAccessDialogOpen(false);
    else if (accessChecked) setIsAccessDialogOpen(true);
  }, [accessChecked, requestedView, hasRestrictedAccess]);

  const handleAccessDialogChange = (open: boolean) => {
    setIsAccessDialogOpen(open);
    if (!open && !hasRestrictedAccess) router.replace(closingPath);
  };

  const handleRestrictedAccessGranted = useCallback(() => {
    setIsAccessDialogOpen(false);
  }, []);

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
    let loaded = false;
    void fetchDailyClosing(selectedShop.id, date).then(data => {
      if (!active) return;
      loaded = true;
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
        setAutosaveReady(loaded);
      }
    });
    return () => { active = false; };
  }, [selectedShop, date, t, toast, debtRevision]);

  const isFinalized = closing?.status === "finalized";
  const isReadOnly = isFinalized || actor.role === "viewer";
  const isCellReadOnly = isFinalized || actor.role !== "admin";
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const percentFormatter = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const saveInput = useMemo(() => ({
    shopId,
    date,
    expectedUpdatedAt: closing?.updatedAt ?? null,
    cashCounts,
    exchangeRate,
    cell,
    adjustments: effectiveAdjustments,
    debts: debts.filter(debt => debt.description.trim() || debt.amount > 0),
    unsubscribeEntries: unsubscribeEntries.filter(entry => entry.invoice.trim() || entry.msisdn.trim() || entry.amount > 0),
    activities: Object.fromEntries(metrics.map(metric => [metric, activities[metric] ?? 0])),
  }), [shopId, date, closing?.updatedAt, cashCounts, exchangeRate, cell, effectiveAdjustments, debts, unsubscribeEntries, metrics, activities]);

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

  const applySavedClosing = useCallback((data: DailyClosing, savedShopId: string) => {
    const savedMonth = data.date.slice(0, 7);
    void queryClient.invalidateQueries({ queryKey: attendanceQueryKey(savedShopId, savedMonth) });
    void queryClient.invalidateQueries({ queryKey: monthlyClosingQueryKey(savedShopId, savedMonth) });
    void queryClient.invalidateQueries({ queryKey: monthlyDebtsQueryKey(savedShopId, savedMonth) });
    void queryClient.invalidateQueries({ queryKey: monthlyUnsubscribesQueryKey(savedShopId, savedMonth) });
    void queryClient.invalidateQueries({ queryKey: monthlyCellQueryKey(savedShopId, savedMonth) });
    if (activeScopeRef.current !== `${savedShopId}:${data.date}`) return;
    setClosing(data);
    setCashCounts(data.cashCounts);
    setExchangeRate(data.exchangeRate);
    setCell(data.cell);
    setAdjustments(data.adjustments);
    setDebts(data.debts);
    setUnsubscribeEntries(data.unsubscribeEntries ?? []);
    setActivities(data.activities);
  }, [queryClient]);

  const saveDraft = useCallback(async (input: typeof saveInput, snapshot: string, notify: boolean) => {
    if (saveInFlightRef.current) return;
    const requestScope = `${input.shopId}:${input.date}`;
    let retry = false;
    saveInFlightRef.current = true;
    setAutosaveStatus("saving");
    setSubmitting("save");
    try {
      const result = await handleSaveDailyClosing(input);
      if (!result.success) {
        if (activeScopeRef.current === requestScope) {
          setAutosaveStatus("error");
          toast({ variant: "destructive", title: t("saveFailed"), description: result.error });
          retry = !notify;
        }
        return;
      }
      if (activeScopeRef.current === requestScope) {
        autosaveBaselineRef.current = snapshot;
        setAutosaveStatus("saved");
        applySavedClosing(result.data, input.shopId);
        if (notify) toast({ title: t("saved"), description: t("savedDescription") });
      }
    } finally {
      saveInFlightRef.current = false;
      setSubmitting(null);
      if (retry && activeScopeRef.current === requestScope) setAutosaveAttempt(attempt => attempt + 1);
    }
  }, [applySavedClosing, t, toast]);

  const save = async () => {
    await saveDraft(saveInput, autosaveSnapshot, true);
  };

  const finalize = async () => {
    if (attendanceDirty || procedureDirty) return;
    if (saveInFlightRef.current) return;
    const requestScope = activeScope;
    saveInFlightRef.current = true;
    setSubmitting("finalize");
    const result = await handleFinalizeDailyClosing(saveInput).finally(() => {
      saveInFlightRef.current = false;
      setSubmitting(null);
    });
    if (!result.success) return toast({ variant: "destructive", title: t("finalizeFailed"), description: result.error });
    applySavedClosing(result.data, saveInput.shopId);
    if (activeScopeRef.current === requestScope) toast({ title: t("finalized"), description: t("finalizedDescription") });
  };

  const reopen = async () => {
    if (saveInFlightRef.current) return;
    const requestScope = activeScope;
    saveInFlightRef.current = true;
    setSubmitting("reopen");
    const result = await handleReopenDailyClosing(shopId, date).finally(() => {
      saveInFlightRef.current = false;
      setSubmitting(null);
    });
    if (!result.success) return toast({ variant: "destructive", title: t("reopenFailed"), description: result.error });
    applySavedClosing(result.data, shopId);
    if (activeScopeRef.current === requestScope) toast({ title: t("reopened"), description: t("reopenedDescription") });
  };

  useEffect(() => {
    if (!selectedShop || !autosaveReady || loading || isFinalized || actor.role === "viewer" || saveInFlightRef.current) return;

    if (autosaveBaselineRef.current === null) {
      autosaveBaselineRef.current = autosaveSnapshot;
      setAutosaveStatus("ready");
      return;
    }
    if (autosaveBaselineRef.current === autosaveSnapshot) return;

    setAutosaveStatus("pending");
    const timer = window.setTimeout(() => {
      void saveDraft(saveInput, autosaveSnapshot, false);
    }, 10_000);

    return () => window.clearTimeout(timer);
  }, [actor.role, autosaveAttempt, autosaveReady, autosaveSnapshot, isFinalized, loading, saveDraft, saveInput, selectedShop]);

  if (!selectedShop) return null;

  const metricLabel = (metric: PerformanceMetric) => metric.startsWith("custom_")
    ? getCustomMetricLabel(metric, metricSettings)
    : metricTranslations(metric as Parameters<typeof metricTranslations>[0]);

  const differenceColor = calculation.totals.difference > 0
    ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : calculation.totals.difference < 0
      ? "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-300"
      : "";

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

  const dailyActivityCard = <Card><CardHeader className="p-2.5 pb-1.5"><div className="flex flex-wrap items-center justify-end gap-2"><div className="text-right"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("dailyIncrease")}</p><p className="text-xs font-semibold">{percentFormatter.format(calculation.totals.performanceScore)}</p></div></div></CardHeader><CardContent className="p-2.5 pt-0"><div className="grid gap-1">{metrics.map(metric => <div key={metric} className="grid grid-cols-[minmax(0,1fr)_4rem_3.5rem] items-center gap-1 rounded border px-2 py-0.5"><div className="min-w-0"><p className="truncate text-xs font-medium leading-tight" title={metricLabel(metric)}>{metricLabel(metric)}</p><p className="truncate text-[10px] leading-tight text-muted-foreground">{t("targetAndWeight", { target: formatter.format(targets?.[metric] ?? 0), weight: percentFormatter.format(calculation.metricWeights[metric] ?? 0) })}</p></div><Input aria-label={`${metricLabel(metric)} ${t("quantity")}`} type="number" min={0} step="any" disabled={isReadOnly} className="h-7 px-1.5 text-right text-sm tabular-nums" value={activities[metric] ?? 0} onChange={event => setActivities(current => ({ ...current, [metric]: numericValue(event.target.value) }))} /><span className="text-right text-xs font-medium tabular-nums">{percentFormatter.format(calculation.totals.activityContributions[metric] ?? 0)}</span></div>)}</div></CardContent></Card>;

  const monthSelector = <Input aria-label={monthlyTranslations("month")} type="month" className="h-9 w-full" value={month} onChange={event => { if (closingMonthSchema.safeParse(event.target.value).success) setMonth(event.target.value); }} />;

  return <div className="flex h-full flex-col">
    <Header title={view === "daily" ? selectedShop.name : `${view === "debts" ? debtTranslations("title") : view === "unsubscribes" ? unsubscribeTranslations("title") : view === "cell" ? cellTranslations("title") : monthlyTranslations("title")}: ${selectedShop.name}`} />
    <main className="shop-page-content flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1500px] space-y-2.5">
        {view === "monthly" && <MonthlyClosingSummary shopId={selectedShop.id} month={month} periodSelector={monthSelector} />}
        {view === "debts" && <MonthlyDebts canEdit={actor.role !== "viewer"} onUpdated={() => setDebtRevision(current => current + 1)} key={`${selectedShop.id}:${month}`} shopId={selectedShop.id} month={month} periodSelector={monthSelector} onOpenReport={reportDate => { setDate(reportDate); router.push(closingPath); }} />}
        {view === "unsubscribes" && <MonthlyUnsubscribes key={`${selectedShop.id}:${month}`} shopId={selectedShop.id} month={month} periodSelector={monthSelector} onOpenReport={reportDate => { setDate(reportDate); router.push(closingPath); }} />}
        {view === "cell" && <MonthlyCellSummary shopId={selectedShop.id} shopName={selectedShop.name} month={month} periodSelector={monthSelector} onOpenReport={reportDate => { setDate(reportDate); router.push(closingPath); }} />}
        <div hidden={view !== "daily"} className="space-y-2.5">
        <ShopPageToolbar periodSelector={<Input aria-label={t("date")} type="date" disabled={attendanceDirty || procedureDirty} className="h-9 w-full" value={date} onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setDate(event.target.value); }} />}>
            <Button type="button" size="sm" variant="outline" className={closingToolbarItemClassName} disabled={loading} onClick={() => setIsSummaryOpen(true)}><ClipboardCopy className="h-4 w-4" />{t("generateSummary")}</Button>
            <Button type="button" size="sm" variant="outline" className={closingToolbarItemClassName} disabled={loading || submitting !== null} onClick={() => setDebtRevision(current => current + 1)}><RefreshCw className="h-4 w-4" />{t("refresh")}</Button>
            {!isFinalized && actor.role !== "viewer" && <Badge variant="outline" role="status" aria-live="polite" className={cn(closingToolbarItemClassName, "bg-background", autosaveStatus === "error" && "border-destructive/50 text-destructive", autosaveStatus === "saved" && "border-emerald-500/50 text-emerald-700 dark:text-emerald-300")}>
              {autosaveStatus === "saving" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : autosaveStatus === "error" ? <CircleAlert className="h-3.5 w-3.5" /> : autosaveStatus === "saved" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
              {autosaveStatus === "pending" ? "Autosaving in 10 seconds" : autosaveStatus === "saving" ? "Autosaving" : autosaveStatus === "saved" ? "Autosaved" : autosaveStatus === "error" ? "Autosave failed" : "Autosave ready"}
            </Badge>}
            <Badge variant="outline" className={cn(closingToolbarItemClassName, isFinalized ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200")}><LockKeyhole className="h-4 w-4" />{t(isFinalized ? "statusFinalized" : "statusDraft")}</Badge>
        </ShopPageToolbar>

        {isFinalized && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{t("lockedMessage")}</span>{actor.role === "admin" && <Button size="sm" variant="outline" className="h-7" disabled={submitting !== null} onClick={() => void reopen()}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />{submitting === "reopen" ? t("reopening") : t("reopen")}</Button>}</div>}

        {loading ? <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">{t("loading")}</div> : <>
          <div className="grid items-start gap-2.5 xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,1fr)]">
            <div className="min-w-0 space-y-2.5">
              <div className="grid items-start gap-2.5 md:grid-cols-[minmax(15rem,0.5fr)_minmax(18rem,0.65fr)]">
                <div className="space-y-2.5">
                {dailyActivityCard}

                <Card><CardContent className="grid grid-cols-2 items-center gap-2 p-2">
                  <div className="relative min-w-0"><Input id="cell-amount" aria-label={t("cellAmount")} type="number" min={0} step={1} disabled={isReadOnly} className={cn(primaryAmountInputClassName, "h-8 min-w-0 px-2 text-sm")} value={cell.amount} onChange={event => setCell(current => ({ ...current, amount: numericValue(event.target.value) }))} /></div>
                  <Input id="cell-note" aria-label={t("cellNote")} maxLength={500} disabled={isCellReadOnly} className="h-8 min-w-0 px-2 text-xs" placeholder={t("cellNotePlaceholder")} value={cell.note} onChange={event => setCell(current => ({ ...current, note: event.target.value }))} />
                </CardContent></Card>
                </div>

                <div className="space-y-2.5">
                  <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-stretch gap-2">
                  <Card className="min-w-0"><CardContent className="space-y-1.5 p-2">
                {(["boss", "invoice"] as const).map(key => <div key={key} className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-2"><Label className="text-sm font-medium" htmlFor={`adjustment-${key}`}>{t(key)}</Label><div className="relative"><Input id={`adjustment-${key}`} type="number" min={0} step={1} disabled={isReadOnly} className={primaryAmountInputClassName} value={adjustments[key]} onChange={event => setAdjustments(current => ({ ...current, [key]: numericValue(event.target.value) }))} /></div></div>)}
                </CardContent></Card>
                  <Card className="min-w-0"><CardContent className="grid h-full grid-cols-2 content-center gap-x-2 gap-y-1.5 p-2 text-[10px]">
                    {[{ label: t("debtTotal"), amount: calculation.totals.debtTotal }, { label: t("unsubscribe"), amount: unsubscribeTotal }, { label: t("difference"), amount: calculation.totals.difference, difference: true }].map(item => <div key={item.label} className={cn("min-w-0", item.difference && cn("col-span-2 rounded px-1.5 py-0.5", differenceColor))}><span className="block text-muted-foreground">{item.label}</span><div className="flex flex-wrap items-baseline gap-x-1"><strong className="text-base font-semibold leading-tight tabular-nums">{formatter.format(item.amount)}</strong><span className="text-[10px] font-normal text-muted-foreground">Lek</span></div></div>)}
                  </CardContent></Card>
                  </div>

                  {cashCountCard}
                </div>
              </div>

            </div>

            <div className="space-y-2.5">
          <Card className="relative w-full max-w-[37rem]">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2"><CardTitle className="text-sm">{attendanceTranslations("presenceTitle")}</CardTitle></div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
              <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={attendanceTranslations(attendanceMinimized ? "expand" : "minimize")} title={attendanceTranslations(attendanceMinimized ? "expand" : "minimize")} aria-expanded={!attendanceMinimized} aria-controls="daily-attendance" onClick={() => setAttendanceMinimized(current => !current)}>
                {attendanceMinimized ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </Button>
              </div>
            </CardHeader>
            <CardContent id="daily-attendance" hidden={attendanceMinimized} className="px-3 pb-3 pt-0">
              <AttendanceEditor key={activeScope} shopId={shopId} month={date.slice(0, 7)} date={date} canEdit={actor.role !== "viewer"} onDirtyChange={setAttendanceDirty} />
            </CardContent>
            {attendanceDirty && <p className="px-3 pb-3 text-xs text-amber-700 dark:text-amber-300">{attendanceTranslations("saveBeforeFinalize")}</p>}
          </Card>

              <ProcedureEntry key={activeScope} shopId={shopId} date={date} disabled={isReadOnly || submitting !== null} onDirtyChange={setProcedureDirty} />
              {unsubscribeEntriesCard}
              {debtEntriesCard}
            </div>

          </div>



          {actor.role !== "viewer" && !isFinalized && <div className="sticky bottom-2 flex justify-end gap-2 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur"><Button size="sm" variant="outline" disabled={submitting !== null} onClick={() => void save()}><Save className="mr-1.5 h-4 w-4" />{submitting === "save" ? t("saving") : t("saveDraft")}</Button><AlertDialog><AlertDialogTrigger asChild><Button size="sm" disabled={submitting !== null || attendanceDirty || procedureDirty}><CheckCircle2 className="mr-1.5 h-4 w-4" />{t("finalize")}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("finalizeTitle")}</AlertDialogTitle><AlertDialogDescription>{t("finalizeDescription")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void finalize()}>{submitting === "finalize" ? t("finalizing") : t("confirmFinalize")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>}
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
        <RestrictedAccessDialog open={isAccessDialogOpen} onOpenChange={handleAccessDialogChange} onGranted={handleRestrictedAccessGranted} />
      </div>
    </main>
  </div>;
}
