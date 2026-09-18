"use client";

import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, RotateCcw, Upload } from "lucide-react";
import { format, getDaysInMonth, parseISO } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { handleAllocateShopId } from "@/app/actions/shops";
import { handlePrepareRepresentativeImport } from "@/app/actions/representatives";
import { handleRegisterImport, handleUndoLatestImport } from "@/app/actions/imports";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { importTargetWorkbook, type ImportedWorkbookData } from "@/lib/excel-import";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import {
  getQuarterKey,
  getInitialTargets,
  getMonthlyRepresentatives,
  getOverviewPerformanceData,
  type MetricSettings,
  type MetricWeightProfile,
  type PerformanceData,
  type PerformanceMetric,
  type Shop,
  type Target,
} from "@/lib/types";
import { useShop } from "./shop-provider";
import { performanceMonthQueryOptions } from "@/lib/performance-queries";

type ReviewState = {
  workbook: ImportedWorkbookData;
  reportType: "midMonth" | "completedMonth";
  reportMonth: string;
  asOfDate: string;
  profileSelections: Record<number, string>;
  targetedRepresentatives: Record<string, boolean>;
};

const normalizeName = (value: string) => value.trim().toLocaleLowerCase();
const isValidNumber = (value: number) => Number.isFinite(value) && value >= 0;
const representativeKey = (shopIndex: number, representativeId: string) => `${shopIndex}:${representativeId}`;

function hiddenRepresentativesForImport(shop: Shop, month: string, performanceData: PerformanceData[]) {
  const visibleRepresentatives = getMonthlyRepresentatives(shop, month);
  const visibleIds = new Set(visibleRepresentatives.map(representative => representative.id));
  const visibleNames = new Set(visibleRepresentatives.map(representative => normalizeName(representative.name)));
  const hiddenById = new Map((shop.hiddenSalesRepresentatives ?? []).map(representative => [representative.id, representative]));

  getOverviewPerformanceData(performanceData)
    .filter(entry => entry.date.startsWith(month))
    .flatMap(entry => entry.reps)
    .forEach(representative => {
      if (
        representative.repName
        && !visibleIds.has(representative.repId)
        && !visibleNames.has(normalizeName(representative.repName))
        && !hiddenById.has(representative.repId)
      ) {
        hiddenById.set(representative.repId, { id: representative.repId, name: representative.repName });
      }
    });

  return Array.from(hiddenById.values());
}

function metricRecord(record: Partial<Record<PerformanceMetric, number>>, metrics: readonly PerformanceMetric[]) {
  return Object.fromEntries(metrics.map(metric => [metric, Number(record[metric] ?? 0)])) as Target;
}

function metricWeightTotal(settings: MetricSettings, metrics: readonly PerformanceMetric[]) {
  return metrics.reduce((total, metric) => total + Number(settings[metric]?.weight ?? 0), 0);
}

function monthEnd(month: string) {
  const date = parseISO(`${month}-01`);
  return `${month}-${String(getDaysInMonth(date)).padStart(2, "0")}`;
}

function moveDateToMonth(date: string, month: string) {
  const requestedDay = Number(date.slice(8, 10)) || 1;
  const lastDay = getDaysInMonth(parseISO(`${month}-01`));
  return `${month}-${String(Math.min(requestedDay, lastDay)).padStart(2, "0")}`;
}

type ExcelImportDialogProps = {
  restrictToSelectedShop?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
};

export function ExcelImportDialog({
  restrictToSelectedShop = false,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: ExcelImportDialogProps) {
  const { selectedShop, shops, weightProfiles, reloadData } = useShop();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [review, setReview] = useState<ReviewState | null>(null);
  const performanceQuery = useQuery({
    ...performanceMonthQueryOptions(review?.reportMonth ?? ""),
    enabled: Boolean(review?.reportMonth),
  });
  const performanceByShop = performanceQuery.data;

  const reset = () => {
    setReview(null);
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!nextOpen && !loading) reset();
  };

  const open = controlledOpen ?? internalOpen;

  const readFile = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    setReview(null);
    try {
      const knownMetricSettings = {
        ...selectedShop?.metricSettings,
        ...Object.values(selectedShop?.quarterSettings ?? {}).reduce((settings, quarter) => ({ ...settings, ...quarter.metricSettings }), {} as MetricSettings),
        ...weightProfiles.reduce((settings, profile) => ({ ...settings, ...profile.metricSettings }), {} as MetricSettings),
      };
      const customMetricLabels = Object.fromEntries(Object.entries(knownMetricSettings)
        .filter(([metric, setting]) => metric.startsWith("custom_") && setting?.label?.trim().toLocaleLowerCase() !== "mixmax")
        .map(([metric, setting]) => [metric, setting?.label?.trim()]));
      const parsed = await importTargetWorkbook(file, customMetricLabels);
      const selectedShops = restrictToSelectedShop && selectedShop
        ? parsed.shops.filter(shop => normalizeName(shop.shopName) === normalizeName(selectedShop.name))
        : parsed.shops;
      const ignoredShopCount = parsed.shops.length - selectedShops.length;
      const workbook = {
        ...parsed,
        shops: selectedShops,
        warnings: ignoredShopCount > 0
          ? [...parsed.warnings, `${ignoredShopCount} other ${ignoredShopCount === 1 ? "shop was" : "shops were"} found and will not be imported from this shop page.`]
          : parsed.warnings,
      };

      if (!workbook.shops.length) {
        throw new Error(`This workbook does not contain data for ${selectedShop?.name ?? "the selected shop"}.`);
      }

      const today = format(new Date(), "yyyy-MM-dd");
      const reportMonth = today.slice(0, 7);
      await queryClient.fetchQuery(performanceMonthQueryOptions(reportMonth));
      const parsedDate = parseISO(today);
      const reportType = parsedDate.getDate() >= getDaysInMonth(parsedDate) ? "completedMonth" : "midMonth";
      const profileSelections = Object.fromEntries(workbook.shops.map((imported, shopIndex) => {
        const existingShop = restrictToSelectedShop && selectedShop
          ? selectedShop
          : shops.find(shop => normalizeName(shop.name) === normalizeName(imported.shopName));
        const profileId = weightProfiles.some(profile => profile.id === existingShop?.weightProfileId)
          ? existingShop!.weightProfileId!
          : "";
        return [shopIndex, profileId];
      }));
      const targetedRepresentatives = Object.fromEntries(workbook.shops.flatMap((shop, shopIndex) =>
        shop.representatives.map(representative => [representativeKey(shopIndex, representative.id), true]),
      ));

      setReview({ workbook, reportType, reportMonth, asOfDate: today, profileSelections, targetedRepresentatives });
      setFileName(file.name);
    } catch (error) {
      toast({ variant: "destructive", title: "Import failed", description: error instanceof Error ? error.message : "The workbook could not be read." });
    } finally {
      setLoading(false);
    }
  };

  const validation = useMemo(() => {
    if (!review) return { errors: [] as string[], warnings: [] as string[] };
    const errors: string[] = [];
    const warnings: string[] = [];
    warnings.push(...review.workbook.warnings);
    if (!/^\d{4}-\d{2}$/.test(review.reportMonth)) errors.push("Choose a valid reporting month.");
    if (review.reportType === "midMonth" && !review.asOfDate.startsWith(`${review.reportMonth}-`)) errors.push("The cutoff date must be inside the reporting month.");

    const shopNames = review.workbook.shops.map(shop => normalizeName(shop.shopName));
    if (new Set(shopNames).size !== shopNames.length) errors.push("The workbook contains duplicate shop names.");
    review.workbook.shops.forEach((shop, shopIndex) => {
      const profile = weightProfiles.find(item => item.id === review.profileSelections[shopIndex]);
      if (!profile) {
        errors.push(`${shop.shopName}: select a weight profile.`);
        return;
      }
      const metrics = profile.metricOrder;
      if (Math.abs(metricWeightTotal(profile.metricSettings, metrics) - 1) > 0.00001) errors.push(`${profile.name}: profile weights must total exactly 100%.`);
      metrics.filter(metric => !review.workbook.detectedMetrics.includes(metric)).forEach(metric => warnings.push(`${shop.shopName}: ${profile.metricSettings[metric]?.label ?? metric} is in ${profile.name} but was not detected in the workbook.`));
      if (!shop.shopName.trim()) errors.push("Every shop needs a name.");
      if (!isValidNumber(shop.revenue)) errors.push(`${shop.shopName}: revenue must be zero or greater.`);
      if (shop.qualityMetrics?.checklistScore !== undefined && !isValidNumber(shop.qualityMetrics.checklistScore)) errors.push(`${shop.shopName}: checklist score is invalid.`);
      if (shop.qualityMetrics?.npsScore !== undefined && (!Number.isFinite(shop.qualityMetrics.npsScore) || shop.qualityMetrics.npsScore < -100 || shop.qualityMetrics.npsScore > 100)) errors.push(`${shop.shopName}: NPS must be between -100 and 100.`);
      if (shop.qualityMetrics?.npsResponses !== undefined && !isValidNumber(shop.qualityMetrics.npsResponses)) errors.push(`${shop.shopName}: NPS responses must be zero or greater.`);
      const existingShop = restrictToSelectedShop && selectedShop
        ? selectedShop
        : shops.find(item => normalizeName(item.name) === normalizeName(shop.shopName));
      if (existingShop && (performanceByShop?.[existingShop.id] ?? []).some(entry => entry.date.startsWith(review.reportMonth))) {
        warnings.push(`${shop.shopName}: this month already has data. This file will be retained as a new version and become the active monthly snapshot.`);
      }
      const representativeNames = shop.representatives.map(rep => normalizeName(rep.name));
      if (new Set(representativeNames).size !== representativeNames.length) errors.push(`${shop.shopName}: representative names must be unique.`);
      if (!shop.representatives.some(rep => review.targetedRepresentatives[representativeKey(shopIndex, rep.id)])) errors.push(`${shop.shopName}: select at least one representative to receive targets.`);
      metrics.forEach(metric => {
        const label = profile.metricSettings[metric]?.label ?? metric;
        const target = Number(shop.targets[metric]);
        const actual = Number(shop.achievements[metric]);
        if (!isValidNumber(target) || !isValidNumber(actual)) errors.push(`${shop.shopName}: ${label} has an invalid target or achievement.`);
        if (target === 0 && actual > 0) warnings.push(`${shop.shopName}: ${label} has achievement but a zero target.`);
        const representativeTotal = shop.representatives.reduce((sum, rep) => sum + Number(rep.achievements[metric] ?? 0), 0);
        if (actual > 0 && Math.abs(actual - representativeTotal) > 0.01) warnings.push(`${shop.shopName}: ${label} shop achievement differs from the representative total.`);
      });
    });
    return { errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)) };
  }, [review, restrictToSelectedShop, selectedShop, shops, weightProfiles, performanceByShop]);

  const applyImport = async () => {
    if (!review || !performanceByShop || performanceQuery.isFetching || performanceQuery.isError || validation.errors.length) return;
    setLoading(true);
    try {
      let representativeCount = 0;
      let hiddenRepresentativeCount = 0;
      const importedAt = new Date().toISOString();
      const importId = `excel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const reportDate = review.reportType === "completedMonth" ? monthEnd(review.reportMonth) : review.asOfDate;
      const quarterKey = getQuarterKey(reportDate);
      const importChanges: Array<{ shopId: string; shopName: string; performanceId: string; previousShop: Shop | null; importedShop: Shop; performance: PerformanceData }> = [];

      for (const [shopIndex, imported] of review.workbook.shops.entries()) {
        const profile = weightProfiles.find(item => item.id === review.profileSelections[shopIndex]);
        if (!profile) throw new Error(`${imported.shopName}: select a weight profile before importing.`);
        const keptMetrics = profile.metricOrder;
        const metricSettings = structuredClone(profile.metricSettings);
        const existingShop = restrictToSelectedShop && selectedShop
          ? selectedShop
          : shops.find(item => normalizeName(item.name) === normalizeName(imported.shopName));
        const existedBeforeImport = Boolean(existingShop);
        let shop: Shop;
        if (existingShop) {
          shop = existingShop;
        } else {
          const allocated = await handleAllocateShopId();
          if (!allocated.success) throw new Error(`Could not prepare ${imported.shopName}.`);
          shop = {
            id: allocated.data,
            name: imported.shopName,
            description: "Imported from Excel report",
            salesRepresentatives: [],
            monthlyTargets: getInitialTargets(),
          };
        }
        if (existedBeforeImport) {
          const preparation = await handlePrepareRepresentativeImport(shop.id);
          if (!preparation.success) throw new Error(preparation.error);
          shop = { ...shop, hiddenSalesRepresentatives: preparation.hiddenSalesRepresentatives };
        }
        const previousShop = existedBeforeImport ? structuredClone(shop) : null;
        const targets = metricRecord(imported.targets, keptMetrics);
        const achievements = metricRecord(imported.achievements, keptMetrics);
        const hiddenSalesRepresentatives = hiddenRepresentativesForImport(
          shop,
          review.reportMonth,
          performanceByShop[shop.id] ?? [],
        );
        const hiddenIds = new Set(hiddenSalesRepresentatives.map(representative => representative.id));
        const hiddenNames = new Set(hiddenSalesRepresentatives.map(representative => normalizeName(representative.name)));
        const visibleImportedRepresentatives = imported.representatives.filter(representative =>
          !hiddenIds.has(representative.id) && !hiddenNames.has(normalizeName(representative.name)),
        );
        if (!visibleImportedRepresentatives.length) {
          throw new Error(`${imported.shopName}: no visible representatives remain after applying hidden representative settings.`);
        }
        const reps = visibleImportedRepresentatives.map(({ id, name }) => ({ id, name }));
        representativeCount += reps.length;
        hiddenRepresentativeCount += imported.representatives.length - visibleImportedRepresentatives.length;
        const targetedRepresentatives = visibleImportedRepresentatives.filter(rep => review.targetedRepresentatives[representativeKey(shopIndex, rep.id)]);
        const sharedTargets = getEqualRepresentativeTargets(targets, keptMetrics, targetedRepresentatives.length);
        const representativeTargets = Object.fromEntries(visibleImportedRepresentatives.map(rep => [
          rep.id,
          review.targetedRepresentatives[representativeKey(shopIndex, rep.id)] ? sharedTargets : metricRecord({}, keptMetrics),
        ])) as Record<string, Target>;
        const collection = Number(imported.revenue);
        const updatedShop = {
          ...shop,
          weightProfileId: profile.id,
          revenue: collection,
          monthlyTargets: targets,
          salesRepresentatives: reps,
          hiddenSalesRepresentatives,
          monthlyData: {
            ...shop.monthlyData,
            [review.reportMonth]: {
              collection,
              targets,
              representatives: reps,
              representativeTargets,
              metricSettings,
              metricOrder: keptMetrics,
              qualityMetrics: imported.qualityMetrics,
            },
          },
          quarterSettings: {
            ...shop.quarterSettings,
            [quarterKey]: { metricSettings, metricOrder: keptMetrics },
          },
        };
        const performance: PerformanceData = {
          date: reportDate,
          importId,
          importName: fileName,
          importedAt,
          reportType: review.reportType,
          asOfDate: reportDate,
          includeInOverview: true,
          qualityMetrics: imported.qualityMetrics,
          targets,
          representativeTargets,
          metricSettings,
          metricOrder: keptMetrics,
          revenue: collection,
          shopActuals: achievements,
          reps: visibleImportedRepresentatives.map(rep => ({ repId: rep.id, repName: rep.name, ...metricRecord(rep.achievements, keptMetrics) })),
        };
        importChanges.push({ shopId: shop.id, shopName: imported.shopName, performanceId: importId, previousShop, importedShop: updatedShop, performance });
      }

      const registration = await handleRegisterImport(importId, fileName, review.reportMonth, reportDate, importChanges);
      if (!registration.success) throw new Error(registration.error);

      await reloadData();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-periods"] }),
        queryClient.invalidateQueries({ queryKey: ["firestore-shop-performance-page"] }),
      ]);
      toast({
        title: "Excel data imported",
        description: `${review.workbook.shops.length} shops and ${representativeCount} visible representatives were updated.${hiddenRepresentativeCount ? ` ${hiddenRepresentativeCount} hidden representative${hiddenRepresentativeCount === 1 ? " was" : "s were"} skipped.` : ""} The file was retained as an independent version.`,
      });
      setOpen(false);
      reset();
    } catch (error) {
      toast({ variant: "destructive", title: "Import failed", description: error instanceof Error ? error.message : "The workbook data could not be saved." });
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void readFile(event.dataTransfer.files[0]);
  };
  const selectedProfileFor = useCallback((shopIndex: number): MetricWeightProfile | undefined => weightProfiles.find(profile => profile.id === review?.profileSelections[shopIndex]), [review?.profileSelections, weightProfiles]);
  const profileSummary = useMemo(() => {
    if (!review) return [];
    const counts = new Map<string, number>();
    review.workbook.shops.forEach((_, index) => {
      const name = selectedProfileFor(index)?.name ?? "Profile required";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return Array.from(counts.entries());
  }, [review, selectedProfileFor]);
  const undoLatestImport = async () => {
    setLoading(true);
    try {
      const result = await handleUndoLatestImport();
      if (!result.success) throw new Error(result.error);
      await reloadData();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-periods"] }),
        queryClient.invalidateQueries({ queryKey: ["firestore-shop-performance-page"] }),
      ]);
      toast({ title: "Import undone", description: `${result.fileName} was rolled back safely.` });
    } catch (error) {
      toast({ variant: "destructive", title: "Could not undo import", description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return <Dialog open={open} onOpenChange={setOpen}>
    {showTrigger && <DialogTrigger asChild><Button variant="outline" className="w-full justify-start gap-2"><FileSpreadsheet className="h-4 w-4" />Import Excel</Button></DialogTrigger>}
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle>{restrictToSelectedShop && selectedShop ? `Import Excel for ${selectedShop.name}` : "Import targets and achievements"}</DialogTitle>
        <DialogDescription>Upload one monthly Excel report, review the detected values, and correct anything before importing.</DialogDescription>
      </DialogHeader>
      <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={event => void readFile(event.target.files?.[0])} />

      {!review ? <><div role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }} onDragEnter={event => { event.preventDefault(); setDragging(true); }} onDragOver={event => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={handleDrop} className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/60"}`}>
        {loading ? <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" /> : <Upload className="mb-3 h-8 w-8 text-muted-foreground" />}
        <p className="font-medium">{loading ? "Reading workbook…" : "Drop Excel here or click to browse"}</p>
        <p className="mt-1 text-sm text-muted-foreground">.xlsx files up to 10 MB · one reporting month</p>
      </div><div className="flex justify-end"><Button type="button" variant="ghost" disabled={loading} onClick={() => void undoLatestImport()}><RotateCcw className="mr-2 h-4 w-4" />Undo latest import</Button></div></> : <div className="space-y-5">
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-3">
          <Label className="grid gap-1.5">Report type<select className="h-10 rounded-md border bg-background px-3 text-sm" value={review.reportType} onChange={event => setReview(current => current && { ...current, reportType: event.target.value as ReviewState["reportType"] })}><option value="midMonth">Mid-month update</option><option value="completedMonth">Completed month</option></select></Label>
          <Label className="grid gap-1.5">Reporting month<Input type="month" value={review.reportMonth} onChange={event => { const reportMonth = event.target.value; setReview(current => current && { ...current, reportMonth, asOfDate: reportMonth ? moveDateToMonth(current.asOfDate, reportMonth) : current.asOfDate }); }} /></Label>
          {review.reportType === "midMonth" ? <Label className="grid gap-1.5">Data as of<Input type="date" min={`${review.reportMonth}-01`} max={monthEnd(review.reportMonth)} value={review.asOfDate} onChange={event => { const asOfDate = event.target.value; setReview(current => current && { ...current, asOfDate, ...(asOfDate && { reportMonth: asOfDate.slice(0, 7) }) }); }} /><span className="text-xs font-normal text-muted-foreground">Choose the last day included in this Excel report.</span></Label> : <div className="grid content-center gap-1"><span className="text-sm font-medium">EOM status</span><span className="text-sm text-muted-foreground">Final — no forecast</span></div>}
        </div>

        <section className="space-y-2 rounded-lg border bg-muted/20 p-4">
          <div><h3 className="font-semibold">Weight profiles</h3><p className="text-xs text-muted-foreground">Defaults were selected automatically by shop for {getQuarterKey(`${review.reportMonth}-01`)}.</p></div>
          <div className="flex flex-wrap gap-2">{profileSummary.map(([name, count]) => <span key={name} className={`rounded-full border bg-background px-3 py-1 text-sm ${name === "Profile required" ? "border-destructive text-destructive" : ""}`}>{name}: {count} {count === 1 ? "shop" : "shops"}</span>)}</div>
        </section>

        {validation.errors.length > 0 && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"><p className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Fix before importing</p><ul className="list-disc space-y-1 pl-5">{validation.errors.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
        {performanceQuery.isFetching && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking existing month data…</p>}
        {performanceQuery.isError && <div role="alert" className="flex items-center gap-2 text-sm text-destructive">Could not load existing month data.<Button type="button" size="sm" variant="outline" onClick={() => void performanceQuery.refetch()}><RotateCcw className="mr-2 h-4 w-4" />Retry</Button></div>}
        {!validation.errors.length && performanceByShop && !performanceQuery.isFetching && !performanceQuery.isError && <p className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />All import checks passed.</p>}
      </div>}

      <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>{review && <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={loading}>Choose another file</Button>}<Button onClick={applyImport} disabled={!review || !performanceByShop || performanceQuery.isFetching || performanceQuery.isError || loading || validation.errors.length > 0}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Import reviewed data</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
