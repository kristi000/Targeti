"use client";

import { useRef, useState, type DragEvent } from "react";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { handleAddShop, handleSaveExcelPerformanceData, handleSaveTargets, handleUpdateShop } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { importTargetWorkbook, type ImportedWorkbookData } from "@/lib/excel-import";
import { CONSOLIDATED_EXCEL_METRIC_WEIGHTS, EXCEL_METRIC_LABELS } from "@/lib/metric-definitions";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import { getShopMetrics, performanceMetrics, type PerformanceData, type Target } from "@/lib/types";
import { useShop } from "./shop-provider";

export function ExcelImportDialog() {
  const { selectedShop, shops, allMonthlyTargets, reloadData } = useShop();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false); const [dragging, setDragging] = useState(false); const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState(""); const [preview, setPreview] = useState<ImportedWorkbookData | null>(null);

  const readFile = async (file?: File) => {
    if (!file) return;
    setLoading(true); setPreview(null);
    try {
      const customMetricLabels = Object.fromEntries(Object.entries(selectedShop?.metricSettings ?? {})
        .filter(([metric, setting]) => metric.startsWith("custom_") && setting?.label?.trim().toLocaleLowerCase() !== "mixmax")
        .map(([metric, setting]) => [metric, setting?.label?.trim()]));
      setPreview(await importTargetWorkbook(file, customMetricLabels)); setFileName(file.name);
    } catch (error) {
      toast({ variant: "destructive", title: "Import failed", description: error instanceof Error ? error.message : "The workbook could not be read." });
    } finally { setLoading(false); }
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); void readFile(event.dataTransfer.files[0]); };

  const applyImport = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      let representativeCount = 0;
      const importedAt = new Date().toISOString();
      const importId = `excel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      for (const imported of preview.shops) {
        let shop = shops.find(item => item.name.trim().toLocaleLowerCase() === imported.shopName.trim().toLocaleLowerCase());
        if (!shop) {
          const created = await handleAddShop(imported.shopName, "Imported from consolidated Excel report");
          if (!created.success || !created.data) throw new Error(`Could not create ${imported.shopName}.`);
          shop = created.data;
        }
        const duplicateMixMaxMetrics = Object.entries(shop.metricSettings ?? {})
          .filter(([metric, setting]) => metric !== "custom_mixmax" && (
            metric.toLocaleLowerCase().startsWith("custom_mixmax_")
            || setting?.label?.trim().toLocaleLowerCase() === "mixmax"
          ))
          .map(([metric]) => metric);
        Object.keys(allMonthlyTargets[shop.id] ?? shop.monthlyTargets ?? {}).forEach(metric => {
          if (metric !== "custom_mixmax" && metric.toLocaleLowerCase().startsWith("custom_mixmax_") && !duplicateMixMaxMetrics.includes(metric)) {
            duplicateMixMaxMetrics.push(metric);
          }
        });
        const withoutDuplicateMixMax = <T extends Record<string, unknown>>(record: T | undefined) => Object.fromEntries(
          Object.entries(record ?? {}).filter(([metric]) => !duplicateMixMaxMetrics.includes(metric)),
        ) as T;
        const reps = imported.representatives.map(({ id, name }) => ({ id, name })); representativeCount += reps.length;
        const targets = { ...withoutDuplicateMixMax(allMonthlyTargets[shop.id] ?? shop.monthlyTargets), ...imported.targets } as Target;
        const metrics = getShopMetrics(shop, targets);
        const representativeTargets = Object.fromEntries(imported.representatives.map(rep => [
          rep.id,
          withoutDuplicateMixMax(rep.targets ?? getEqualRepresentativeTargets(targets, metrics, reps.length)),
        ])) as Record<string, Target>;
        const month = imported.date.slice(0, 7);
        const collection = imported.revenue;
        const metricSettings = {
          ...withoutDuplicateMixMax(shop.metricSettings),
          ...Object.fromEntries(performanceMetrics.map(metric => [metric, {
            ...shop.metricSettings?.[metric],
            label: EXCEL_METRIC_LABELS[metric],
            weight: CONSOLIDATED_EXCEL_METRIC_WEIGHTS[metric],
          }])),
          custom_mixmax: {
            ...shop.metricSettings?.custom_mixmax,
            label: "MixMax",
            weight: CONSOLIDATED_EXCEL_METRIC_WEIGHTS.custom_mixmax,
          },
        };
        const updatedShop = {
          ...shop, revenue: collection, salesRepresentatives: reps,
          metricSettings,
          metricOrder: shop.metricOrder?.filter(metric => !duplicateMixMaxMetrics.includes(metric)),
          monthlyData: { ...shop.monthlyData, [month]: { collection, targets, representatives: reps, representativeTargets, metricSettings, ...(shop.metricOrder && { metricOrder: shop.metricOrder.filter(metric => !duplicateMixMaxMetrics.includes(metric)) }) } },
        };
        const performance: PerformanceData[] = [{
          date: imported.date,
          importId,
          importName: fileName,
          importedAt,
          targets,
          revenue: collection,
          shopActuals: imported.achievements,
          reps: imported.representatives.map(rep => ({ repId: rep.id, repName: rep.name, ...rep.achievements })),
        }];
        const results = await Promise.all([handleUpdateShop(updatedShop), handleSaveTargets(shop.id, targets), handleSaveExcelPerformanceData(shop.id, performance)]);
        if (results.some(result => !result.success)) throw new Error(`Could not save ${imported.shopName}.`);
      }
      await reloadData();
      toast({ title: "Excel data imported", description: `${preview.shops.length} shops and ${representativeCount} representatives were updated.` });
      setOpen(false); setPreview(null); setFileName("");
    } catch (error) {
      toast({ variant: "destructive", title: "Import failed", description: error instanceof Error ? error.message : "The workbook data could not be saved." });
    } finally { setLoading(false); }
  };

  const representativeCount = preview?.shops.reduce((sum, shop) => sum + shop.representatives.length, 0) ?? 0;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline" className="w-full justify-start gap-2"><FileSpreadsheet className="h-4 w-4" />Import Excel</Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Import targets and achievements</DialogTitle><DialogDescription>Drop a single-shop or consolidated One Shop Excel report and review it before importing.</DialogDescription></DialogHeader>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={event => void readFile(event.target.files?.[0])} />
      <div role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }} onDragEnter={event => { event.preventDefault(); setDragging(true); }} onDragOver={event => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={handleDrop} className={`flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/60"}`}>
        {loading ? <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" /> : <Upload className="mb-3 h-8 w-8 text-muted-foreground" />}<p className="font-medium">{loading ? "Reading workbook…" : "Drop Excel here or click to browse"}</p><p className="mt-1 text-sm text-muted-foreground">.xlsx and .xls files</p>
      </div>
      {preview && <div className="rounded-lg border bg-muted/30 p-4 text-sm"><div className="grid grid-cols-2 gap-3"><div><p className="text-muted-foreground">File</p><p className="truncate font-medium">{fileName}</p></div><div><p className="text-muted-foreground">Shops</p><p className="font-medium">{preview.shops.length}</p></div><div><p className="text-muted-foreground">Representatives</p><p className="font-medium">{representativeCount}</p></div><div><p className="text-muted-foreground">Achievement date</p><p className="font-medium">{preview.shops[0]?.date}</p></div></div><p className="mt-3 text-xs text-muted-foreground">Target and achievement columns were detected automatically. Matching shops are updated and missing shops are created.</p></div>}
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={applyImport} disabled={!preview || loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Import data</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
