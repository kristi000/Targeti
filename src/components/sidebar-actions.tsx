
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
  MoreHorizontal,
  UserRoundCog,
  UsersRound,
  FileClock,
  FileSpreadsheet,
  History,
  Menu,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  getMonthlyRepresentatives,
  getActivePerformanceData,
  getQuarterKey,
} from "@/lib/types";
import { METRIC_WEIGHTS } from "@/lib/data";
import { useShop } from "./shop-provider";
import { usePathname } from "next/navigation";
import { ManageShopsDialog } from "./manage-shops-dialog";
import { ManageSupervisorsDialog } from "./manage-supervisors-dialog";
import { ManageRepresentativesDialog } from "./manage-representatives-dialog";
import { ManageImportsDialog } from "./manage-imports-dialog";
import { useLocale, useTranslations } from "next-intl";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { ScrollArea } from "./ui/scroll-area";
import { ExcelImportDialog } from "./excel-import-dialog";
import { ActivityHistoryDialog } from "./activity-history-dialog";
import { getEqualRepresentativeTargets, roundRepresentativeTargets } from "@/lib/representative-targets";
import { handleClearAllData } from "@/app/actions";
import { useToast } from "@/hooks/use-toast";
import { formatReportingMonth } from "@/lib/reporting-month";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function SidebarActions({ activeMonth: activeMonthOverride }: { activeMonth?: string } = {}) {
    const { selectedShop, allPerformanceData, allMonthlyTargets, updatePerformanceData, updateShop, deleteShop, refreshDataForShop, reloadData, selectedDatasetId, isAdmin, actor } = useShop();
    const { toast } = useToast();
    const pathname = usePathname();
    const locale = useLocale();
    const t = useTranslations("Sidebar");
    const tDialog = useTranslations("Dialogs");
    const tMetric = useTranslations("Metrics");

    const isDashboard = !pathname.includes('/shop/');
    const canEdit = actor.role !== "viewer";
    
    const performanceData = selectedShop ? allPerformanceData[selectedShop.id] || [] : [];
    const latestDataMonth = useMemo(() => performanceData.map(item => item.date.slice(0, 7)).sort().at(-1) ?? new Date().toISOString().slice(0, 7), [performanceData]);
    const activeMonth = activeMonthOverride ?? (isDashboard && selectedDatasetId ? selectedDatasetId : latestDataMonth);
    const monthlyRepresentatives = useMemo(
        () => selectedShop ? getMonthlyRepresentatives(selectedShop, activeMonth) : [],
        [selectedShop, activeMonth]
    );
    const activeMonthData = selectedShop?.monthlyData?.[activeMonth];
    const activeQuarterSettings = selectedShop?.quarterSettings?.[getQuarterKey(`${activeMonth}-01`)];
    const effectiveMetricSettings = activeMonthData?.metricSettings ?? activeQuarterSettings?.metricSettings ?? selectedShop?.metricSettings;
    const effectiveMetricOrder = activeMonthData?.metricOrder ?? activeQuarterSettings?.metricOrder ?? selectedShop?.metricOrder;
    const monthlyTargets = selectedShop
        ? activeMonthData?.targets ?? allMonthlyTargets[selectedShop.id] ?? getInitialTargets()
        : getInitialTargets();
    const metrics = useMemo(() => getShopMetrics(selectedShop ? { ...selectedShop, metricSettings: effectiveMetricSettings, metricOrder: effectiveMetricOrder } : undefined, monthlyTargets), [selectedShop, monthlyTargets, effectiveMetricSettings, effectiveMetricOrder]);

    const [editingTargets, setEditingTargets] = useState<Target>(getInitialTargets);
    const [editingMetricSettings, setEditingMetricSettings] = useState<MetricSettings>({});
    const [editingMetricOrder, setEditingMetricOrder] = useState<PerformanceMetric[]>([...performanceMetrics]);
    const [editingRepTargets, setEditingRepTargets] = useState<Record<string, Target>>({});
    const [weightSortDirection, setWeightSortDirection] = useState<"ascending" | "descending" | null>(null);
    const [newMetricName, setNewMetricName] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [isTargetDialogOpen, setIsTargetDialogOpen] = useState(false);
    const [isAchievementDialogOpen, setIsAchievementDialogOpen] = useState(false);
    const [isClearingData, setIsClearingData] = useState(false);
    const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
    
    const [isManagementDialogOpen, setIsManagementDialogOpen] = useState(false);
    const [isSupervisorDialogOpen, setIsSupervisorDialogOpen] = useState(false);
    const [isRepresentativeDialogOpen, setIsRepresentativeDialogOpen] = useState(false);
    const [isImportManagementDialogOpen, setIsImportManagementDialogOpen] = useState(false);
    const [isExcelImportDialogOpen, setIsExcelImportDialogOpen] = useState(false);
    const [isActivityHistoryDialogOpen, setIsActivityHistoryDialogOpen] = useState(false);
    const [editingShop, setEditingShop] = useState<Shop | null>(null);
    const weightTotal = editingMetricOrder.reduce((sum, metric) => sum + (editingMetricSettings[metric]?.weight ?? METRIC_WEIGHTS[metric] ?? 0), 0);
    const weightsValid = Math.abs(weightTotal - 1) < 0.00001;

    const initialRepTotals = useMemo(() => {
        const totals: Record<string, Record<PerformanceMetric, number>> = {};
        monthlyRepresentatives.forEach(rep => {
            totals[rep.id] = metrics.reduce((acc, metric) => {
                acc[metric] = 0;
                return acc;
            }, {} as Record<PerformanceMetric, number>);
        });

        getActivePerformanceData(performanceData).filter(day => day.date.startsWith(activeMonth)).forEach(day => {
            day.reps.forEach(repData => {
                if (totals[repData.repId]) {
                    metrics.forEach(metric => {
                        totals[repData.repId][metric] += repData[metric];
                    });
                }
            });
        });
        return totals;
    }, [performanceData, monthlyRepresentatives, metrics, activeMonth]);

    const [editingRepTotals, setEditingRepTotals] = useState<Record<string, Record<PerformanceMetric, number>>>({});

    const handleTargetChange = (metric: PerformanceMetric, value: string) => {
        setEditingTargets((prev) => ({ ...prev, [metric]: Number(value) }));
    };

    const getDefaultMetricLabel = (metric: PerformanceMetric) => {
        if (!metric.startsWith("custom_")) return tMetric(metric);
        const withoutPrefix = metric.slice("custom_".length).replace(/_\d+$/, "");
        return withoutPrefix.replace(/_/g, " ");
    };

    const getSavedMetricLabel = (metric: PerformanceMetric) => effectiveMetricSettings?.[metric]?.label?.trim() || getDefaultMetricLabel(metric);
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
        setEditingRepTargets(current => Object.fromEntries(monthlyRepresentatives.map(rep => [rep.id, { ...current[rep.id], [metric]: 0 }])));
        setNewMetricName("");
    };

    const removeCustomMetric = (metric: PerformanceMetric) => {
        if (!metric.startsWith("custom_")) return;
        setEditingTargets(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== metric)) as Target);
        setEditingMetricSettings(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== metric)));
        setEditingMetricOrder(current => current.filter(key => key !== metric));
        setEditingRepTargets(current => Object.fromEntries(Object.entries(current).map(([repId, values]) => [
            repId,
            Object.fromEntries(Object.entries(values).filter(([key]) => key !== metric)),
        ])) as Record<string, Target>);
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
                    weight: effectiveMetricSettings?.[metric]?.weight ?? METRIC_WEIGHTS[metric],
                };
                return settings;
            }, {} as MetricSettings)
        );
        setEditingMetricOrder(getMetricOrder(effectiveMetricOrder, metrics));
        const savedRepresentativeTargets = selectedShop?.monthlyData?.[activeMonth]?.representativeTargets;
        setEditingRepTargets(savedRepresentativeTargets
            ? Object.fromEntries(Object.entries(savedRepresentativeTargets).map(([repId, targets]) => [repId, roundRepresentativeTargets(targets)]))
            : Object.fromEntries(monthlyRepresentatives.map(rep => [rep.id, getEqualRepresentativeTargets(monthlyTargets, metrics, monthlyRepresentatives.length)])));
        setNewMetricName("");
        setWeightSortDirection(null);
        setIsTargetDialogOpen(true);
    };

    const onSaveTargets = async () => {
        if (!selectedShop || !weightsValid) return;
        setIsSaving(true);
        const roundedRepresentativeTargets = Object.fromEntries(Object.entries(editingRepTargets).map(([repId, targets]) => [repId, roundRepresentativeTargets(targets)]));
        const disabledMetrics = new Set(selectedShop.disabledMetrics ?? []);
        const preservedDisabledSettings = Object.fromEntries(Object.entries(effectiveMetricSettings ?? {}).filter(([metric]) => disabledMetrics.has(metric as PerformanceMetric)));
        const metricSettings = { ...preservedDisabledSettings, ...editingMetricSettings };
        const preservedDisabledOrder = (effectiveMetricOrder ?? []).filter(metric => disabledMetrics.has(metric));
        const metricOrder = [...editingMetricOrder, ...preservedDisabledOrder.filter(metric => !editingMetricOrder.includes(metric))];
        const existingMonth = selectedShop.monthlyData?.[activeMonth];
        await updateShop({ ...selectedShop, monthlyData: { ...selectedShop.monthlyData, [activeMonth]: { ...existingMonth, collection: existingMonth?.collection ?? selectedShop.revenue ?? 0, targets: editingTargets, representatives: monthlyRepresentatives, representativeTargets: roundedRepresentativeTargets, metricSettings, metricOrder } } });
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

        if (!selectedShop.monthlyData?.[activeMonth]?.representatives) {
            const existingMonth = selectedShop.monthlyData?.[activeMonth];
            const representativeTargets = existingMonth?.representativeTargets ?? Object.fromEntries(monthlyRepresentatives.map(rep => [
                rep.id,
                getEqualRepresentativeTargets(monthlyTargets, metrics, monthlyRepresentatives.length),
            ]));
            await updateShop({
                ...selectedShop,
                monthlyData: {
                    ...selectedShop.monthlyData,
                    [activeMonth]: {
                        collection: existingMonth?.collection ?? selectedShop.revenue ?? 0,
                        targets: existingMonth?.targets ?? monthlyTargets,
                        representatives: monthlyRepresentatives,
                        representativeTargets,
                        metricSettings: existingMonth?.metricSettings ?? selectedShop.metricSettings,
                        metricOrder: existingMonth?.metricOrder ?? selectedShop.metricOrder,
                    },
                },
            });
        }

        await updatePerformanceData(selectedShop.id, newPerformanceData);
        await refreshDataForShop(selectedShop.id);
        setIsSaving(false);
        setIsAchievementDialogOpen(false);
    };

    const handleSaveShop = async (shop: Shop) => {
        if (activeMonthOverride && selectedShop?.id === shop.id) {
            const existingMonth = selectedShop.monthlyData?.[activeMonth];
            const representatives = shop.salesRepresentatives ?? [];
            const representativeTargets = Object.fromEntries(representatives.map(rep => [
                rep.id,
                existingMonth?.representativeTargets[rep.id] ?? getEqualRepresentativeTargets(monthlyTargets, metrics, representatives.length),
            ]));
            await updateShop({
                ...shop,
                salesRepresentatives: selectedShop.salesRepresentatives,
                monthlyData: {
                    ...selectedShop.monthlyData,
                    [activeMonth]: {
                        collection: existingMonth?.collection ?? selectedShop.revenue ?? 0,
                        targets: existingMonth?.targets ?? monthlyTargets,
                        representatives,
                        representativeTargets,
                        metricSettings: shop.monthlyData?.[activeMonth]?.metricSettings ?? existingMonth?.metricSettings ?? selectedShop.metricSettings,
                        metricOrder: shop.monthlyData?.[activeMonth]?.metricOrder ?? existingMonth?.metricOrder ?? selectedShop.metricOrder,
                    },
                },
            });
        } else {
            await updateShop(shop);
        }
    };

    const handleDeleteShop = async (shopId: string) => {
        await deleteShop(shopId);
    }

    const handleOpenManageShops = () => {
        setEditingShop(null);
        setIsManagementDialogOpen(true);
    }
    
    const handleOpenEditShop = () => {
        if(selectedShop) {
            setEditingShop({ ...selectedShop, salesRepresentatives: monthlyRepresentatives });
            setIsManagementDialogOpen(true);
        }
    }

    const clearAllData = async () => {
        setIsClearingData(true);
        try {
            const result = await handleClearAllData();
            if (!result.success) throw new Error(result.error);
            await reloadData();
            toast({ title: "All data cleared", description: "All shops, targets, achievements, and bonus snapshots were deleted." });
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Could not clear data",
                description: error instanceof Error ? error.message : "Please try again.",
            });
        } finally {
            setIsClearingData(false);
        }
    };
        
    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                {isDashboard && (
                    <>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button type="button" size="sm" className="h-9 gap-2 px-3 shadow-sm" aria-label="Open dashboard menu">
                                <Menu className="h-4 w-4" />
                                <span>Menu</span>
                                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Dashboard actions</DropdownMenuLabel>
                            {canEdit && <>
                                <DropdownMenuItem onSelect={() => setIsExcelImportDialogOpen(true)}>
                                    <FileSpreadsheet />Import Excel
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setIsImportManagementDialogOpen(true)}>
                                    <FileClock />Manage imports
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={handleOpenManageShops}>
                                    <Store />{t('manageShops')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setIsRepresentativeDialogOpen(true)}>
                                    <UsersRound />Manage representatives
                                </DropdownMenuItem>
                            </>}
                            {isAdmin && <DropdownMenuItem onSelect={() => setIsSupervisorDialogOpen(true)}>
                                <UserRoundCog />Manage supervisors
                            </DropdownMenuItem>}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setIsActivityHistoryDialogOpen(true)}>
                                <History />Activity history
                            </DropdownMenuItem>
                            {isAdmin && <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={isClearingData || !selectedShop} onSelect={() => setIsClearDialogOpen(true)}>
                                <Trash2 className="mr-2 h-4 w-4" />Clear all data
                            </DropdownMenuItem>
                            </>}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <ExcelImportDialog open={isExcelImportDialogOpen} onOpenChange={setIsExcelImportDialogOpen} showTrigger={false} />
                    <ActivityHistoryDialog open={isActivityHistoryDialogOpen} onOpenChange={setIsActivityHistoryDialogOpen} showTrigger={false} />
                    {isAdmin && <>
                    <AlertDialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Clear all application data?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This permanently deletes every shop, target, achievement, representative, and finalized bonus snapshot. This action cannot be undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { setIsClearDialogOpen(false); void clearAllData(); }}>
                                    <Trash2 className="mr-2 h-4 w-4" />Delete everything
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    </>}
                    </>
                )}
                {selectedShop && !isDashboard && canEdit && (
                    <>
                        <div className="w-auto [&_button]:h-9 [&_button]:w-auto">
                            <ExcelImportDialog restrictToSelectedShop />
                        </div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button type="button" variant="outline" size="sm">
                                    <Settings className="mr-2 h-4 w-4" />Manage shop<MoreHorizontal className="ml-2 h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuItem onSelect={onOpenTargetDialog}><Settings className="mr-2 h-4 w-4" />{t('setMonthlyTargets')}</DropdownMenuItem>
                                <DropdownMenuItem onSelect={onOpenAchievementDialog}><Pencil className="mr-2 h-4 w-4" />{t('editAchievements')}</DropdownMenuItem>
                                <DropdownMenuItem onSelect={handleOpenEditShop}><Edit className="mr-2 h-4 w-4" />{t('editShop')}</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Dialog open={isTargetDialogOpen} onOpenChange={setIsTargetDialogOpen}>
                            <DialogContent className="sm:max-w-2xl">
                            <DialogHeader>
                                <DialogTitle>{tDialog('setTargetsTitle', {shopName: selectedShop.name})}</DialogTitle>
                                <DialogDescription>
                                    {tDialog('setTargetsDescription', { month: formatReportingMonth(activeMonth, locale) })}
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
                                                        max="100"
                                                        value={Number(((editingMetricSettings[metric]?.weight ?? METRIC_WEIGHTS[metric]) * 100).toFixed(2))}
                                                        onChange={(e) => handleMetricSettingChange(metric, "weight", String(Number(e.target.value) / 100))}
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
                                    <AccordionContent><div className="space-y-4">{monthlyRepresentatives.map(rep => <div key={rep.id}><p className="mb-2 font-medium">{rep.name}</p><div className="grid gap-2 sm:grid-cols-2">{editingMetricOrder.map(metric => <Label key={metric} className="grid grid-cols-[1fr_8rem] items-center gap-2 text-xs"><span className="truncate">{getMetricLabel(metric)}</span><Input type="number" step="1" className="text-right" value={editingRepTargets[rep.id]?.[metric] ?? ""} onChange={event => setEditingRepTargets(current => ({ ...current, [rep.id]: { ...current[rep.id], [metric]: Number(event.target.value) } }))} onBlur={() => setEditingRepTargets(current => ({ ...current, [rep.id]: { ...current[rep.id], [metric]: Math.round(current[rep.id]?.[metric] ?? 0) } }))} /></Label>)}</div></div>)}</div></AccordionContent>
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
                            <DialogContent className="sm:max-w-xl">
                            <DialogHeader>
                                <DialogTitle>{tDialog('editAchievementsTitle', {shopName: selectedShop.name})}</DialogTitle>
                                <DialogDescription>
                                {tDialog('editAchievementsDescription')}
                                </DialogDescription>
                            </DialogHeader>
                            <ScrollArea className="h-[48vh] pr-4">
                            <Accordion type="single" collapsible className="w-full">
                                {monthlyRepresentatives.map(rep => (
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
                representativeMonth={activeMonthOverride}
                settingsMonth={activeMonth}
            />
            {isAdmin && <ManageSupervisorsDialog open={isSupervisorDialogOpen} onOpenChange={setIsSupervisorDialogOpen} />}
            <ManageRepresentativesDialog open={isRepresentativeDialogOpen} onOpenChange={setIsRepresentativeDialogOpen} month={activeMonth} />
            <ManageImportsDialog open={isImportManagementDialogOpen} onOpenChange={setIsImportManagementDialogOpen} />
        </>
    );
}
