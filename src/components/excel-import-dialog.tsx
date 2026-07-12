"use client";

import { useRef, useState, type DragEvent } from "react";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { importTargetWorkbook, type ImportedWorkbookData } from "@/lib/excel-import";
import { getShopMetrics, performanceMetrics, type PerformanceData, type Target } from "@/lib/types";
import { EXCEL_METRIC_LABELS } from "@/lib/metric-definitions";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import { useShop } from "./shop-provider";

export function ExcelImportDialog() {
  const { selectedShop, allMonthlyTargets, allPerformanceData, updateShop, updateMonthlyTargets, updatePerformanceData, refreshDataForShop } = useShop();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportedWorkbookData | null>(null);

  const readFile = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    setPreview(null);
    try {
      const customMetricLabels = Object.fromEntries(
        Object.entries(selectedShop?.metricSettings ?? {})
          .filter(([metric, setting]) => metric.startsWith("custom_") && setting?.label?.trim())
          .map(([metric, setting]) => [metric, setting?.label?.trim()]),
      );
      setPreview(await importTargetWorkbook(file, customMetricLabels));
      setFileName(file.name);
    } catch (error) {
      toast({ variant: "destructive", title: "Import failed", description: error instanceof Error ? error.message : "The workbook could not be read." });
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void readFile(event.dataTransfer.files[0]);
  };

  const applyImport = async () => {
    if (!selectedShop || !preview) return;
    setLoading(true);
    try {
      const reps = preview.representatives.map(({ id, name }) => ({ id, name }));
      const currentTargets = allMonthlyTargets[selectedShop.id] ?? {};
      const customMetrics = getShopMetrics(selectedShop, currentTargets).filter(metric => metric.startsWith("custom_"));
      const customActuals = (allPerformanceData[selectedShop.id] ?? []).reduce((totals, day) => {
        day.reps.forEach(rep => {
          totals[rep.repId] ??= {};
          customMetrics.forEach(metric => { totals[rep.repId][metric] = (totals[rep.repId][metric] ?? 0) + (rep[metric] ?? 0); });
        });
        return totals;
      }, {} as Record<string, Record<string, number>>);
      const performance: PerformanceData[] = [{
        date: preview.date,
        reps: preview.representatives.map(rep => ({ repId: rep.id, ...customActuals[rep.id], ...rep.achievements })),
      }];
      const month = preview.date.slice(0, 7);
      const targets = { ...currentTargets, ...preview.targets };
      const representativeTargets = Object.fromEntries(reps.map(rep => [
        rep.id,
        getEqualRepresentativeTargets(targets, getShopMetrics(selectedShop, targets), reps.length),
      ])) as Record<string, Target>;
      await updateShop({
        ...selectedShop,
        name: preview.shopName,
        revenue: preview.revenue,
        salesRepresentatives: reps,
        metricSettings: {
          ...selectedShop.metricSettings,
          ...Object.fromEntries(performanceMetrics.map(metric => [
            metric,
            { ...selectedShop.metricSettings?.[metric], label: EXCEL_METRIC_LABELS[metric] },
          ])),
        },
        monthlyData: {
          ...selectedShop.monthlyData,
          [month]: {
            collection: preview.revenue,
            targets,
            representatives: reps,
            representativeTargets,
            ...(selectedShop.metricSettings && { metricSettings: selectedShop.metricSettings }),
            ...(selectedShop.metricOrder && { metricOrder: selectedShop.metricOrder }),
          },
        },
      });
      await updateMonthlyTargets(selectedShop.id, targets);
      await updatePerformanceData(selectedShop.id, performance);
      await refreshDataForShop(selectedShop.id);
      toast({ title: "Excel data imported", description: `${reps.length} representatives, targets, and achievements were updated.` });
      setOpen(false);
      setPreview(null);
      setFileName("");
    } catch {
      toast({ variant: "destructive", title: "Import failed", description: "The workbook was read, but its data could not be saved." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full justify-start gap-2"><FileSpreadsheet className="h-4 w-4" />Import Excel</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import targets and achievements</DialogTitle>
          <DialogDescription>Drop the One Shop Excel report. You can review it before replacing the selected shop&apos;s data.</DialogDescription>
        </DialogHeader>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={event => void readFile(event.target.files?.[0])} />
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
          onDragEnter={event => { event.preventDefault(); setDragging(true); }}
          onDragOver={event => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/60"}`}
        >
          {loading ? <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" /> : <Upload className="mb-3 h-8 w-8 text-muted-foreground" />}
          <p className="font-medium">{loading ? "Reading workbook…" : "Drop Excel here or click to browse"}</p>
          <p className="mt-1 text-sm text-muted-foreground">.xlsx and .xls files</p>
        </div>
        {preview && (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-muted-foreground">File</p><p className="truncate font-medium">{fileName}</p></div>
              <div><p className="text-muted-foreground">Shop</p><p className="font-medium">{preview.shopName}</p></div>
              <div><p className="text-muted-foreground">Representatives</p><p className="font-medium">{preview.representatives.length}</p></div>
              <div><p className="text-muted-foreground">Achievement date</p><p className="font-medium">{preview.date}</p></div>
              <div><p className="text-muted-foreground">Vlera e të Ardhurave</p><p className="font-medium tabular-nums">{new Intl.NumberFormat("sq-AL", { style: "currency", currency: "ALL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(preview.revenue)}</p></div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">All {performanceMetrics.length} app metrics were found. Importing replaces the selected shop&apos;s current targets and achievements.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={applyImport} disabled={!preview || loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Import data</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
