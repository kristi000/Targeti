"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Calculator, LoaderCircle, Pencil, RefreshCw, Save, X } from "lucide-react";
import { fetchDailyActivityMonth, saveDailyActivitySettings } from "@/app/actions/daily-activity";
import { Header } from "@/components/header";
import { DailyActivityProcedures } from "@/components/daily-activity-procedures";
import { ShopPageToolbar } from "@/components/shop-page-toolbar";
import { useShop } from "@/components/shop-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { monthDates } from "@/lib/attendance";
import { calculateDailyActivity, dailyActivityMonthQueryKey, dailyActivitySettingsFieldsSchema, dailyActivitySettingsQueryKey, getDailyActivityProcedureImpact, saveDailyActivitySettingsSchema, type DailyActivityMonth } from "@/lib/daily-activity";
import { getDailyClosingMetricConfig } from "@/lib/daily-closing";
import { METRIC_WEIGHTS } from "@/lib/data";
import { getCustomMetricLabel } from "@/lib/metric-definitions";
import { attendanceMonthSchema } from "@/lib/persistence-schemas";
import { formatReportingDate } from "@/lib/reporting-month";
import type { MetricSettings, MetricWeightProfile, PerformanceMetric, Target } from "@/lib/types";
import { cn } from "@/lib/utils";

type SettingsDraft = {
  expectedRevision: number;
  metricOrder: PerformanceMetric[];
  metricSettings: MetricSettings;
  targets: Partial<Record<PerformanceMetric, string>>;
  weights: Partial<Record<PerformanceMetric, string>>;
  weightProfileId?: string;
};

export function DailyActivityPage({ shopId, initialMonth }: { shopId: string; initialMonth: string }) {
  const t = useTranslations("DailyActivity");
  const metricTranslations = useTranslations("Metrics");
  const locale = useLocale();
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();
  const { shops, weightProfiles, actor, setSelectedShop, setSelectedDatasetId, setSelectedPerformanceId } = useShop();
  const shop = shops.find(item => item.id === shopId);
  const [month, setMonth] = useState(initialMonth);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"saveFailed" | "conflict" | "invalidData" | null>(null);
  const query = useQuery({
    queryKey: dailyActivityMonthQueryKey(shopId, month),
    queryFn: () => fetchDailyActivityMonth(shopId, month),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const settings = query.data?.settings;
  const procedures = query.data?.procedures ?? null;
  const procedureImpact = useMemo(() => getDailyActivityProcedureImpact(query.data?.actuals ?? {}, procedures), [query.data?.actuals, procedures]);
  const canEdit = actor.role !== "viewer";
  const editing = draft !== null;
  const baseline = useMemo(() => {
    const config = shop ? getDailyClosingMetricConfig(shop, `${month}-01`) : undefined;
    const metricOrder = [...new Set([
      ...(settings?.metricOrder ?? config?.metrics ?? []),
      ...Object.keys(procedureImpact.actuals) as PerformanceMetric[],
    ])];
    const metricSettings = Object.fromEntries(metricOrder.map(metric => [metric, {
      ...(settings?.metricSettings[metric] ?? config?.metricSettings?.[metric]),
      weight: settings ? settings.metricSettings[metric]?.weight ?? 0 : config?.metricSettings?.[metric]?.weight ?? METRIC_WEIGHTS[metric] ?? 0,
    }])) as MetricSettings;
    const targets = Object.fromEntries(metricOrder.map(metric => [metric, settings?.targets[metric] ?? 0])) as Target;
    return { metricOrder, metricSettings, targets };
  }, [shop, month, settings, procedureImpact.actuals]);
  const metricOrder = draft?.metricOrder ?? baseline.metricOrder;
  const metricSettings = draft ? Object.fromEntries(metricOrder.map(metric => [metric, {
    ...draft.metricSettings[metric], weight: Number(draft.weights[metric] ?? "") / 100,
  }])) as MetricSettings : baseline.metricSettings;
  const targets = draft ? Object.fromEntries(metricOrder.map(metric => [metric, Number(draft.targets[metric] ?? "")])) as Target : baseline.targets;
  const weightTotal = metricOrder.reduce((sum, metric) => sum + (metricSettings[metric]?.weight ?? 0), 0);
  const weightsValid = Number.isFinite(weightTotal) && Math.abs(weightTotal - 1) < 0.00001;
  const numbersValid = !draft || metricOrder.every(metric => {
    const target = draft.targets[metric] ?? "";
    const weight = draft.weights[metric] ?? "";
    return target.trim() !== "" && weight.trim() !== "" && Number.isFinite(Number(target)) && Number(target) >= 0
      && Number.isFinite(Number(weight)) && Number(weight) >= 0 && Number(weight) <= 100;
  });
  const targetsValid = metricOrder.every(metric => !(Number(metricSettings[metric]?.weight) > 0) || targets[metric] > 0);
  const input = draft ? { shopId, month, expectedRevision: draft.expectedRevision, targets, metricOrder, metricSettings, weightProfileId: draft.weightProfileId } : null;
  const valid = numbersValid && input !== null && saveDailyActivitySettingsSchema.safeParse(input).success;
  const calculationSettings = { targets, metricOrder, metricSettings };
  const previewRows = metricOrder.map(metric => {
    const actual = procedureImpact.actuals[metric] ?? 0;
    const target = targets[metric] ?? 0;
    const weight = metricSettings[metric]?.weight ?? 0;
    const achievement = target > 0 ? actual / target * 100 : null;
    return { metric, actual, target, weight, achievement, contribution: achievement === null ? 0 : achievement * weight };
  });
  const previewTotal = previewRows.reduce((sum, row) => sum + row.contribution, 0);
  const includingPendingRows = previewRows.map(row => {
    const actual = procedureImpact.includingPendingActuals[row.metric] ?? 0;
    const achievement = row.target > 0 ? actual / row.target * 100 : null;
    return { achievement, contribution: achievement === null ? 0 : achievement * row.weight };
  });
  const includingPendingTotal = includingPendingRows.reduce((sum, row) => sum + row.contribution, 0);
  const previewPendingTotal = metricOrder.reduce((sum, metric) => sum + (targets[metric] > 0
    ? (procedureImpact.pendingActuals[metric] ?? 0) / targets[metric] * 100 * (metricSettings[metric]?.weight ?? 0)
    : 0), 0);
  const negativeImpact = procedureImpact.metrics.reduce((sum, metric) => sum + (targets[metric.metric] > 0
    ? metric.negative / targets[metric.metric] * 100 * (metricSettings[metric.metric]?.weight ?? 0)
    : 0), 0);
  const canCalculate = Boolean(settings || draft) && numbersValid && Number.isFinite(previewTotal)
    && Number.isFinite(previewPendingTotal) && Number.isFinite(negativeImpact) && Number.isFinite(includingPendingTotal)
    && previewRows.every(row => row.achievement === null || Number.isFinite(row.achievement))
    && includingPendingRows.every(row => (row.achievement === null || Number.isFinite(row.achievement)) && Number.isFinite(row.contribution))
    && dailyActivitySettingsFieldsSchema.safeParse(calculationSettings).success;
  const calculation = canCalculate
    ? calculateDailyActivity(procedureImpact.actuals, calculationSettings)
    : { rows: previewRows, total: 0 };
  const includingPending = canCalculate
    ? calculateDailyActivity(procedureImpact.includingPendingActuals, calculationSettings).total
    : 0;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const label = (metric: PerformanceMetric) => metric.startsWith("custom_")
    ? getCustomMetricLabel(metric, metricSettings)
    : metricTranslations(metric);
  const days = query.data?.days ?? [];
  const draftDays = days.filter(day => day.status === "draft").length;
  const latestDate = days.at(-1)?.date;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const recordedDates = new Set(days.map(day => day.date));
  const missingDays = monthDates(month).filter(date => date <= today && !recordedDates.has(date)).length;

  useEffect(() => {
    if (shop) setSelectedShop(shop);
    setSelectedDatasetId(month);
    setSelectedPerformanceId(null);
  }, [shop, month, setSelectedShop, setSelectedDatasetId, setSelectedPerformanceId]);

  const beginEdit = () => {
    setError(null);
    setDraft({
      expectedRevision: settings?.revision ?? 0,
      metricOrder: baseline.metricOrder,
      metricSettings: structuredClone(baseline.metricSettings),
      targets: Object.fromEntries(baseline.metricOrder.map(metric => [metric, String(baseline.targets[metric] ?? 0)])),
      weights: Object.fromEntries(baseline.metricOrder.map(metric => [metric, String(Number(((baseline.metricSettings[metric]?.weight ?? 0) * 100).toFixed(6)))])),
      weightProfileId: settings?.weightProfileId,
    });
  };
  const applyProfile = (profile: MetricWeightProfile) => {
    if (!draft) return;
    const order = [...new Set([...profile.metricOrder, ...Object.keys(procedureImpact.actuals) as PerformanceMetric[]])];
    setDraft({
      ...draft,
      metricOrder: order,
      metricSettings: Object.fromEntries(order.map(metric => [metric, { ...baseline.metricSettings[metric], ...profile.metricSettings[metric] }])),
      weights: Object.fromEntries(order.map(metric => [metric, String(Number(((profile.metricOrder.includes(metric) ? profile.metricSettings[metric]?.weight ?? 0 : 0) * 100).toFixed(6)))])),
      targets: Object.fromEntries(order.map(metric => [metric, draft.targets[metric] ?? "0"])),
      weightProfileId: profile.id,
    });
    setError(null);
  };
  const save = async () => {
    if (!input || !valid || saving) return;
    setSaving(true); setError(null);
    try {
      const result = await saveDailyActivitySettings(input);
      if (!result.success) {
        setError(result.reason);
        return;
      }
      client.setQueryData<DailyActivityMonth>(dailyActivityMonthQueryKey(shopId, month), previous => previous ? { ...previous, settings: result.data } : previous);
      client.setQueryData(dailyActivitySettingsQueryKey(shopId, month), result.data);
      setDraft(null);
      toast({ title: t("saved") });
      void client.invalidateQueries({ queryKey: dailyActivityMonthQueryKey(shopId, month) });
      void client.invalidateQueries({ queryKey: dailyActivitySettingsQueryKey(shopId, month) });
    } catch { setError("saveFailed"); }
    finally { setSaving(false); }
  };

  return <>
    <Header title={`${shop?.name ?? ""} · ${t("title")}`} />
    <main className="shop-page-content space-y-3">
      <div className="mx-auto w-full max-w-6xl space-y-3">
        <ShopPageToolbar periodSelector={<Input type="month" aria-label={t("month")} value={month} min="2000-01" max="2099-12" className="h-9 w-full" disabled={editing || saving} onChange={event => {
          const parsed = attendanceMonthSchema.safeParse(event.target.value);
          if (!parsed.success) return;
          setMonth(parsed.data); setError(null);
          router.replace(`/${locale}/shop/${shopId}/daily-activity?month=${parsed.data}`, { scroll: false });
        }} />}>
          {canEdit && (editing ? <>
            <Button size="sm" onClick={() => void save()} disabled={!valid || saving}>{saving ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}{t("save")}</Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => { setDraft(null); setError(null); }}><X className="mr-1.5 h-4 w-4" />{t("cancel")}</Button>
          </> : <Button size="sm" variant="outline" disabled={!query.data || query.isError} onClick={beginEdit}><Pencil className="mr-1.5 h-4 w-4" />{t(settings ? "edit" : "configure")}</Button>)}
          <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={t("reload")} title={t("reload")} disabled={editing || saving || query.isFetching} onClick={() => void client.invalidateQueries({ queryKey: dailyActivityMonthQueryKey(shopId, month) })}><RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} /></Button>
        </ShopPageToolbar>
        {(error || query.isError) && <p role="alert" className="text-sm text-destructive">{t(`errors.${error ?? "loadFailed"}`)}</p>}
        {query.isPending ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />{t("loading")}</p> : query.data && <>
          {!settings && !editing && <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm"><p className="font-medium">{t("setupTitle")}</p><p className="mt-1 text-xs text-muted-foreground">{t(canEdit ? "setupDescription" : "readOnly")}</p></div>}
          {editing && <div className="space-y-2 rounded-md border bg-muted/20 p-3">
            <label className="flex flex-wrap items-center gap-2 text-xs font-medium">
              {t("weightProfile")}
              <AppSelect className="h-8 w-64 max-w-full" aria-label={t("chooseProfile")} disabled={saving} value={draft.weightProfileId ?? "custom"} onValueChange={value => {
                if (value === "custom") setDraft({ ...draft, weightProfileId: undefined });
                else { const profile = weightProfiles.find(item => item.id === value); if (profile) applyProfile(profile); }
              }} options={[
                { value: "custom", label: t("customWeights") },
                ...(draft.weightProfileId && !weightProfiles.some(profile => profile.id === draft.weightProfileId) ? [{ value: draft.weightProfileId, label: t("customWeights") }] : []),
                ...weightProfiles.map(profile => ({ value: profile.id, label: profile.name })),
              ]} />
            </label>
            <p className="text-xs text-muted-foreground">{t(weightProfiles.length ? "profileSnapshot" : "noProfiles")}</p>
            <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{t("unsavedChanges")}</p>
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{t("coverage", { count: days.length })}</span>
              <span>{latestDate ? t("latestDate", { date: formatReportingDate(latestDate, locale) }) : t("noRecordedDays")}</span>
              {draftDays > 0 && <Badge variant="outline" className="text-amber-700 dark:text-amber-300">{t("draftCoverage", { count: draftDays })}</Badge>}
            </div>
            <div className="flex items-center gap-2"><Calculator className="h-4 w-4 text-primary" /><span className="text-xs font-medium">{t(procedures ? "confirmedPerformance" : "total")}</span><span className="text-xl font-semibold tabular-nums">{canCalculate ? percent.format(calculation.total / 100) : "—"}</span></div>
          </div>
          {procedures && <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border bg-amber-500/[0.06] px-3 py-2"><p className="text-xs text-muted-foreground">{t("includingPendingPerformance")}</p><p className="mt-1 text-lg font-semibold tabular-nums">{canCalculate ? percent.format(includingPending / 100) : "—"}</p></div>
            <div className="rounded-md border px-3 py-2"><p className="text-xs text-muted-foreground">{t("pendingPerformanceImpact")}</p><p className="mt-1 text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-300">{canCalculate ? t("pp", { value: `+${number.format(previewPendingTotal)}` }) : "—"}</p></div>
            <div className="rounded-md border px-3 py-2"><p className="text-xs text-muted-foreground">{t("negativePerformanceImpact")}</p><p className="mt-1 text-lg font-semibold tabular-nums text-red-700 dark:text-red-300">{canCalculate ? t("pp", { value: `−${number.format(negativeImpact)}` }) : "—"}</p></div>
          </div>}
          {missingDays > 0 && <p className="text-xs text-muted-foreground">{t("missingDays", { count: missingDays })}</p>}
          <DailyActivityProcedures procedures={procedures} metrics={procedureImpact.metrics} targets={targets} metricSettings={metricSettings} canCalculate={canCalculate} />
          <div className="max-h-[65vh] overflow-auto rounded-md border">
            <table className="w-full min-w-[660px] border-collapse text-xs" aria-label={t("title")}>
              <thead className="sticky top-0 z-10 bg-muted"><tr>{["activity", "target", "weight", procedures ? "confirmedActual" : "actual", "achievement", "contribution"].map((column, index) => <th key={column} scope="col" className={cn("border-b border-r px-3 py-2 font-semibold last:border-r-0", index === 0 ? "min-w-52 text-left" : "w-28 text-right")}>{t(column)}</th>)}</tr></thead>
              <tbody>{calculation.rows.map(row => {
                const metricLabel = label(row.metric);
                return <tr key={row.metric} className="bg-background hover:bg-muted/30">
                  <th scope="row" className="border-b border-r px-3 py-2 text-left font-medium">{metricLabel}{procedureImpact.metrics.some(metric => metric.metric === row.metric) && <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">{t("sourceProcedures")}</span>}</th>
                  <td className="border-b border-r px-2 py-1 text-right tabular-nums">{draft ? <Input aria-label={`${t("target")} · ${metricLabel}`} type="number" min="0" step="any" disabled={saving} className="h-8 px-2 text-right text-xs" value={draft.targets[row.metric] ?? ""} onChange={event => setDraft({ ...draft, targets: { ...draft.targets, [row.metric]: event.target.value } })} /> : number.format(row.target)}</td>
                  <td className="border-b border-r px-2 py-1 text-right tabular-nums">{draft ? <Input aria-label={`${t("weight")} · ${metricLabel}`} type="number" min="0" max="100" step="any" disabled={saving} className="h-8 px-2 text-right text-xs" value={draft.weights[row.metric] ?? ""} onChange={event => setDraft({ ...draft, weightProfileId: undefined, weights: { ...draft.weights, [row.metric]: event.target.value } })} /> : percent.format(row.weight)}</td>
                  <td className="border-b border-r bg-primary/[0.04] px-3 py-2 text-right font-semibold tabular-nums">{number.format(row.actual)}</td>
                  <td className="border-b border-r px-3 py-2 text-right tabular-nums" title={row.achievement === null ? t("noTarget") : undefined}>{row.achievement === null || !Number.isFinite(row.achievement) ? "—" : percent.format(row.achievement / 100)}</td>
                  <td className="border-b border-r px-3 py-2 text-right tabular-nums last:border-r-0">{canCalculate ? percent.format(row.contribution / 100) : "—"}</td>
                </tr>;
              })}</tbody>
              <tfoot className="sticky bottom-0 bg-muted font-semibold"><tr><th scope="row" colSpan={2} className="border-r px-3 py-2 text-left">{t(procedures ? "confirmedPerformance" : "total")}</th><td className={cn("border-r px-3 py-2 text-right tabular-nums", editing && !weightsValid && "text-destructive")}>{Number.isFinite(weightTotal) ? percent.format(weightTotal) : "—"}</td><td colSpan={2} className="border-r px-3 py-2 text-right text-muted-foreground">{editing ? t("editingPreview") : draftDays > 0 ? t("provisional") : ""}</td><td className="px-3 py-2 text-right tabular-nums">{canCalculate ? percent.format(calculation.total / 100) : "—"}</td></tr></tfoot>
            </table>
          </div>
          {editing && <div className="space-y-1 text-xs">
            <p className={weightsValid ? "text-muted-foreground" : "text-destructive"}>{t("weightsTotal", { total: Number.isFinite(weightTotal) ? number.format(weightTotal * 100) : "—" })} {!weightsValid && t("weightsInvalid")}</p>
            {!targetsValid && <p className="text-destructive">{t("targetRequired")}</p>}
          </div>}
          {!settings && !editing && !days.length && <p className="text-xs text-muted-foreground">{t("empty")}</p>}
          <p className="text-xs text-muted-foreground">{t("formulaHint")}</p>
          <p className="text-xs text-muted-foreground">{t("rawActivitiesNote")}</p>
          {days.length > 0 && <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">{t("recordedDays")}</summary>
            <div className="max-h-80 overflow-auto border-t"><table className="w-full border-collapse whitespace-nowrap text-xs" aria-label={t("recordedDays")}>
              <thead className="sticky top-0 bg-muted"><tr><th scope="col" className="border-b border-r px-3 py-2 text-left">{t("date")}</th><th scope="col" className="border-b border-r px-3 py-2 text-left">{t("status")}</th>{metricOrder.map(metric => <th key={metric} scope="col" className="border-b border-r px-3 py-2 text-right last:border-r-0">{label(metric)}</th>)}</tr></thead>
              <tbody>{days.map(day => <tr key={day.date}><th scope="row" className="border-b border-r px-3 py-2 text-left font-normal">{formatReportingDate(day.date, locale, "short")}</th><td className="border-b border-r px-3 py-2">{t(day.status === "draft" ? "draft" : "finalized")}</td>{metricOrder.map(metric => <td key={metric} className="border-b border-r px-3 py-2 text-right tabular-nums last:border-r-0">{number.format(day.activities[metric] ?? 0)}</td>)}</tr>)}</tbody>
            </table></div>
          </details>}
        </>}
      </div>
    </main>
  </>;
}
