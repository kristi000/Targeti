
"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
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
  UserRoundCog,
  UsersRound,
  FileClock,
  FileSpreadsheet,
  History,
  SlidersHorizontal,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type Target,
  type PerformanceMetric,
  performanceMetrics,
  Shop,
  type MetricSettings,
  getMetricOrder,
  getInitialTargets,
  getShopMetrics,
  getMonthlyRepresentatives,
  getQuarterKey,
} from "@/lib/types";
import { METRIC_WEIGHTS } from "@/lib/data";
import { useShop } from "./shop-provider";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { getEqualRepresentativeTargets, roundRepresentativeTargets } from "@/lib/representative-targets";
import { formatReportingMonth } from "@/lib/reporting-month";

function SidebarDialogLoading() {
    const t = useTranslations("Sidebar");

    return (
        <div role="status" className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>{t("loadingAction")}</span>
        </div>
    );
}

const ManageShopsDialog = dynamic(() =>
    import("./manage-shops-dialog").then(module => module.ManageShopsDialog),
    { loading: SidebarDialogLoading }
);
const ManageSupervisorsDialog = dynamic(() =>
    import("./manage-supervisors-dialog").then(module => module.ManageSupervisorsDialog),
    { loading: SidebarDialogLoading }
);
const ManageRepresentativesDialog = dynamic(() =>
    import("./manage-representatives-dialog").then(module => module.ManageRepresentativesDialog),
    { loading: SidebarDialogLoading }
);
const ManageImportsDialog = dynamic(() =>
    import("./manage-imports-dialog").then(module => module.ManageImportsDialog),
    { loading: SidebarDialogLoading }
);
const ExcelImportDialog = dynamic(() =>
    import("./excel-import-dialog").then(module => module.ExcelImportDialog),
    { loading: SidebarDialogLoading }
);
const ActivityHistoryDialog = dynamic(() =>
    import("./activity-history-dialog").then(module => module.ActivityHistoryDialog),
    { loading: SidebarDialogLoading }
);
const UserManagementDialog = dynamic(() =>
    import("./user-management-dialog").then(module => module.UserManagementDialog),
    { loading: SidebarDialogLoading }
);
const WeightProfileManagerDialog = dynamic(() =>
    import("./weight-profile-manager-dialog").then(module => module.WeightProfileManagerDialog),
    { loading: SidebarDialogLoading }
);

export function SidebarActions({ activeMonth: activeMonthOverride }: { activeMonth?: string } = {}) {
    const { selectedShop, allMonthlyTargets, updateShop, deleteShop, refreshDataForShop, selectedDatasetId, selectedPerformanceId, requestAchievementEdit, isAdmin, actor } = useShop();
    const pathname = usePathname();
    const locale = useLocale();
    const t = useTranslations("Sidebar");
    const tDialog = useTranslations("Dialogs");
    const tMetric = useTranslations("Metrics");

    const isDashboard = !pathname.includes('/shop/');
    const canEdit = actor.role !== "viewer";
    const latestDataMonth = Object.keys(selectedShop?.monthlyData ?? {}).sort().at(-1) ?? new Date().toISOString().slice(0, 7);
    const activeMonth = activeMonthOverride ?? (selectedDatasetId || latestDataMonth);
    const isHistoricalReport = !isDashboard && selectedPerformanceId !== null;
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
    
    const [isManagementDialogOpen, setIsManagementDialogOpen] = useState(false);
    const [isSupervisorDialogOpen, setIsSupervisorDialogOpen] = useState(false);
    const [isRepresentativeDialogOpen, setIsRepresentativeDialogOpen] = useState(false);
    const [isImportManagementDialogOpen, setIsImportManagementDialogOpen] = useState(false);
    const [isExcelImportDialogOpen, setIsExcelImportDialogOpen] = useState(false);
    const [isActivityHistoryDialogOpen, setIsActivityHistoryDialogOpen] = useState(false);
    const [isUserManagementOpen, setIsUserManagementOpen] = useState(false);
    const [isWeightProfileManagerOpen, setIsWeightProfileManagerOpen] = useState(false);
    const [editingShop, setEditingShop] = useState<Shop | null>(null);
    const weightTotal = editingMetricOrder.reduce((sum, metric) => sum + (editingMetricSettings[metric]?.weight ?? METRIC_WEIGHTS[metric] ?? 0), 0);
    const weightsValid = Math.abs(weightTotal - 1) < 0.00001;

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
        await refreshDataForShop(selectedShop.id, activeMonth);
        setIsSaving(false);
        setIsTargetDialogOpen(false);
    };

    const handleSaveShop = async (shop: Shop) => {
        if (activeMonthOverride && selectedShop?.id === shop.id) {
            const existingMonth = selectedShop.monthlyData?.[activeMonth];
            const representatives = shop.salesRepresentatives ?? [];
            const hiddenRepresentativeIds = new Set((shop.hiddenSalesRepresentatives ?? []).map(representative => representative.id));
            const representativeTargets = Object.fromEntries(representatives.map(rep => [
                rep.id,
                existingMonth?.representativeTargets[rep.id] ?? getEqualRepresentativeTargets(monthlyTargets, metrics, representatives.length),
            ]));
            await updateShop({
                ...shop,
                salesRepresentatives: (selectedShop.salesRepresentatives ?? []).filter(representative => !hiddenRepresentativeIds.has(representative.id)),
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

    return (
        <>
            <div className="flex flex-col gap-1">
                {isDashboard && (
                    <>
                    <p className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">Dashboard actions</p>
                    {canEdit && <>
                        <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start overflow-hidden [&>svg]:shrink-0" onClick={() => setIsExcelImportDialogOpen(true)}><FileSpreadsheet /><span className="truncate" title="Import Excel">Import Excel</span></Button>
                        {isAdmin && <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start overflow-hidden [&>svg]:shrink-0" onClick={() => setIsImportManagementDialogOpen(true)}><FileClock /><span className="truncate" title="Manage imports">Manage imports</span></Button>}
                        {isAdmin && <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start overflow-hidden [&>svg]:shrink-0" onClick={handleOpenManageShops}><Store /><span className="truncate" title={t('manageShops')}>{t('manageShops')}</span></Button>}
                        <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start overflow-hidden [&>svg]:shrink-0" onClick={() => setIsRepresentativeDialogOpen(true)}><UsersRound /><span className="truncate" title="Manage representatives">Manage representatives</span></Button>
                    </>}
                    {isAdmin && <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start overflow-hidden [&>svg]:shrink-0" onClick={() => setIsSupervisorDialogOpen(true)}><UserRoundCog /><span className="truncate" title="Manage supervisors">Manage supervisors</span></Button>}
                    {isAdmin && <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start overflow-hidden [&>svg]:shrink-0" onClick={() => setIsActivityHistoryDialogOpen(true)}><History /><span className="truncate" title="Activity history">Activity history</span></Button>}
                    {isAdmin && <>
                        <p className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">Administration</p>
                        <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start overflow-hidden [&>svg]:shrink-0" onClick={() => setIsUserManagementOpen(true)}><UserRoundCog /><span className="truncate" title="Manage users">Manage users</span></Button>
                        <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start overflow-hidden [&>svg]:shrink-0" onClick={() => setIsWeightProfileManagerOpen(true)}><SlidersHorizontal /><span className="truncate" title="Manage weight profiles">Manage weight profiles</span></Button>
                    </>}
                    {isExcelImportDialogOpen && <ExcelImportDialog open onOpenChange={setIsExcelImportDialogOpen} showTrigger={false} />}
                    {isActivityHistoryDialogOpen && <ActivityHistoryDialog open onOpenChange={setIsActivityHistoryDialogOpen} showTrigger={false} />}
                    {isAdmin && isUserManagementOpen && <UserManagementDialog open onOpenChange={setIsUserManagementOpen} showTrigger={false} />}
                    {isAdmin && isWeightProfileManagerOpen && <WeightProfileManagerDialog open onOpenChange={setIsWeightProfileManagerOpen} />}
                    </>
                )}
                {selectedShop && !isDashboard && canEdit && (
                    <>
                        <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start overflow-hidden [&>svg]:shrink-0" onClick={() => setIsExcelImportDialogOpen(true)}><FileSpreadsheet /><span className="truncate" title="Import Excel">Import Excel</span></Button>
                        <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start overflow-hidden [&>svg]:shrink-0" onClick={onOpenTargetDialog} disabled={isHistoricalReport} title={isHistoricalReport ? "Historical imports are read-only" : undefined}><Settings /><span className="truncate" title={t('setMonthlyTargets')}>{t('setMonthlyTargets')}</span></Button>
                        <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start overflow-hidden [&>svg]:shrink-0" onClick={() => requestAchievementEdit(selectedShop.id, activeMonth)} disabled={isHistoricalReport || monthlyRepresentatives.length === 0} title={isHistoricalReport ? "Historical imports are read-only" : undefined}><Pencil /><span className="truncate" title={t('editAchievements')}>{t('editAchievements')}</span></Button>
                        <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start overflow-hidden [&>svg]:shrink-0" onClick={handleOpenEditShop}><Edit /><span className="truncate" title={t('editShop')}>{t('editShop')}</span></Button>
                        {isExcelImportDialogOpen && <ExcelImportDialog restrictToSelectedShop open onOpenChange={setIsExcelImportDialogOpen} showTrigger={false} />}
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

                    </>
                )}
            </div>
            
            {isManagementDialogOpen && <ManageShopsDialog
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
            />}
            {isAdmin && isSupervisorDialogOpen && <ManageSupervisorsDialog open onOpenChange={setIsSupervisorDialogOpen} />}
            {isRepresentativeDialogOpen && <ManageRepresentativesDialog open onOpenChange={setIsRepresentativeDialogOpen} month={activeMonth} />}
            {isImportManagementDialogOpen && <ManageImportsDialog open onOpenChange={setIsImportManagementDialogOpen} />}
        </>
    );
}
