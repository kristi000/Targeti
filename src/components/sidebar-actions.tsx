
"use client";

import { useState, useMemo } from "react";
import {
  Settings,
  Check,
  Loader2,
  Pencil,
  Store,
  Edit,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CirclePlus,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type PerformanceData,
  type Target,
  type PerformanceMetric,
  performanceMetrics,
  type RepPerformanceData,
  Shop,
  type MetricSettings,
  getMetricOrder,
  getInitialTargets,
  getShopMetrics,
} from "@/lib/types";
import { METRIC_WEIGHTS } from "@/lib/data";
import { useShop } from "./shop-provider";
import { usePathname } from "next/navigation";
import { ManageShopsDialog } from "./manage-shops-dialog";
import { useTranslations } from "next-intl";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { ScrollArea } from "./ui/scroll-area";
import { ExcelImportDialog } from "./excel-import-dialog";

export function SidebarActions() {
    const { selectedShop, allPerformanceData, allMonthlyTargets, updatePerformanceData, updateMonthlyTargets, updateShop, deleteShop, refreshDataForShop } = useShop();
    const pathname = usePathname();
    const t = useTranslations("Sidebar");
    const tDialog = useTranslations("Dialogs");
    const tMetric = useTranslations("Metrics");

    const isDashboard = !pathname.includes('/shop/');
    
    const performanceData = selectedShop ? allPerformanceData[selectedShop.id] || [] : [];
    const monthlyTargets = selectedShop ? allMonthlyTargets[selectedShop.id] || getInitialTargets() : getInitialTargets();
    const metrics = useMemo(() => getShopMetrics(selectedShop ?? undefined, monthlyTargets), [selectedShop, monthlyTargets]);

    const [editingTargets, setEditingTargets] = useState<Target>(getInitialTargets);
    const [editingMetricSettings, setEditingMetricSettings] = useState<MetricSettings>({});
    const [editingMetricOrder, setEditingMetricOrder] = useState<PerformanceMetric[]>([...performanceMetrics]);
    const [editingRepTargets, setEditingRepTargets] = useState<Record<string, Target>>({});
    const [weightSortDirection, setWeightSortDirection] = useState<"ascending" | "descending" | null>(null);
    const [newMetricName, setNewMetricName] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [isTargetDialogOpen, setIsTargetDialogOpen] = useState(false);
    const [isAchievementDialogOpen, setIsAchievementDialogOpen] = useState(false);
    
    const [isManagementDialogOpen, setIsManagementDialogOpen] = useState(false);
    const [editingShop, setEditingShop] = useState<Shop | null>(null);
    const activeMonth = useMemo(() => performanceData.map(item => item.date.slice(0, 7)).sort().at(-1) ?? new Date().toISOString().slice(0, 7), [performanceData]);
    const weightTotal = editingMetricOrder.reduce((sum, metric) => sum + (editingMetricSettings[metric]?.weight ?? METRIC_WEIGHTS[metric] ?? 0), 0);
    const weightsValid = Math.abs(weightTotal - 1) < 0.00001;

    const initialRepTotals = useMemo(() => {
        const totals: Record<string, Record<PerformanceMetric, number>> = {};
        (selectedShop?.salesRepresentatives || []).forEach(rep => {
            totals[rep.id] = metrics.reduce((acc, metric) => {
                acc[metric] = 0;
                return acc;
            }, {} as Record<PerformanceMetric, number>);
        });

        performanceData.filter(day => day.date.startsWith(activeMonth)).forEach(day => {
            day.reps.forEach(repData => {
                if (totals[repData.repId]) {
                    metrics.forEach(metric => {
                        totals[repData.repId][metric] += repData[metric];
                    });
                }
            });
        });
        return totals;
    }, [performanceData, selectedShop?.salesRepresentatives, metrics, activeMonth]);

    const [editingRepTotals, setEditingRepTotals] = useState<Record<string, Record<PerformanceMetric, number>>>({});

    const handleTargetChange = (metric: PerformanceMetric, value: string) => {
        setEditingTargets((prev) => ({ ...prev, [metric]: Number(value) }));
    };

    const getDefaultMetricLabel = (metric: PerformanceMetric) => {
        if (!metric.startsWith("custom_")) return tMetric(metric);
        const withoutPrefix = metric.slice("custom_".length).replace(/_\d+$/, "");
        return withoutPrefix.replace(/_/g, " ");
    };

    const getSavedMetricLabel = (metric: PerformanceMetric) => selectedShop?.metricSettings?.[metric]?.label?.trim() || getDefaultMetricLabel(metric);
    const getMetricLabel = (metric: PerformanceMetric) => editingMetricSettings[metric]?.label?.trim() || getSavedMetricLabel(metric);

    const handleMetricSettingChange = (metric: PerformanceMetric, field: "label" | "weight", value: string) => {
        setEditingMetricSettings(prev => ({
            ...prev,
            [metric]: {
                ...prev[metric],
                [field]: field === "weight" ? Math.max(0, Number(value)) : value,
            },
        }));
        if (field === "weight") setWeightSortDirection(null);
    };

    const moveMetric = (metric: PerformanceMetric, direction: -1 | 1) => {
        setWeightSortDirection(null);
        setEditingMetricOrder(currentOrder => {
            const currentIndex = currentOrder.indexOf(metric);
            const nextIndex = currentIndex + direction;
            if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) return currentOrder;

            const nextOrder = [...currentOrder];
            [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
            return nextOrder;
        });
    };

    const sortMetricsByWeight = () => {
        const nextDirection = weightSortDirection === "descending" ? "ascending" : "descending";
        setEditingMetricOrder(currentOrder =>
            [...currentOrder].sort((firstMetric, secondMetric) => {
                const firstWeight = editingMetricSettings[firstMetric]?.weight ?? METRIC_WEIGHTS[firstMetric];
                const secondWeight = editingMetricSettings[secondMetric]?.weight ?? METRIC_WEIGHTS[secondMetric];
                return nextDirection === "descending" ? secondWeight - firstWeight : firstWeight - secondWeight;
            })
        );
        setWeightSortDirection(nextDirection);
    };

    const addCustomMetric = () => {
        const label = newMetricName.trim();
        if (!label) return;
        const slug = label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "metric";
        const metric = `custom_${slug}_${Date.now()}` as PerformanceMetric;
        setEditingTargets(current => ({ ...current, [metric]: 0 }));
        setEditingMetricSettings(current => ({ ...current, [metric]: { label, weight: 0.1 } }));
        setEditingMetricOrder(current => [...current, metric]);
        setNewMetricName("");
    };

    const removeCustomMetric = (metric: PerformanceMetric) => {
        if (!metric.startsWith("custom_")) return;
        setEditingTargets(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== metric)) as Target);
        setEditingMetricSettings(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== metric)));
        setEditingMetricOrder(current => current.filter(key => key !== metric));
        setEditingRepTotals(current => Object.fromEntries(Object.entries(current).map(([repId, values]) => [
            repId,
            Object.fromEntries(Object.entries(values).filter(([key]) => key !== metric)),
        ])) as Record<string, Record<PerformanceMetric, number>>);
    };

    const onOpenTargetDialog = () => {
        setEditingTargets(monthlyTargets);
        setEditingMetricSettings(
            metrics.reduce((settings, metric) => {
                settings[metric] = {
                    label: getSavedMetricLabel(metric),
                    weight: selectedShop?.metricSettings?.[metric]?.weight ?? METRIC_WEIGHTS[metric],
                };
                return settings;
            }, {} as MetricSettings)
        );
        setEditingMetricOrder(getMetricOrder(selectedShop?.metricOrder, metrics));
        setEditingRepTargets(selectedShop?.monthlyData?.[activeMonth]?.representativeTargets ?? Object.fromEntries((selectedShop?.salesRepresentatives ?? []).map(rep => [rep.id, Object.fromEntries(metrics.map(metric => [metric, monthlyTargets[metric] / Math.max(selectedShop?.salesRepresentatives?.length ?? 1, 1)])) as Target])));
        setNewMetricName("");
        setWeightSortDirection(null);
        setIsTargetDialogOpen(true);
    };

    const onSaveTargets = async () => {
        if (!selectedShop || !weightsValid) return;
        setIsSaving(true);
        await updateMonthlyTargets(selectedShop.id, editingTargets);
        await updateShop({ ...selectedShop, metricSettings: editingMetricSettings, metricOrder: editingMetricOrder, monthlyData: { ...selectedShop.monthlyData, [activeMonth]: { collection: selectedShop.monthlyData?.[activeMonth]?.collection ?? selectedShop.revenue ?? 0, targets: editingTargets, representativeTargets: editingRepTargets, metricSettings: editingMetricSettings, metricOrder: editingMetricOrder } } });
        await refreshDataForShop(selectedShop.id);
        setIsSaving(false);
        setIsTargetDialogOpen(false);
    };

    const handleAchievementChange = (repId: string, metric: PerformanceMetric, value: string) => {
        setEditingRepTotals(prev => ({
            ...prev,
            [repId]: {
                ...prev[repId],
                [metric]: Number(value)
            }
        }));
    };

    const onOpenAchievementDialog = () => {
        setEditingRepTotals(initialRepTotals);
        setIsAchievementDialogOpen(true);
    };

    const onSaveAchievements = async () => {
        if (!editingRepTotals || !selectedShop) return;
        setIsSaving(true);
        
        const repsData: RepPerformanceData[] = Object.entries(editingRepTotals).map(([repId, metrics]) => ({
            repId,
            ...metrics
        }));

        const newPerformanceDataEntry: PerformanceData = {
            date: `${activeMonth}-01`,
            reps: repsData
        };

        const newPerformanceData = [newPerformanceDataEntry];
        
        await updatePerformanceData(selectedShop.id, newPerformanceData);
        await refreshDataForShop(selectedShop.id);
        setIsSaving(false);
        setIsAchievementDialogOpen(false);
    };

    const handleSaveShop = (shop: Shop) => {
        updateShop(shop);
        setIsManagementDialogOpen(false);
    };

    const handleDeleteShop = (shopId: string) => {
        deleteShop(shopId);
        setIsManagementDialogOpen(false);
    }

    const handleOpenManageShops = () => {
        setEditingShop(null);
        setIsManagementDialogOpen(true);
    }
    
    const handleOpenEditShop = () => {
        if(selectedShop) {
            setEditingShop(selectedShop);
            setIsManagementDialogOpen(true);
        }
    }
        
    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                {isDashboard && (
                    <Button type="button" variant="outline" size="sm" onClick={handleOpenManageShops}>
                            <Store className="mr-2 h-4 w-4" />
                            <span>{t('manageShops')}</span>
                    </Button>
                )}
                {selectedShop && !isDashboard && (
                    <>
                        <div className="w-auto [&_button]:h-9 [&_button]:w-auto">
                            <ExcelImportDialog />
                        </div>
                        <Dialog open={isTargetDialogOpen} onOpenChange={setIsTargetDialogOpen}>
                            <DialogTrigger asChild>
                                    <Button type="button" variant="outline" size="sm" onClick={onOpenTargetDialog}>
                                        <Settings className="mr-2 h-4 w-4" />
                                        <span>{t('setMonthlyTargets')}</span>
                                    </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-2xl">
                            <DialogHeader>
                                <DialogTitle>{tDialog('setTargetsTitle', {shopName: selectedShop.name})}</DialogTitle>
                                <DialogDescription>
                                    {tDialog('setTargetsDescription')}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="flex gap-2">
                                <Input
                                    value={newMetricName}
                                    onChange={event => setNewMetricName(event.target.value)}
                                    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addCustomMetric(); } }}
                                    placeholder="New metric name"
                                    aria-label="New metric name"
                                />
                                <Button type="button" variant="outline" onClick={addCustomMetric} disabled={!newMetricName.trim()}>
                                    <CirclePlus className="mr-2 h-4 w-4" />Add metric
                                </Button>
                            </div>
                            <div className="overflow-x-auto rounded-md border">
                                <table className="w-full min-w-[700px] text-sm">
                                    <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                                        <tr className="border-b">
                                            <th scope="col" className="px-3 py-2 text-left font-medium">{tDialog('metric')}</th>
                                            <th scope="col" className="px-3 py-2 text-right font-medium">{tDialog('monthlyTarget')}</th>
                                            <th
                                                scope="col"
                                                aria-sort={weightSortDirection ?? "none"}
                                                className="px-3 py-2 font-medium"
                                            >
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="ml-auto h-8 gap-1.5 px-2 text-xs uppercase"
                                                    onClick={sortMetricsByWeight}
                                                    aria-label={weightSortDirection === "descending" ? tDialog('sortWeightAscending') : tDialog('sortWeightDescending')}
                                                >
                                                    {tDialog('weight')}
                                                    <ArrowUpDown className="h-3.5 w-3.5" />
                                                </Button>
                                            </th>
                                            <th scope="col" className="px-3 py-2 text-center font-medium">{tDialog('position')}</th>
                                            <th scope="col" className="w-12 px-3 py-2"><span className="sr-only">Remove</span></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {editingMetricOrder.map((metric, index) => (
                                            <tr key={metric} className="hover:bg-muted/40">
                                                <td className="px-3 py-2">
                                                    <Input
                                                        id={`metric-name-${metric}`}
                                                        aria-label={`${tDialog('metric')} ${getMetricLabel(metric)}`}
                                                        value={getMetricLabel(metric)}
                                                        onChange={(e) => handleMetricSettingChange(metric, "label", e.target.value)}
                                                    />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <Input
                                                        id={`target-${metric}`}
                                                        aria-label={`${tDialog('monthlyTarget')} ${getMetricLabel(metric)}`}
                                                        className="ml-auto max-w-40 text-right tabular-nums"
                                                        type="number"
                                                        value={editingTargets[metric] || ''}
                                                        onChange={(e) => handleTargetChange(metric, e.target.value)}
                                                    />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <Input
                                                        id={`metric-weight-${metric}`}
                                                        aria-label={`${tDialog('weight')} ${getMetricLabel(metric)}`}
                                                        className="ml-auto max-w-28 text-right tabular-nums"
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={editingMetricSettings[metric]?.weight ?? METRIC_WEIGHTS[metric]}
                                                        onChange={(e) => handleMetricSettingChange(metric, "weight", e.target.value)}
                                                    />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <div className="flex justify-center gap-1">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            disabled={index === 0}
                                                            aria-label={tDialog('moveMetricUp', { metric: getMetricLabel(metric) })}
                                                            onClick={() => moveMetric(metric, -1)}
                                                        >
                                                            <ArrowUp className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            disabled={index === editingMetricOrder.length - 1}
                                                            aria-label={tDialog('moveMetricDown', { metric: getMetricLabel(metric) })}
                                                            onClick={() => moveMetric(metric, 1)}
                                                        >
                                                            <ArrowDown className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2">
                                                    {metric.startsWith("custom_") && (
                                                        <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => removeCustomMetric(metric)} aria-label={`Remove ${getMetricLabel(metric)}`}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className={`flex items-center gap-2 rounded-md border p-3 text-sm ${weightsValid ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : "border-destructive/40 bg-destructive/5 text-destructive"}`}>
                                {!weightsValid && <AlertTriangle className="h-4 w-4 shrink-0" />}
                                KPI weights total {(weightTotal * 100).toFixed(1)}%. They must total exactly 100% before saving.
                            </div>
                            <Accordion type="single" collapsible className="rounded-md border px-3">
                                <AccordionItem value="representative-targets" className="border-0">
                                    <AccordionTrigger>Individual representative targets</AccordionTrigger>
                                    <AccordionContent><div className="space-y-4">{(selectedShop.salesRepresentatives ?? []).map(rep => <div key={rep.id}><p className="mb-2 font-medium">{rep.name}</p><div className="grid gap-2 sm:grid-cols-2">{editingMetricOrder.map(metric => <Label key={metric} className="grid grid-cols-[1fr_8rem] items-center gap-2 text-xs"><span className="truncate">{getMetricLabel(metric)}</span><Input type="number" className="text-right" value={editingRepTargets[rep.id]?.[metric] ?? ""} onChange={event => setEditingRepTargets(current => ({ ...current, [rep.id]: { ...current[rep.id], [metric]: Number(event.target.value) } }))} /></Label>)}</div></div>)}</div></AccordionContent>
                                </AccordionItem>
                            </Accordion>
                            <DialogFooter>
                                <Button onClick={onSaveTargets} disabled={isSaving || !weightsValid}>
                                {isSaving ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Check className="mr-2 h-4 w-4" />
                                )}
                                {tDialog('saveChanges')}
                                </Button>
                            </DialogFooter>
                            </DialogContent>
                        </Dialog>

                        <Dialog open={isAchievementDialogOpen} onOpenChange={setIsAchievementDialogOpen}>
                            <DialogTrigger asChild>
                                    <Button type="button" variant="outline" size="sm" onClick={onOpenAchievementDialog}>
                                        <Pencil className="mr-2 h-4 w-4" />
                                        <span>{t('editAchievements')}</span>
                                    </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-xl">
                            <DialogHeader>
                                <DialogTitle>{tDialog('editAchievementsTitle', {shopName: selectedShop.name})}</DialogTitle>
                                <DialogDescription>
                                {tDialog('editAchievementsDescription')}
                                </DialogDescription>
                            </DialogHeader>
                            <ScrollArea className="h-[48vh] pr-4">
                            <Accordion type="single" collapsible className="w-full">
                                {(selectedShop.salesRepresentatives || []).map(rep => (
                                    <AccordionItem key={rep.id} value={rep.name}>
                                        <AccordionTrigger>{rep.name}</AccordionTrigger>
                                        <AccordionContent>
                                            <div className="overflow-x-auto rounded-md border">
                                                <table className="w-full min-w-[440px] text-sm">
                                                    <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                                                        <tr className="border-b">
                                                            <th scope="col" className="px-3 py-2 text-left font-medium">{tDialog('metric')}</th>
                                                            <th scope="col" className="px-3 py-2 text-right font-medium">{tDialog('achievement')}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y">
                                                        {initialRepTotals[rep.id] && getMetricOrder(selectedShop.metricOrder, metrics).map((metric) => (
                                                            <tr key={metric} className="hover:bg-muted/40">
                                                            <th scope="row" className="px-3 py-2 text-left font-medium">{getSavedMetricLabel(metric)}</th>
                                                                <td className="px-3 py-2">
                                                                    <Input
                                                                        id={`achievement-${rep.id}-${metric}`}
                                                                        aria-label={getSavedMetricLabel(metric)}
                                                                        className="ml-auto max-w-40 text-right tabular-nums"
                                                                        type="number"
                                                                        value={editingRepTotals[rep.id]?.[metric] || ''}
                                                                        onChange={(e) => handleAchievementChange(rep.id, metric, e.target.value)}
                                                                    />
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                ))}
                            </Accordion>
                            </ScrollArea>
                            <DialogFooter>
                                <Button onClick={onSaveAchievements} disabled={isSaving}>
                                {isSaving ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Check className="mr-2 h-4 w-4" />
                                )}
                                {tDialog('saveChanges')}
                                </Button>
                            </DialogFooter>
                            </DialogContent>
                        </Dialog>
                        
                                <Button type="button" variant="outline" size="sm" onClick={handleOpenEditShop}>
                                    <Edit className="mr-2 h-4 w-4" />
                                    <span>{t('editShop')}</span>
                                </Button>
                    </>
                )}
            </div>
            
            <ManageShopsDialog
                isManagementDialogOpen={isManagementDialogOpen}
                onManagementDialogChange={(open) => {
                    if (!open) setEditingShop(null);
                    setIsManagementDialogOpen(open);
                }}
                editingShop={editingShop}
                setEditingShop={setEditingShop}
                onSave={handleSaveShop}
                onDelete={handleDeleteShop}
            />
        </>
    );
}
