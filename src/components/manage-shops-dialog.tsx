"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  AlertTriangle,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Store,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { handleApplyMetricWeightsToShops, handleRemoveMetricFromShops, handleRestoreMetricToShops } from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useShop } from "@/components/shop-provider";
import { useToast } from "@/hooks/use-toast";
import { getMetricWeight } from "@/lib/data";
import { EXCEL_METRIC_LABELS, getCustomMetricLabel } from "@/lib/metric-definitions";
import { getQuarterKey, getShopMetrics, type PerformanceMetric, type SalesRepresentative, type Shop, type Target } from "@/lib/types";

type ManageShopsDialogProps = {
  isManagementDialogOpen: boolean;
  onManagementDialogChange: (open: boolean) => void;
  editingShop: Shop | null;
  setEditingShop: (shop: Shop | null) => void;
  onSave: (shop: Shop) => void | Promise<void>;
  onDelete: (shopId: string) => void | Promise<void>;
  representativeMonth?: string;
  settingsMonth: string;
};

const normalize = (value: string) => value.trim().toLocaleLowerCase();
type BulkMetricState = { selectedShopIds: string[]; metrics: PerformanceMetric[]; values: Record<PerformanceMetric, string>; labels: Record<PerformanceMetric, string> };

export function ManageShopsDialog({
  isManagementDialogOpen,
  onManagementDialogChange,
  editingShop,
  setEditingShop,
  onSave,
  onDelete,
  representativeMonth,
  settingsMonth,
}: ManageShopsDialogProps) {
  const { shops, supervisors, addShop, allMonthlyTargets, refreshDataForShop, loading, isAdmin } = useShop();
  const { toast } = useToast();
  const t = useTranslations("Dialogs");
  const [query, setQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newShopName, setNewShopName] = useState("");
  const [newShopDescription, setNewShopDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [bulkMetrics, setBulkMetrics] = useState<BulkMetricState | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [removingMetric, setRemovingMetric] = useState<PerformanceMetric | null>(null);
  const [restoringMetric, setRestoringMetric] = useState<PerformanceMetric | null>(null);
  const supervisorsById = useMemo(() => new Map(supervisors.map(supervisor => [supervisor.id, supervisor.name])), [supervisors]);

  const filteredShops = useMemo(() => {
    const normalizedQuery = normalize(query);
    return [...shops]
      .filter(shop => !normalizedQuery || normalize(`${shop.name} ${shop.description ?? ""} ${supervisorsById.get(shop.supervisorId ?? "") ?? ""}`).includes(normalizedQuery))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [query, shops, supervisorsById]);

  const newNameExists = shops.some(shop => normalize(shop.name) === normalize(newShopName));
  const editNameExists = editingShop
    ? shops.some(shop => shop.id !== editingShop.id && normalize(shop.name) === normalize(editingShop.name))
    : false;
  const representativeNames = editingShop?.salesRepresentatives?.map(rep => normalize(rep.name)) ?? [];
  const hasInvalidRepresentatives = representativeNames.some(name => !name)
    || new Set(representativeNames).size !== representativeNames.length;
  const metricConfiguration = editingShop ? getMetricConfiguration(editingShop, settingsMonth, allMonthlyTargets[editingShop.id]) : undefined;
  const weightsValid = metricConfiguration ? Math.abs(metricConfiguration.totalWeight - 1) < 0.00001 : true;

  const resetAddForm = () => {
    setShowAddForm(false);
    setNewShopName("");
    setNewShopDescription("");
  };

  const handleDialogChange = (open: boolean) => {
    if (!open) {
      setEditingShop(null);
      setQuery("");
      setBulkMetrics(null);
      resetAddForm();
    }
    onManagementDialogChange(open);
  };

  const handleAddShop = async () => {
    if (!newShopName.trim() || newNameExists) return;
    await addShop(newShopName.trim(), newShopDescription.trim());
    resetAddForm();
  };

  const updateEditingShop = (updater: (shop: Shop) => Shop) => {
    if (editingShop) setEditingShop(updater(editingShop));
  };

  const handleSaveShop = async () => {
    if (!editingShop || !editingShop.name.trim() || editNameExists || hasInvalidRepresentatives || !weightsValid) return;
    setSaving(true);
    try {
      await onSave({ ...editingShop, name: editingShop.name.trim(), description: editingShop.description?.trim() });
      setEditingShop(null);
    } finally {
      setSaving(false);
    }
  };

  const handleAddRepresentative = () => {
    updateEditingShop(shop => ({
      ...shop,
      salesRepresentatives: [
        ...(shop.salesRepresentatives ?? []),
        { id: `rep${Date.now()}`, name: "" },
      ],
    }));
  };

  const handleRepresentativeChange = (index: number, value: string) => {
    updateEditingShop(shop => ({
      ...shop,
      salesRepresentatives: (shop.salesRepresentatives ?? []).map((rep, repIndex) => repIndex === index ? { ...rep, name: value } : rep),
    }));
  };

  const handleRemoveRepresentative = (index: number) => {
    updateEditingShop(shop => ({
      ...shop,
      salesRepresentatives: (shop.salesRepresentatives ?? []).filter((_, repIndex) => repIndex !== index),
    }));
  };

  const handleMetricWeightChange = (metric: PerformanceMetric, percentage: number) => {
    updateEditingShop(shop => {
      const configuration = getMetricConfiguration(shop, settingsMonth, allMonthlyTargets[shop.id]);
      const metricSettings = {
        ...configuration.metricSettings,
        [metric]: {
          ...configuration.metricSettings?.[metric],
          weight: Math.max(0, Math.min(percentage, 100)) / 100,
        },
      };
      const quarterKey = getQuarterKey(`${settingsMonth}-01`);
      const monthlyData = shop.monthlyData?.[settingsMonth];

      return {
        ...shop,
        quarterSettings: {
          ...shop.quarterSettings,
          [quarterKey]: { metricSettings, metricOrder: configuration.metrics },
        },
        ...(monthlyData && {
          monthlyData: {
            ...shop.monthlyData,
            [settingsMonth]: { ...monthlyData, metricSettings, metricOrder: configuration.metrics },
          },
        }),
      };
    });
  };

  const buildBulkMetricState = (selectedShopIds: string[]): BulkMetricState => {
    const selectedShops = shops.filter(shop => selectedShopIds.includes(shop.id));
    const configurations = selectedShops.map(shop => getMetricConfiguration(shop, settingsMonth, allMonthlyTargets[shop.id]));
    const metrics = Array.from(new Set(configurations.flatMap(configuration => configuration.metrics)));
    const values = {} as Record<PerformanceMetric, string>;
    const labels = {} as Record<PerformanceMetric, string>;

    metrics.forEach(metric => {
      const configuredWeights = configurations.map(configuration => configuration.metrics.includes(metric)
        ? (configuration.metricSettings?.[metric]?.weight ?? getMetricWeight(metric)) * 100
        : undefined);
      const firstWeight = configuredWeights[0];
      const weightsMatch = firstWeight !== undefined && configuredWeights.every(weight => weight !== undefined && Math.abs(weight - firstWeight) < 0.00001);
      values[metric] = weightsMatch ? String(Number(firstWeight.toFixed(2))) : "";
      const settings = configurations.find(configuration => configuration.metricSettings?.[metric])?.metricSettings;
      labels[metric] = getMetricLabel(metric, settings);
    });
    return { selectedShopIds, metrics, values, labels };
  };

  const handleOpenBulkMetrics = () => {
    setBulkMetrics({ selectedShopIds: [], metrics: [], values: {} as Record<PerformanceMetric, string>, labels: {} as Record<PerformanceMetric, string> });
  };

  const handleApplyBulkWeights = async () => {
    if (!bulkMetrics?.selectedShopIds.length) return;
    const weights = Object.fromEntries(bulkMetrics.metrics.map(metric => [metric, Number(bulkMetrics.values[metric]) / 100]));
    setBulkSaving(true);
    try {
      const result = await handleApplyMetricWeightsToShops(settingsMonth, weights, bulkMetrics.selectedShopIds);
      if (!result.success) throw new Error(result.error);
      await refreshDataForShop(bulkMetrics.selectedShopIds[0]);
      toast({ title: t("bulkWeightsSaved"), description: t("bulkWeightsSavedDescription", { count: result.count }) });
      setBulkMetrics(null);
    } catch (error) {
      toast({ variant: "destructive", title: t("bulkUpdateFailed"), description: error instanceof Error ? error.message : t("tryAgain") });
    } finally {
      setBulkSaving(false);
    }
  };

  const handleRemoveMetric = async (metric: PerformanceMetric) => {
    if (!bulkMetrics?.selectedShopIds.length) return;
    setRemovingMetric(metric);
    try {
      const result = await handleRemoveMetricFromShops(metric, bulkMetrics.selectedShopIds);
      if (!result.success) throw new Error(result.error);
      await refreshDataForShop(bulkMetrics.selectedShopIds[0]);
      setBulkMetrics(current => current && {
        ...current,
        metrics: current.metrics.filter(item => item !== metric),
        values: omitMetric(current.values, metric),
        labels: omitMetric(current.labels, metric),
      });
      toast({ title: t("metricRemoved"), description: t("metricRemovedDescription", { metric: bulkMetrics?.labels[metric] ?? metric, count: result.shops }) });
    } catch (error) {
      toast({ variant: "destructive", title: t("metricRemovalFailed"), description: error instanceof Error ? error.message : t("tryAgain") });
    } finally {
      setRemovingMetric(null);
    }
  };

  const handleRestoreMetric = async (metric: PerformanceMetric) => {
    if (!bulkMetrics?.selectedShopIds.length) return;
    const shopIds = bulkMetrics.selectedShopIds.filter(shopId => shops.find(shop => shop.id === shopId)?.disabledMetrics?.includes(metric));
    if (!shopIds.length) return;
    setRestoringMetric(metric);
    try {
      const result = await handleRestoreMetricToShops(metric, shopIds);
      if (!result.success) throw new Error(result.error);
      await refreshDataForShop(shopIds[0]);
      setBulkMetrics(current => current && ({
        ...current,
        metrics: current.metrics.includes(metric) ? current.metrics : [...current.metrics, metric],
        values: { ...current.values, [metric]: current.values[metric] ?? String(getMetricWeight(metric) * 100) },
        labels: { ...current.labels, [metric]: current.labels[metric] ?? getMetricLabel(metric, undefined) },
      }));
      toast({ title: t("metricRestored"), description: t("metricRestoredDescription", { metric: getMetricLabel(metric, undefined), count: result.shops }) });
    } catch (error) {
      toast({ variant: "destructive", title: t("metricRestoreFailed"), description: error instanceof Error ? error.message : t("tryAgain") });
    } finally {
      setRestoringMetric(null);
    }
  };

  return (
    <Dialog open={isManagementDialogOpen} onOpenChange={handleDialogChange}>
      <DialogContent className="max-h-[92vh] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        {editingShop ? (
          <ShopEditor
            shop={editingShop}
            representativeMonth={representativeMonth}
            saving={saving}
            nameExists={editNameExists}
            hasInvalidRepresentatives={hasInvalidRepresentatives}
            metricConfiguration={metricConfiguration!}
            settingsMonth={settingsMonth}
            onBack={() => setEditingShop(null)}
            onShopChange={updateEditingShop}
            onAddRepresentative={handleAddRepresentative}
            onRepresentativeChange={handleRepresentativeChange}
            onRemoveRepresentative={handleRemoveRepresentative}
            onMetricWeightChange={handleMetricWeightChange}
            onSave={handleSaveShop}
          />
        ) : bulkMetrics ? (
          <BulkMetricEditor
            state={bulkMetrics}
            shops={shops}
            settingsMonth={settingsMonth}
            saving={bulkSaving}
            removingMetric={removingMetric}
            restoringMetric={restoringMetric}
            onBack={() => setBulkMetrics(null)}
            onShopSelectionChange={selectedShopIds => setBulkMetrics(buildBulkMetricState(selectedShopIds))}
            onChange={(metric, value) => setBulkMetrics(current => current && ({ ...current, values: { ...current.values, [metric]: value } }))}
            onApply={handleApplyBulkWeights}
            onRemove={handleRemoveMetric}
            onRestore={handleRestoreMetric}
            canDelete={isAdmin}
          />
        ) : (
          <>
            <DialogHeader className="border-b border-slate-200 bg-slate-50 px-5 py-4 pr-12 text-left sm:px-6">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-emerald-700 p-2 text-white"><Store className="h-5 w-5" /></span>
                <div>
                  <DialogTitle>{t("manageShopsTitle")}</DialogTitle>
                  <DialogDescription className="mt-1">{t("manageShopsDescription")}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="relative w-full sm:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("searchShops")} className="pl-9" />
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className="text-sm text-slate-500">{t("shopCount", { count: shops.length })}</span>
                  <Button type="button" variant="outline" size="sm" onClick={handleOpenBulkMetrics} disabled={!shops.length}>
                    <Layers3 className="mr-2 h-4 w-4" />{t("bulkMetrics")}
                  </Button>
                  <Button type="button" size="sm" onClick={() => setShowAddForm(current => !current)}>
                    <Plus className="mr-2 h-4 w-4" />{t("addShop")}
                  </Button>
                </div>
              </div>

              {showAddForm && (
                <div className="border-b border-emerald-200 bg-emerald-50/60 px-4 py-4 sm:px-6">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-end">
                    <Label className="grid gap-1.5">{t("shopName")}
                      <Input value={newShopName} onChange={event => setNewShopName(event.target.value)} placeholder={t("newShopNamePlaceholder")} autoFocus />
                    </Label>
                    <Label className="grid gap-1.5">{t("description")}
                      <Input value={newShopDescription} onChange={event => setNewShopDescription(event.target.value)} placeholder={t("newShopDescriptionPlaceholder")} />
                    </Label>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={resetAddForm}>{t("cancel")}</Button>
                      <Button type="button" onClick={handleAddShop} disabled={!newShopName.trim() || newNameExists || loading}>
                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}{t("add")}
                      </Button>
                    </div>
                  </div>
                  {newNameExists && <p className="mt-2 text-xs font-medium text-destructive">{t("duplicateShopName")}</p>}
                </div>
              )}

              <ScrollArea className="h-[min(60vh,520px)]">
                {filteredShops.length ? (
                  <>
                    <div className="hidden md:block">
                      <table className="w-full border-collapse text-sm">
                        <thead className="sticky top-0 z-10 bg-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-700">
                          <tr>
                            <th className="w-14 border-b border-r border-slate-300 px-3 py-2 text-center">#</th>
                            <th className="border-b border-r border-slate-300 px-3 py-2 text-left">{t("shopName")}</th>
                            <th className="border-b border-r border-slate-300 px-3 py-2 text-left">{t("description")}</th>
                            <th className="w-36 border-b border-r border-slate-300 px-3 py-2 text-left">{t("salesReps")}</th>
                            <th className="w-40 border-b border-slate-300 px-3 py-2 text-right">{t("actions")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredShops.map((shop, index) => (
                            <tr key={shop.id} className="bg-white even:bg-slate-50/70 hover:bg-emerald-50/70">
                              <td className="border-b border-r border-slate-200 bg-slate-100 px-3 py-3 text-center font-mono text-xs text-slate-500">{index + 1}</td>
                              <th scope="row" className="border-b border-r border-slate-200 px-3 py-3 text-left"><span className="block font-medium text-slate-900">{shop.name}</span><span className="mt-0.5 block text-xs font-normal text-slate-500">Supervisor: {supervisorsById.get(shop.supervisorId ?? "") ?? "Unassigned"}</span></th>
                              <td className="max-w-sm truncate border-b border-r border-slate-200 px-3 py-3 text-slate-500">{shop.description || "—"}</td>
                              <td className="border-b border-r border-slate-200 px-3 py-3 text-slate-600"><span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" />{shop.salesRepresentatives?.length ?? 0}</span></td>
                              <td className="border-b border-slate-200 px-3 py-2"><ShopActions shop={shop} onEdit={setEditingShop} onDelete={onDelete} canDelete={isAdmin} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="divide-y md:hidden">
                      {filteredShops.map(shop => (
                        <div key={shop.id} className="space-y-2 p-4">
                          <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{shop.name}</p><p className="mt-0.5 text-xs text-muted-foreground">Supervisor: {supervisorsById.get(shop.supervisorId ?? "") ?? "Unassigned"}</p><p className="mt-0.5 text-sm text-muted-foreground">{shop.description || "—"}</p></div><span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{shop.salesRepresentatives?.length ?? 0}</span></div>
                          <ShopActions shop={shop} onEdit={setEditingShop} onDelete={onDelete} canDelete={isAdmin} />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex h-56 flex-col items-center justify-center gap-2 text-center text-slate-500"><Search className="h-8 w-8 text-slate-300" /><p className="font-medium">{t("noMatchingShops")}</p><p className="text-sm">{t("tryAnotherSearch")}</p></div>
                )}
              </ScrollArea>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type ShopActionsProps = {
  shop: Shop;
  onEdit: (shop: Shop) => void;
  onDelete: (shopId: string) => void | Promise<void>;
  canDelete: boolean;
};

function ShopActions({ shop, onEdit, onDelete, canDelete }: ShopActionsProps) {
  const t = useTranslations("Dialogs");
  return <div className="flex justify-end gap-1">
    <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => onEdit(shop)}><Pencil className="h-3.5 w-3.5" />{t("edit")}</Button>
    {canDelete && <AlertDialog>
      <AlertDialogTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={`${t("delete")} ${shop.name}`} className="text-destructive hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t("deleteShopTitle", { shopName: shop.name })}</AlertDialogTitle><AlertDialogDescription>{t("deleteConfirmationDescription")}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => onDelete(shop.id)}>{t("delete")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>}
  </div>;
}

type ShopEditorProps = {
  shop: Shop;
  representativeMonth?: string;
  saving: boolean;
  nameExists: boolean;
  hasInvalidRepresentatives: boolean;
  metricConfiguration: ReturnType<typeof getMetricConfiguration>;
  settingsMonth: string;
  onBack: () => void;
  onShopChange: (updater: (shop: Shop) => Shop) => void;
  onAddRepresentative: () => void;
  onRepresentativeChange: (index: number, value: string) => void;
  onRemoveRepresentative: (index: number) => void;
  onMetricWeightChange: (metric: PerformanceMetric, percentage: number) => void;
  onSave: () => void;
};

function ShopEditor({ shop, representativeMonth, saving, nameExists, hasInvalidRepresentatives, metricConfiguration, settingsMonth, onBack, onShopChange, onAddRepresentative, onRepresentativeChange, onRemoveRepresentative, onMetricWeightChange, onSave }: ShopEditorProps) {
  const t = useTranslations("Dialogs");
  const representatives: SalesRepresentative[] = shop.salesRepresentatives ?? [];
  const weightsValid = Math.abs(metricConfiguration.totalWeight - 1) < 0.00001;
  const canSave = shop.name.trim() && !nameExists && !hasInvalidRepresentatives && weightsValid && !saving;
  return <>
    <DialogHeader className="border-b border-slate-200 bg-slate-50 px-5 py-4 pr-12 text-left sm:px-6">
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="icon" aria-label={t("backToShops")} onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <div><DialogTitle>{t("editShopTitle", { shopName: shop.name })}</DialogTitle><DialogDescription className="mt-1">{representativeMonth ? t("editMonthlyRosterDescription", { shopName: shop.name, month: representativeMonth }) : t("editShopDescription", { shopName: shop.name })}</DialogDescription></div>
      </div>
    </DialogHeader>
    <ScrollArea className="h-[min(68vh,600px)]">
      <div className="space-y-6 p-5 sm:p-6">
        <section className="grid gap-4 rounded-lg border bg-slate-50/60 p-4 md:grid-cols-2">
          <Label className="grid gap-1.5">{t("shopName")}<Input value={shop.name} onChange={event => onShopChange(current => ({ ...current, name: event.target.value }))} /></Label>
          <Label className="grid gap-1.5">{t("description")}<Textarea className="min-h-10 resize-none" value={shop.description ?? ""} onChange={event => onShopChange(current => ({ ...current, description: event.target.value }))} placeholder={t("shopDescriptionPlaceholder")} /></Label>
          {nameExists && <p className="text-xs font-medium text-destructive md:col-span-2">{t("duplicateShopName")}</p>}
        </section>
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">{t("salesReps")}</h3><p className="text-sm text-muted-foreground">{t("representativeCount", { count: representatives.length })}</p></div><Button type="button" variant="outline" size="sm" onClick={onAddRepresentative}><Plus className="mr-2 h-4 w-4" />{t("add")}</Button></div>
          <div className="overflow-hidden rounded-md border">
            {representatives.length ? <table className="w-full text-sm"><thead className="bg-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-700"><tr><th className="w-14 border-r border-slate-300 px-3 py-2 text-center">#</th><th className="px-3 py-2 text-left">{t("salesReps")}</th><th className="w-16 px-3 py-2"><span className="sr-only">{t("actions")}</span></th></tr></thead><tbody>{representatives.map((representative, index) => <tr key={representative.id} className="border-t"><td className="border-r bg-slate-50 px-3 py-2 text-center font-mono text-xs text-slate-500">{index + 1}</td><td className="px-3 py-2"><Input aria-label={`${t("salesReps")} ${index + 1}`} value={representative.name} onChange={event => onRepresentativeChange(index, event.target.value)} placeholder={`${t("salesReps")} ${index + 1}`} /></td><td className="px-3 py-2 text-right"><Button type="button" variant="ghost" size="icon" aria-label={`${t("delete")} ${representative.name || index + 1}`} onClick={() => onRemoveRepresentative(index)}><Trash2 className="h-4 w-4 text-destructive" /></Button></td></tr>)}</tbody></table> : <div className="flex h-28 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"><Users className="h-6 w-6 text-slate-300" />{t("noSalesReps")}</div>}
          </div>
          {hasInvalidRepresentatives && <p className="text-xs font-medium text-destructive">{t("invalidRepresentatives")}</p>}
        </section>
        <section className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div><h3 className="flex items-center gap-2 font-semibold"><SlidersHorizontal className="h-4 w-4 text-primary" />{t("metricWeights")}</h3><p className="text-sm text-muted-foreground">{t("metricWeightsDescription", { quarter: getQuarterKey(`${settingsMonth}-01`) })}</p></div>
            <span className={weightsValid ? "text-sm font-semibold text-emerald-700" : "text-sm font-semibold text-destructive"}>{t("totalWeight")}: {(metricConfiguration.totalWeight * 100).toFixed(1)}%</span>
          </div>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-700"><tr><th className="px-3 py-2 text-left">{t("metric")}</th><th className="w-40 px-3 py-2 text-right">{t("weight")}</th></tr></thead>
              <tbody>{metricConfiguration.metrics.map(metric => <tr key={metric} className="border-t"><th scope="row" className="px-3 py-2 text-left font-medium">{getMetricLabel(metric, metricConfiguration.metricSettings)}</th><td className="px-3 py-2"><div className="ml-auto flex max-w-32 items-center gap-2"><Input type="number" min="0" max="100" step="0.1" className="text-right tabular-nums" value={Number(((metricConfiguration.metricSettings?.[metric]?.weight ?? getMetricWeight(metric)) * 100).toFixed(2))} onChange={event => onMetricWeightChange(metric, Number(event.target.value))} /><span className="text-muted-foreground">%</span></div></td></tr>)}</tbody>
            </table>
          </div>
          {!weightsValid && <p className="text-xs font-medium text-destructive">{t("weightsMustTotal")}</p>}
        </section>
      </div>
    </ScrollArea>
    <DialogFooter className="border-t bg-slate-50 px-5 py-4 sm:px-6">
      <Button type="button" variant="outline" onClick={onBack}>{t("cancel")}</Button>
      <Button type="button" onClick={onSave} disabled={!canSave}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{t("saveChanges")}</Button>
    </DialogFooter>
  </>;
}

function getMetricConfiguration(shop: Shop, month: string, targets?: Target) {
  const quarter = shop.quarterSettings?.[getQuarterKey(`${month}-01`)];
  const monthData = shop.monthlyData?.[month];
  const metricSettings = monthData?.metricSettings ?? quarter?.metricSettings ?? shop.metricSettings;
  const metricOrder = monthData?.metricOrder ?? quarter?.metricOrder ?? shop.metricOrder;
  const metrics = getShopMetrics({ ...shop, metricSettings, metricOrder }, monthData?.targets ?? targets);
  const totalWeight = metrics.reduce((total, metric) => total + getMetricWeight(metric, metricSettings), 0);
  return { metricSettings, metrics, totalWeight };
}

function getMetricLabel(metric: PerformanceMetric, metricSettings: ReturnType<typeof getMetricConfiguration>["metricSettings"]) {
  const configuredLabel = metricSettings?.[metric]?.label?.trim();
  if (configuredLabel) return configuredLabel;
  return metric in EXCEL_METRIC_LABELS
    ? EXCEL_METRIC_LABELS[metric]
    : getCustomMetricLabel(metric, metricSettings);
}

function omitMetric<T>(record: Record<PerformanceMetric, T>, metric: PerformanceMetric) {
  const { [metric]: _removed, ...remaining } = record;
  return remaining as Record<PerformanceMetric, T>;
}

type BulkMetricEditorProps = {
  state: BulkMetricState;
  shops: Shop[];
  settingsMonth: string;
  saving: boolean;
  removingMetric: PerformanceMetric | null;
  restoringMetric: PerformanceMetric | null;
  onBack: () => void;
  onShopSelectionChange: (shopIds: string[]) => void;
  onChange: (metric: PerformanceMetric, value: string) => void;
  onApply: () => void;
  onRemove: (metric: PerformanceMetric) => void;
  canDelete: boolean;
  onRestore: (metric: PerformanceMetric) => void;
};

function BulkMetricEditor({ state, shops, settingsMonth, saving, removingMetric, restoringMetric, onBack, onShopSelectionChange, onChange, onApply, onRemove, onRestore, canDelete }: BulkMetricEditorProps) {
  const t = useTranslations("Dialogs");
  const [shopQuery, setShopQuery] = useState("");
  const sortedShops = useMemo(() => [...shops]
    .filter(shop => !normalize(shopQuery) || normalize(shop.name).includes(normalize(shopQuery)))
    .sort((left, right) => left.name.localeCompare(right.name)), [shopQuery, shops]);
  const shopCount = state.selectedShopIds.length;
  const valuesComplete = state.metrics.length > 0 && state.metrics.every(metric => state.values[metric] !== "" && Number.isFinite(Number(state.values[metric])) && Number(state.values[metric]) >= 0 && Number(state.values[metric]) <= 100);
  const total = state.metrics.reduce((sum, metric) => sum + (Number(state.values[metric]) || 0), 0);
  const totalValid = valuesComplete && Math.abs(total - 100) < 0.00001;
  const disabledMetrics = useMemo(() => {
    const selectedShops = shops.filter(shop => state.selectedShopIds.includes(shop.id));
    return Array.from(new Set(selectedShops.flatMap(shop => shop.disabledMetrics ?? []))).map(metric => ({
      metric,
      label: getMetricLabel(metric, selectedShops.find(shop => shop.metricSettings?.[metric])?.metricSettings),
      count: selectedShops.filter(shop => shop.disabledMetrics?.includes(metric)).length,
    }));
  }, [shops, state.selectedShopIds]);

  return <>
    <DialogHeader className="border-b border-slate-200 bg-slate-50 px-5 py-4 pr-12 text-left sm:px-6">
      <div className="flex items-center gap-3"><Button type="button" variant="outline" size="icon" aria-label={t("backToShops")} onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button><div><DialogTitle>{t("bulkMetricsTitle")}</DialogTitle><DialogDescription className="mt-1">{t("bulkMetricsDescription", { quarter: getQuarterKey(`${settingsMonth}-01`) })}</DialogDescription></div></div>
    </DialogHeader>
    <ScrollArea className="h-[min(68vh,600px)]">
      <div className="space-y-4 p-5 sm:p-6">
        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="font-semibold">{t("selectShops")}</h3><p className="text-sm text-muted-foreground">{t("selectedShopCount", { selected: shopCount, total: shops.length })}</p></div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => onShopSelectionChange(shops.map(shop => shop.id))}>{t("selectAll")}</Button><Button type="button" variant="ghost" size="sm" onClick={() => onShopSelectionChange([])} disabled={!shopCount}>{t("clearSelection")}</Button></div></div>
          <div className="rounded-md border"><div className="border-b p-2"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={shopQuery} onChange={event => setShopQuery(event.target.value)} placeholder={t("searchShops")} className="h-9 pl-9" /></div></div><div className="grid max-h-44 gap-px overflow-y-auto bg-border sm:grid-cols-2 lg:grid-cols-3">{sortedShops.map(shop => { const checked = state.selectedShopIds.includes(shop.id); return <label key={shop.id} className="flex cursor-pointer items-center gap-2 bg-background px-3 py-2.5 text-sm hover:bg-emerald-50"><Checkbox checked={checked} onCheckedChange={value => onShopSelectionChange(value ? [...state.selectedShopIds, shop.id] : state.selectedShopIds.filter(id => id !== shop.id))} /><span className="truncate">{shop.name}</span></label>; })}</div></div>
        </section>
        {shopCount ? <>
          <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{t("bulkMetricsWarning", { count: shopCount })}</p></div>
          {disabledMetrics.length > 0 && <section className="space-y-2">
            <div><h3 className="font-semibold">{t("disabledMetrics")}</h3><p className="text-sm text-muted-foreground">{t("disabledMetricsDescription")}</p></div>
            <div className="divide-y overflow-hidden rounded-md border">{disabledMetrics.map(item => <div key={item.metric} className="flex items-center justify-between gap-3 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{t("disabledInShopCount", { count: item.count })}</p></div><Button type="button" variant="outline" size="sm" disabled={Boolean(restoringMetric) || Boolean(removingMetric)} onClick={() => onRestore(item.metric)}>{restoringMetric === item.metric ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}{t("restoreMetric")}</Button></div>)}</div>
          </section>}
          <div className="flex items-end justify-between gap-3"><div><h3 className="font-semibold">{t("metricWeights")}</h3><p className="text-sm text-muted-foreground">{t("mixedWeightsHint")}</p></div><span className={totalValid ? "text-sm font-semibold text-emerald-700" : "text-sm font-semibold text-destructive"}>{t("totalWeight")}: {total.toFixed(1)}%</span></div>
          <div className="overflow-hidden rounded-md border"><table className="w-full text-sm"><thead className="bg-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-700"><tr><th className="px-3 py-2 text-left">{t("metric")}</th><th className="w-44 px-3 py-2 text-right">{t("weight")}</th><th className="w-20 px-3 py-2 text-right">{t("actions")}</th></tr></thead><tbody>{state.metrics.map(metric => <tr key={metric} className="border-t"><th scope="row" className="px-3 py-2 text-left font-medium">{state.labels[metric]}</th><td className="px-3 py-2"><div className="ml-auto flex max-w-36 items-center gap-2"><Input type="number" min="0" max="100" step="0.1" placeholder={t("mixed")} className="text-right tabular-nums" value={state.values[metric]} onChange={event => onChange(metric, event.target.value)} /><span className="text-muted-foreground">%</span></div></td><td className="px-3 py-2 text-right">{canDelete && <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={t("removeMetric", { metric: state.labels[metric] })} disabled={Boolean(removingMetric)} className="text-destructive hover:bg-destructive/10 hover:text-destructive">{removingMetric === metric ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("removeMetricTitle", { metric: state.labels[metric] })}</AlertDialogTitle><AlertDialogDescription>{t("removeMetricDescription", { metric: state.labels[metric], count: shopCount })}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => onRemove(metric)}>{t("removeFromSelected")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</td></tr>)}</tbody></table></div>
          {!valuesComplete && <p className="text-xs font-medium text-amber-700">{t("completeAllWeights")}</p>}
          {valuesComplete && !totalValid && <p className="text-xs font-medium text-destructive">{t("weightsMustTotal")}</p>}
        </> : <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t("selectShopsToContinue")}</div>}
      </div>
    </ScrollArea>
    <DialogFooter className="border-t bg-slate-50 px-5 py-4 sm:px-6"><Button type="button" variant="outline" onClick={onBack}>{t("cancel")}</Button><Button type="button" onClick={onApply} disabled={!shopCount || !totalValid || saving || Boolean(removingMetric) || Boolean(restoringMetric)}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{t("applyToSelectedShops", { count: shopCount })}</Button></DialogFooter>
  </>;
}
