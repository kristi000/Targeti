"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, RotateCcw, Upload } from "lucide-react";
import { format, getDaysInMonth, parseISO } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { handleAddShop, handlePrepareRepresentativeImport, handleRegisterImport, handleSaveExcelPerformanceData, handleUndoLatestImport, handleUpdateShop } from "@/app/actions";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { importTargetWorkbook, type ImportedShopData, type ImportedWorkbookData } from "@/lib/excel-import";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import {
  getQuarterKey,
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

type ReviewState = {
  workbook: ImportedWorkbookData;
  reportType: "midMonth" | "completedMonth";
  reportMonth: string;
  asOfDate: string;
  includeInOverview: boolean;
  profileSelections: Record<number, string>;
  targetedRepresentatives: Record<string, boolean>;
  skippedRecords: number;
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
  const { selectedShop, shops, weightProfiles, allPerformanceData, loadPerformanceMonth, reloadData } = useShop();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [review, setReview] = useState<ReviewState | null>(null);

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

      const detectedDate = workbook.shops[0].date;
      const today = format(new Date(), "yyyy-MM-dd");
      const date = detectedDate.endsWith("-01") && detectedDate.slice(0, 7) === today.slice(0, 7)
        ? today
        : detectedDate;
      const reportMonth = date.slice(0, 7);
      await loadPerformanceMonth(reportMonth);
      const parsedDate = parseISO(date);
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

      setReview({ workbook, reportType, reportMonth, asOfDate: date, includeInOverview: true, profileSelections, targetedRepresentatives, skippedRecords: ignoredShopCount });
      setFileName(file.name);
    } catch (error) {
      toast({ variant: "destructive", title: "Import failed", description: error instanceof Error ? error.message : "The workbook could not be read." });
    } finally {
      setLoading(false);
    }
  };

  const updateShop = (shopIndex: number, updater: (shop: ImportedShopData) => ImportedShopData) => {
    setReview(current => current ? {
      ...current,
      workbook: { ...current.workbook, shops: current.workbook.shops.map((shop, index) => index === shopIndex ? updater(shop) : shop) },
    } : current);
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
      if (existingShop && (allPerformanceData[existingShop.id] ?? []).some(entry => entry.date.startsWith(review.reportMonth))) {
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
  }, [review, restrictToSelectedShop, selectedShop, shops, weightProfiles, allPerformanceData]);

  const applyImport = async () => {
    if (!review || validation.errors.length) return;
    setLoading(true);
    try {
      let representativeCount = 0;
      let hiddenRepresentativeCount = 0;
      const importedAt = new Date().toISOString();
      const importId = `excel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const reportDate = review.reportType === "completedMonth" ? monthEnd(review.reportMonth) : review.asOfDate;
      const quarterKey = getQuarterKey(reportDate);
      const importChanges: Array<{ shopId: string; shopName: string; performanceId: string; previousShop: import("@/lib/types").Shop | null; importedShop: import("@/lib/types").Shop }> = [];

      for (const [shopIndex, imported] of review.workbook.shops.entries()) {
        const profile = weightProfiles.find(item => item.id === review.profileSelections[shopIndex]);
        if (!profile) throw new Error(`${imported.shopName}: select a weight profile before importing.`);
        const keptMetrics = profile.metricOrder;
        const metricSettings = structuredClone(profile.metricSettings);
        let shop = restrictToSelectedShop && selectedShop
          ? selectedShop
          : shops.find(item => normalizeName(item.name) === normalizeName(imported.shopName));
        const existedBeforeImport = Boolean(shop);
        if (!shop) {
          const created = await handleAddShop(imported.shopName, "Imported from Excel report");
          if (!created.success || !created.data) throw new Error(`Could not create ${imported.shopName}.`);
          shop = created.data;
        }
        const preparation = await handlePrepareRepresentativeImport(shop.id);
        if (!preparation.success) throw new Error(preparation.error);
        shop = { ...shop, hiddenSalesRepresentatives: preparation.hiddenSalesRepresentatives };
        const previousShop = existedBeforeImport ? structuredClone(shop) : null;
        const targets = metricRecord(imported.targets, keptMetrics);
        const achievements = metricRecord(imported.achievements, keptMetrics);
        const hiddenSalesRepresentatives = hiddenRepresentativesForImport(
          shop,
          review.reportMonth,
          allPerformanceData[shop.id] ?? [],
        );
        const hiddenIds = new Set(hiddenSalesRepresentatives.map(representative => representative.id));
        const hiddenNames = new Set(hiddenSalesRepresentatives.map(representative => normalizeName(representative.name)));
        const visibleImportedRepresentatives = imported.representatives.filter(representative =>
          !hiddenIds.has(representative.id) && !hiddenNames.has(normalizeName(representative.name)),
        );
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
        const performance: PerformanceData[] = [{
          date: reportDate,
          importId,
          importName: fileName,
          importedAt,
          reportType: review.reportType,
          asOfDate: reportDate,
          includeInOverview: review.includeInOverview,
          qualityMetrics: imported.qualityMetrics,
          targets,
          revenue: collection,
          shopActuals: achievements,
          reps: visibleImportedRepresentatives.map(rep => ({ repId: rep.id, repName: rep.name, ...metricRecord(rep.achievements, keptMetrics) })),
        }];
        const results = await Promise.all([
          handleUpdateShop(updatedShop),
          handleSaveExcelPerformanceData(shop.id, performance),
        ]);
        if (results.some(result => !result.success)) throw new Error(`Could not save ${imported.shopName}.`);
        importChanges.push({ shopId: shop.id, shopName: imported.shopName, performanceId: importId, previousShop, importedShop: updatedShop });
      }

      const registration = await handleRegisterImport(importId, fileName, review.reportMonth, importChanges);
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
  const selectedProfileFor = (shopIndex: number): MetricWeightProfile | undefined => weightProfiles.find(profile => profile.id === review?.profileSelections[shopIndex]);
  const profileSummary = useMemo(() => {
    if (!review) return [];
    const counts = new Map<string, number>();
    review.workbook.shops.forEach((_, index) => {
      const name = selectedProfileFor(index)?.name ?? "Profile required";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return Array.from(counts.entries());
  }, [review, weightProfiles]);
  const previewCounts = useMemo(() => {
    if (!review) return { created: 0, updated: 0, skipped: 0, invalid: 0 };
    const invalid = validation.errors.length ? review.workbook.shops.length : 0;
    const created = invalid ? 0 : review.workbook.shops.filter(imported => !shops.some(shop => normalizeName(shop.name) === normalizeName(imported.shopName))).length;
    return { created, updated: invalid ? 0 : review.workbook.shops.length - created, skipped: review.skippedRecords, invalid };
  }, [review, validation.errors.length, shops]);

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
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={event => void readFile(event.target.files?.[0])} />

      {!review ? <><div role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }} onDragEnter={event => { event.preventDefault(); setDragging(true); }} onDragOver={event => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={handleDrop} className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/60"}`}>
        {loading ? <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" /> : <Upload className="mb-3 h-8 w-8 text-muted-foreground" />}
        <p className="font-medium">{loading ? "Reading workbook…" : "Drop Excel here or click to browse"}</p>
        <p className="mt-1 text-sm text-muted-foreground">.xlsx and .xls files · one reporting month</p>
      </div><div className="flex justify-end"><Button type="button" variant="ghost" disabled={loading} onClick={() => void undoLatestImport()}><RotateCcw className="mr-2 h-4 w-4" />Undo latest import</Button></div></> : <div className="space-y-5">
        <section aria-label="Import impact preview" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([['Created', previewCounts.created, 'text-emerald-700'], ['Updated', previewCounts.updated, 'text-blue-700'], ['Skipped', previewCounts.skipped, 'text-amber-700'], ['Invalid', previewCounts.invalid, 'text-destructive']] as const).map(([label, count, color]) => <div key={label} className="rounded-lg border bg-background p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{count}</p><p className="text-xs text-muted-foreground">records</p></div>)}
        </section>
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Label className="grid gap-1.5">Report type<select className="h-10 rounded-md border bg-background px-3 text-sm" value={review.reportType} onChange={event => setReview(current => current && { ...current, reportType: event.target.value as ReviewState["reportType"] })}><option value="midMonth">Mid-month update</option><option value="completedMonth">Completed month</option></select></Label>
          <Label className="grid gap-1.5">Reporting month<Input type="month" value={review.reportMonth} onChange={event => { const reportMonth = event.target.value; setReview(current => current && { ...current, reportMonth, asOfDate: reportMonth ? moveDateToMonth(current.asOfDate, reportMonth) : current.asOfDate }); }} /></Label>
          {review.reportType === "midMonth" ? <Label className="grid gap-1.5">Data as of<Input type="date" min={`${review.reportMonth}-01`} max={monthEnd(review.reportMonth)} value={review.asOfDate} onChange={event => { const asOfDate = event.target.value; setReview(current => current && { ...current, asOfDate, ...(asOfDate && { reportMonth: asOfDate.slice(0, 7) }) }); }} /><span className="text-xs font-normal text-muted-foreground">Choose the last day included in this Excel report.</span></Label> : <div className="grid content-center gap-1"><span className="text-sm font-medium">EOM status</span><span className="text-sm text-muted-foreground">Final — no forecast</span></div>}
          <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"><div><p className="text-sm font-medium">Show on main page</p><p className="text-xs text-muted-foreground">Otherwise shop pages only</p></div><Switch checked={review.includeInOverview} onCheckedChange={includeInOverview => setReview(current => current && { ...current, includeInOverview })} /></div>
        </div>

        <section className="space-y-2 rounded-lg border bg-muted/20 p-4">
          <div><h3 className="font-semibold">Weight profiles</h3><p className="text-xs text-muted-foreground">Defaults were selected by shop for {getQuarterKey(`${review.reportMonth}-01`)}. Change a shop below only when this import should also change its future default.</p></div>
          <div className="flex flex-wrap gap-2">{profileSummary.map(([name, count]) => <span key={name} className={`rounded-full border bg-background px-3 py-1 text-sm ${name === "Profile required" ? "border-destructive text-destructive" : ""}`}>{name}: {count} {count === 1 ? "shop" : "shops"}</span>)}</div>
        </section>

        <section className="space-y-2"><h3 className="font-semibold">Shop data</h3><Accordion type="multiple" defaultValue={review.workbook.shops.length === 1 ? ["shop-0"] : []} className="space-y-2">{review.workbook.shops.map((shop, shopIndex) => <AccordionItem key={`${shop.shopName}-${shopIndex}`} value={`shop-${shopIndex}`} className="rounded-md border px-3"><AccordionTrigger><span className="flex flex-1 items-center justify-between pr-3"><span>{shop.shopName}</span><span className="text-xs font-normal text-muted-foreground">{shop.representatives.length} representatives</span></span></AccordionTrigger><AccordionContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3"><Label className="grid gap-1.5">Shop name<Input value={shop.shopName} disabled={restrictToSelectedShop} onChange={event => updateShop(shopIndex, current => ({ ...current, shopName: event.target.value }))} /></Label><Label className="grid gap-1.5">Revenue<Input type="number" min="0" value={shop.revenue} onChange={event => updateShop(shopIndex, current => ({ ...current, revenue: Number(event.target.value) }))} /></Label><Label className="grid gap-1.5">Weight profile<select className="h-10 rounded-md border bg-background px-3 text-sm" value={review.profileSelections[shopIndex] ?? ""} onChange={event => setReview(current => current && ({ ...current, profileSelections: { ...current.profileSelections, [shopIndex]: event.target.value } }))}><option value="">Select profile</option>{weightProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></Label></div>
          {shop.qualityMetrics && <div className="space-y-2 rounded-md border bg-muted/20 p-3"><div><p className="text-sm font-semibold">Quality indicators</p><p className="text-xs text-muted-foreground">Shown separately from weighted target metrics.</p></div><div className="grid gap-3 sm:grid-cols-3"><Label className="grid gap-1.5">Checklist score<Input type="number" min="0" value={shop.qualityMetrics.checklistScore ?? ""} onChange={event => updateShop(shopIndex, current => ({ ...current, qualityMetrics: { ...current.qualityMetrics, checklistScore: Number(event.target.value) } }))} /></Label><Label className="grid gap-1.5">NPS score<Input type="number" min="-100" max="100" value={shop.qualityMetrics.npsScore ?? ""} onChange={event => updateShop(shopIndex, current => ({ ...current, qualityMetrics: { ...current.qualityMetrics, npsScore: Number(event.target.value) } }))} /></Label><Label className="grid gap-1.5">NPS responses<Input type="number" min="0" value={shop.qualityMetrics.npsResponses ?? ""} onChange={event => updateShop(shopIndex, current => ({ ...current, qualityMetrics: { ...current.qualityMetrics, npsResponses: Number(event.target.value) } }))} /></Label></div></div>}
          {selectedProfileFor(shopIndex) && <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[700px] text-sm"><thead className="bg-muted/60"><tr><th className="px-3 py-2 text-left">Metric</th><th className="w-28 px-3 py-2 text-right">Weight</th><th className="px-3 py-2 text-right">Target</th><th className="px-3 py-2 text-right">Shop achievement</th></tr></thead><tbody className="divide-y">{selectedProfileFor(shopIndex)!.metricOrder.map(metric => <tr key={metric}><td className="px-3 py-2 font-medium">{selectedProfileFor(shopIndex)!.metricSettings[metric]?.label ?? metric}</td><td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{(Number(selectedProfileFor(shopIndex)!.metricSettings[metric]?.weight ?? 0) * 100).toFixed(1)}%</td><td className="px-3 py-2"><Input className="text-right" type="number" min="0" value={shop.targets[metric] ?? 0} onChange={event => updateShop(shopIndex, current => ({ ...current, targets: { ...current.targets, [metric]: Number(event.target.value) } }))} /></td><td className="px-3 py-2"><Input className="text-right" type="number" min="0" value={shop.achievements[metric] ?? 0} onChange={event => updateShop(shopIndex, current => ({ ...current, achievements: { ...current.achievements, [metric]: Number(event.target.value) } }))} /></td></tr>)}</tbody></table></div>}
          <Accordion type="multiple" className="rounded-md border px-3"><AccordionItem value="representatives" className="border-0"><AccordionTrigger>Representative achievements and targets</AccordionTrigger><AccordionContent className="space-y-4">{shop.representatives.map((representative, representativeIndex) => {
            const targetKey = representativeKey(shopIndex, representative.id);
            return <div key={representative.id} className="space-y-2 rounded-md border p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><Input className="max-w-sm font-medium" value={representative.name} onChange={event => updateShop(shopIndex, current => ({ ...current, representatives: current.representatives.map((rep, index) => index === representativeIndex ? { ...rep, name: event.target.value } : rep) }))} /><div className="flex items-center gap-2"><Switch checked={Boolean(review.targetedRepresentatives[targetKey])} onCheckedChange={checked => setReview(current => current && { ...current, targetedRepresentatives: { ...current.targetedRepresentatives, [targetKey]: checked } })} /><span className="text-sm">Receives an equal share of shop targets</span></div></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{(selectedProfileFor(shopIndex)?.metricOrder ?? []).map(metric => <Label key={metric} className="grid gap-1 text-xs"><span className="truncate">{selectedProfileFor(shopIndex)?.metricSettings[metric]?.label ?? metric}</span><Input type="number" min="0" value={representative.achievements[metric] ?? 0} onChange={event => updateShop(shopIndex, current => ({ ...current, representatives: current.representatives.map((rep, index) => index === representativeIndex ? { ...rep, achievements: { ...rep.achievements, [metric]: Number(event.target.value) } } : rep) }))} /></Label>)}</div></div>;
          })}</AccordionContent></AccordionItem></Accordion>
        </AccordionContent></AccordionItem>)}</Accordion></section>

        {(validation.errors.length > 0 || validation.warnings.length > 0) && <div className="space-y-2">{validation.errors.length > 0 && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"><p className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Fix before importing</p><ul className="list-disc space-y-1 pl-5">{validation.errors.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}{validation.warnings.length > 0 && <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-300"><p className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Review recommended</p><ul className="list-disc space-y-1 pl-5">{validation.warnings.slice(0, 12).map(issue => <li key={issue}>{issue}</li>)}</ul>{validation.warnings.length > 12 && <p className="mt-1">And {validation.warnings.length - 12} more warnings.</p>}</div>}</div>}
        {!validation.errors.length && !validation.warnings.length && <p className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />All import checks passed.</p>}
      </div>}

      <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>{review && <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={loading}>Choose another file</Button>}<Button onClick={applyImport} disabled={!review || loading || validation.errors.length > 0}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Import reviewed data</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
