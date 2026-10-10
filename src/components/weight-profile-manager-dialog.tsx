"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CirclePlus, CopyPlus, Loader2, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { handleAssignWeightProfile, handleCreateWeightProfile, handleDeleteWeightProfile, handleUpdateWeightProfile } from "@/app/actions/weight-profiles";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useShop } from "@/components/shop-provider";
import { useToast } from "@/hooks/use-toast";
import { METRIC_WEIGHTS } from "@/lib/data";
import { getWeightProfileImportConfiguration, getWeightProfilePeriodKey } from "@/lib/import-weight-profiles";
import { EXCEL_METRIC_LABELS, getCustomMetricLabel } from "@/lib/metric-definitions";
import { metricWeightProfileSchema } from "@/lib/persistence-schemas";
import type { MetricWeightProfile, PerformanceMetric } from "@/lib/types";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };
type Draft = Omit<MetricWeightProfile, "createdAt" | "updatedAt">;

const cloneDraft = (profile: MetricWeightProfile): Draft => ({
  id: profile.id,
  name: profile.name,
  ...getWeightProfileImportConfiguration(profile),
  metricOrder: [...profile.metricOrder],
  metricSettings: structuredClone(profile.metricSettings),
});

const slugify = (label: string) => label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "metric";
const initialDraft = (): Draft => {
  const metricOrder = Object.keys(METRIC_WEIGHTS) as PerformanceMetric[];
  const today = new Date();
  return {
    id: "new-profile",
    name: "New profile",
    year: today.getFullYear(),
    quarter: (Math.floor(today.getMonth() / 3) + 1) as 1 | 2 | 3 | 4,
    metricOrder,
    metricSettings: Object.fromEntries(metricOrder.map(metric => [metric, {
      label: EXCEL_METRIC_LABELS[metric] ?? getCustomMetricLabel(metric),
      weight: METRIC_WEIGHTS[metric],
    }])),
  };
};

export function WeightProfileManagerDialog({ open, onOpenChange }: Props) {
  const t = useTranslations("WeightProfiles");
  const { shops, weightProfiles, refreshShopDirectory } = useShop();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedProfile = selectedId === "new-profile" ? undefined : weightProfiles.find(profile => profile.id === selectedId) ?? weightProfiles[0];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [newMetricName, setNewMetricName] = useState("");
  const [saving, setSaving] = useState(false);

  const currentDraft = draft && (draft.id === selectedProfile?.id || !selectedProfile)
    ? draft
    : selectedProfile ? cloneDraft(selectedProfile) : initialDraft();
  const currentAssignments = Object.keys(assignments).length
    ? assignments
    : Object.fromEntries(shops.map(shop => [shop.id, shop.weightProfileId ?? ""]));
  const total = currentDraft?.metricOrder.reduce((sum, metric) => sum + Number(currentDraft.metricSettings[metric]?.weight ?? 0), 0) ?? 0;
  const disabledMetrics = currentDraft
    ? (Object.keys(currentDraft.metricSettings) as PerformanceMetric[]).filter(metric => !currentDraft.metricOrder.includes(metric))
    : [];
  const validPeriod = Boolean(currentDraft && ((currentDraft.year === null && currentDraft.quarter === null)
    || (Number.isInteger(currentDraft.year) && Number(currentDraft.year) >= 2000 && Number(currentDraft.year) <= 9999
      && [1, 2, 3, 4].includes(Number(currentDraft.quarter)))));
  const periodKey = currentDraft ? getWeightProfilePeriodKey(currentDraft) : undefined;
  const periodExists = Boolean(periodKey && weightProfiles.some(profile => profile.id !== currentDraft?.id && getWeightProfilePeriodKey(profile) === periodKey));
  const valid = validPeriod && !periodExists && metricWeightProfileSchema.safeParse(currentDraft).success;
  const assignedCount = selectedProfile ? shops.filter(shop => (currentAssignments[shop.id] ?? shop.weightProfileId) === selectedProfile.id).length : 0;
  const allAssigned = shops.every(shop => Boolean(currentAssignments[shop.id]));

  const selectProfile = (profile: MetricWeightProfile) => {
    setSelectedId(profile.id);
    setDraft(cloneDraft(profile));
  };

  const updateDraft = (updater: (value: Draft) => Draft) => {
    if (currentDraft) setDraft(updater(currentDraft));
  };

  const prepareProfile = () => {
    const source = currentDraft;
    if (!source) return;
    setSelectedId("new-profile");
    setDraft({
      ...source,
      id: "new-profile",
      name: weightProfiles.length ? `${source.name} ${t("copySuffix")}`.slice(0, 80) : source.name,
      metricOrder: [...source.metricOrder],
      metricSettings: structuredClone(source.metricSettings),
    });
  };

  const saveProfile = async () => {
    if (!currentDraft || !valid) return;
    setSaving(true);
    const existing = weightProfiles.find(profile => profile.id === currentDraft.id);
    const { id: draftId, ...newProfile } = currentDraft;
    void draftId;
    const result = existing
      ? await handleUpdateWeightProfile({ ...existing, ...currentDraft })
      : await handleCreateWeightProfile(newProfile);
    if (result.success) {
      await refreshShopDirectory();
      setSelectedId(result.data.id);
      setDraft(cloneDraft(result.data));
      toast({ title: "Profile saved", description: "Future imports can use this configuration." });
    } else {
      toast({ variant: "destructive", title: "Could not save profile", description: "code" in result && result.code === "PROFILE_PERIOD_EXISTS" ? t("periodExists") : result.error });
    }
    setSaving(false);
  };

  const saveAssignments = async () => {
    if (!allAssigned) return;
    setSaving(true);
    for (const profile of weightProfiles) {
      const shopIds = shops.filter(shop => currentAssignments[shop.id] === profile.id).map(shop => shop.id);
      if (!shopIds.length) continue;
      const result = await handleAssignWeightProfile(profile.id, shopIds);
      if (!result.success) {
        toast({ variant: "destructive", title: "Could not save assignments", description: result.error });
        setSaving(false);
        return;
      }
    }
    await refreshShopDirectory();
    setAssignments({});
    toast({ title: "Assignments saved", description: "Each shop now has a default import profile." });
    setSaving(false);
  };

  const deleteProfile = async () => {
    if (!selectedProfile || assignedCount) return;
    setSaving(true);
    const result = await handleDeleteWeightProfile(selectedProfile.id);
    if (result.success) {
      await refreshShopDirectory();
      setSelectedId(null);
      setDraft(null);
      toast({ title: "Profile deleted" });
    } else {
      toast({ variant: "destructive", title: "Could not delete profile", description: result.error });
    }
    setSaving(false);
  };

  const addMetric = () => {
    const label = newMetricName.trim();
    if (!label || !currentDraft) return;
    let metric = `custom_${slugify(label)}` as PerformanceMetric;
    let suffix = 2;
    while (currentDraft.metricOrder.includes(metric)) metric = `custom_${slugify(label)}_${suffix++}` as PerformanceMetric;
    updateDraft(value => ({
      ...value,
      metricOrder: [...value.metricOrder, metric],
      metricSettings: { ...value.metricSettings, [metric]: { label, weight: 0 } },
    }));
    setNewMetricName("");
  };

  const moveMetric = (metric: PerformanceMetric, direction: -1 | 1) => updateDraft(value => {
    const metricOrder = [...value.metricOrder];
    const index = metricOrder.indexOf(metric);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= metricOrder.length) return value;
    [metricOrder[index], metricOrder[next]] = [metricOrder[next], metricOrder[index]];
    return { ...value, metricOrder };
  });

  const profileUsage = useMemo(() => new Map(weightProfiles.map(profile => [
    profile.id,
    shops.filter(shop => shop.weightProfileId === profile.id).length,
  ])), [shops, weightProfiles]);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[94vh] overflow-hidden sm:max-w-6xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><SlidersHorizontal className="h-5 w-5" />Manage weight profiles</DialogTitle>
        <DialogDescription>{t("managerDescription")}</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="space-y-1 rounded-md border p-1">
            {weightProfiles.map(profile => <button key={profile.id} type="button" onClick={() => selectProfile(profile)} className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${selectedProfile?.id === profile.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              <span className="truncate">{profile.name}</span><span className="text-xs opacity-70">{profileUsage.get(profile.id) ?? 0}</span>
            </button>)}
          </div>
          <Button type="button" variant="outline" className="w-full" disabled={!currentDraft || saving} onClick={prepareProfile}><CopyPlus className="mr-2 h-4 w-4" />{weightProfiles.length ? "Duplicate profile" : "Create profile"}</Button>
        </div>
        <ScrollArea className="h-[68vh] pr-4">
          {currentDraft ? <div className="space-y-6">
            <section className="space-y-3">
              <div className="flex flex-wrap items-end gap-3"><Label className="grid min-w-0 flex-1 gap-1.5">Profile name<Input value={currentDraft.name} maxLength={80} onChange={event => updateDraft(value => ({ ...value, name: event.target.value }))} /></Label><Button type="button" disabled={!valid || saving} onClick={() => void saveProfile()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save profile</Button></div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[10rem_8rem_minmax(0,1fr)]">
                <div className="grid gap-1.5">
                  <Label htmlFor="weight-profile-quarter">{t("quarter")}</Label>
                  <AppSelect id="weight-profile-quarter" aria-label={t("quarter")} value={currentDraft.quarter === null ? "all" : String(currentDraft.quarter)} onValueChange={quarter => updateDraft(value => quarter === "all"
                    ? { ...value, quarter: null, year: null }
                    : { ...value, quarter: Number(quarter) as 1 | 2 | 3 | 4, year: value.year ?? new Date().getFullYear() })}
                    options={[{ value: "all", label: t("allPeriods") }, ...[1, 2, 3, 4].map(quarter => ({ value: String(quarter), label: t("quarterOption", { quarter }) }))]} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="weight-profile-year">{t("year")}</Label>
                  <Input id="weight-profile-year" type="number" min="2000" max="9999" step="1" value={currentDraft.year ?? ""} disabled={currentDraft.quarter === null} aria-invalid={!validPeriod || undefined} onChange={event => updateDraft(value => ({ ...value, year: event.target.value === "" ? null : Number(event.target.value) }))} />
                </div>
                <div className="grid gap-1.5 sm:col-span-2 xl:col-span-1">
                  <Label htmlFor="weight-profile-group">{t("group")}</Label>
                  <Input id="weight-profile-group" value={currentDraft.group ?? ""} maxLength={80} placeholder={t("groupPlaceholder")} onChange={event => updateDraft(value => ({ ...value, group: event.target.value.trim() ? event.target.value : undefined }))} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t("periodHelp")}</p>
              <p className="text-xs text-muted-foreground">{t("groupHelp")}</p>
              {!validPeriod && <p className="text-xs text-destructive" role="alert">{t("invalidPeriod")}</p>}
              {periodExists && <p className="text-xs text-destructive" role="alert">{t("periodExists")}</p>}
              <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[680px] text-sm"><thead className="bg-muted/60"><tr><th className="px-3 py-2 text-left">Metric</th><th className="w-36 px-3 py-2 text-right">Weight</th><th className="w-32 px-3 py-2 text-center">Order</th><th className="w-20 px-3 py-2 text-center">Remove</th></tr></thead><tbody className="divide-y">{currentDraft.metricOrder.map((metric, index) => <tr key={metric}><td className="px-3 py-2"><Input value={currentDraft.metricSettings[metric]?.label ?? ""} onChange={event => updateDraft(value => ({ ...value, metricSettings: { ...value.metricSettings, [metric]: { ...value.metricSettings[metric], label: event.target.value } } }))} /></td><td className="px-3 py-2"><div className="flex items-center gap-2"><Input className="text-right" type="number" min="0" max="100" step="0.1" value={Number(currentDraft.metricSettings[metric]?.weight ?? 0) * 100} onChange={event => updateDraft(value => ({ ...value, metricSettings: { ...value.metricSettings, [metric]: { ...value.metricSettings[metric], weight: Math.max(0, Math.min(100, Number(event.target.value))) / 100 } } }))} /><span>%</span></div></td><td className="px-3 py-2"><div className="flex justify-center gap-1"><Button variant="ghost" size="icon" disabled={index === 0} onClick={() => moveMetric(metric, -1)}><ArrowUp className="h-4 w-4" /></Button><Button variant="ghost" size="icon" disabled={index === currentDraft.metricOrder.length - 1} onClick={() => moveMetric(metric, 1)}><ArrowDown className="h-4 w-4" /></Button></div></td><td className="px-3 py-2 text-center"><Button variant="ghost" size="icon" className="text-destructive" disabled={currentDraft.metricOrder.length === 1} onClick={() => updateDraft(value => ({ ...value, metricOrder: value.metricOrder.filter(item => item !== metric) }))}><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div>
              <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-1 gap-2"><Input placeholder="New custom metric" value={newMetricName} onChange={event => setNewMetricName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addMetric(); } }} /><Button variant="outline" onClick={addMetric} disabled={!newMetricName.trim()}><CirclePlus className="mr-2 h-4 w-4" />Add metric</Button></div><p className={`text-sm font-semibold ${Math.abs(total - 1) < 0.00001 ? "text-emerald-600" : "text-destructive"}`}>Total {(total * 100).toFixed(1)}%</p></div>
              {disabledMetrics.length > 0 && <div className="space-y-2 rounded-md border p-3"><p className="text-sm font-medium">Disabled metrics</p><div className="flex flex-wrap gap-2">{disabledMetrics.map(metric => <Button key={metric} type="button" size="sm" variant="outline" onClick={() => updateDraft(value => ({ ...value, metricOrder: [...value.metricOrder, metric] }))}><CirclePlus className="mr-2 h-3.5 w-3.5" />{currentDraft.metricSettings[metric]?.label ?? metric}</Button>)}</div></div>}
              <Button variant="outline" className="text-destructive" disabled={!selectedProfile || Boolean(assignedCount) || saving} onClick={() => void deleteProfile()}><Trash2 className="mr-2 h-4 w-4" />Delete profile</Button>
              {assignedCount > 0 && <p className="text-xs text-muted-foreground">Reassign the {assignedCount} using {assignedCount === 1 ? "shop" : "shops"} before deleting this profile.</p>}
            </section>
            <section className="space-y-3 border-t pt-5"><div><h3 className="font-semibold">Default profile by shop</h3><p className="text-xs text-muted-foreground">{t("assignmentsDescription")}</p></div><div className="grid gap-2 sm:grid-cols-2">{[...shops].sort((a, b) => a.name.localeCompare(b.name)).map(shop => <Label key={shop.id} className="grid grid-cols-[minmax(0,1fr)_12rem] items-center gap-3 rounded-md border px-3 py-2"><span className="truncate text-sm">{shop.name}</span><AppSelect aria-label={`${shop.name}: Select profile`} value={currentAssignments[shop.id] ?? ""} onValueChange={value => setAssignments(current => ({ ...currentAssignments, ...current, [shop.id]: value }))} options={[{ value: "", label: "Select profile" }, ...weightProfiles.map(profile => ({ value: profile.id, label: profile.name }))]} /></Label>)}</div><Button disabled={!allAssigned || saving} onClick={() => void saveAssignments()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save shop assignments</Button>{!allAssigned && <p className="text-xs text-destructive">Select a profile for every shop before saving.</p>}</section>
          </div> : <p className="rounded-md border p-6 text-sm text-muted-foreground">Create the initial profile to begin.</p>}
        </ScrollArea>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
