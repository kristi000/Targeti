"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Trash2, UserRoundCog, Users } from "lucide-react";

import { handleDeleteRepresentatives } from "@/app/actions";
import { useShop } from "@/components/shop-provider";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { calculateTotalAchievement } from "@/lib/utils";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import { getMonthlyRepresentatives, getOverviewPerformanceData, getShopMetrics, type PerformanceMetric } from "@/lib/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
};

type RepresentativeRow = {
  key: string;
  id: string;
  name: string;
  shopId: string;
  shopName: string;
  achievement: number | null;
};

export function ManageRepresentativesDialog({ open, onOpenChange, month }: Props) {
  const { shops, allPerformanceData, allMonthlyTargets, loadPerformanceMonth, reloadData } = useShop();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "performance-desc" | "performance-asc">("name");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) void loadPerformanceMonth(month);
  }, [open, month, loadPerformanceMonth]);

  const representatives = useMemo<RepresentativeRow[]>(() => shops.flatMap(shop => {
    const monthlyRepresentatives = getMonthlyRepresentatives(shop, month);
    const performanceData = getOverviewPerformanceData(allPerformanceData[shop.id] ?? []).filter(entry => entry.date.startsWith(month));
    const report = performanceData[0];
    const monthData = shop.monthlyData?.[month];
    const monthlyTargets = report?.targets ?? monthData?.targets ?? allMonthlyTargets[shop.id];
    const metricSettings = monthData?.metricSettings ?? shop.metricSettings;
    const metrics = monthlyTargets
      ? getShopMetrics({ ...shop, metricSettings, metricOrder: monthData?.metricOrder ?? shop.metricOrder }, monthlyTargets)
      : [];
    const representativeTargets = monthlyTargets
      ? getEqualRepresentativeTargets(monthlyTargets, metrics, monthlyRepresentatives.length)
      : undefined;

    return monthlyRepresentatives.map(representative => {
      const totals = metrics.reduce((result, metric) => {
        result[metric] = performanceData.reduce((sum, entry) => sum + (entry.reps.find(rep => rep.repId === representative.id)?.[metric] ?? 0), 0);
        return result;
      }, {} as Record<PerformanceMetric, number>);
      return {
        key: `${shop.id}:${representative.id}`,
        id: representative.id,
        name: representative.name,
        shopId: shop.id,
        shopName: shop.name,
        achievement: representativeTargets ? calculateTotalAchievement(totals, representativeTargets, metricSettings) : null,
      };
    });
  }), [shops, month, allPerformanceData, allMonthlyTargets]);

  const filteredRepresentatives = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return representatives.filter(representative => !normalizedQuery
      || `${representative.name} ${representative.shopName}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => {
        if (sortBy === "name") return left.name.localeCompare(right.name) || left.shopName.localeCompare(right.shopName);
        if (left.achievement === null && right.achievement !== null) return 1;
        if (left.achievement !== null && right.achievement === null) return -1;
        const difference = (left.achievement ?? 0) - (right.achievement ?? 0);
        if (difference) return sortBy === "performance-desc" ? -difference : difference;
        return left.name.localeCompare(right.name) || left.shopName.localeCompare(right.shopName);
      });
  }, [query, representatives, sortBy]);

  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedRepresentatives = representatives.filter(representative => selectedKeySet.has(representative.key));
  const allFilteredSelected = filteredRepresentatives.length > 0
    && filteredRepresentatives.every(representative => selectedKeySet.has(representative.key));

  const handleDialogChange = (nextOpen: boolean) => {
    if (!nextOpen && !deleting) {
      setQuery("");
      setSortBy("name");
      setSelectedKeys([]);
      setConfirming(false);
    }
    onOpenChange(nextOpen);
  };

  const toggleFiltered = (checked: boolean) => {
    const filteredKeys = new Set(filteredRepresentatives.map(representative => representative.key));
    setSelectedKeys(current => checked
      ? Array.from(new Set([...current, ...filteredKeys]))
      : current.filter(key => !filteredKeys.has(key)));
  };

  const deleteSelected = async () => {
    if (!selectedRepresentatives.length) return;
    setDeleting(true);
    try {
      const result = await handleDeleteRepresentatives(month, selectedRepresentatives.map(representative => ({
        shopId: representative.shopId,
        representativeId: representative.id,
      })));
      if (!result.success) throw new Error(result.error);
      await reloadData();
      toast({
        title: "Representatives deleted",
        description: `${result.count} representative${result.count === 1 ? "" : "s"} removed from ${result.shops} shop${result.shops === 1 ? "" : "s"} for ${month}.`,
      });
      setConfirming(false);
      setQuery("");
      setSortBy("name");
      setSelectedKeys([]);
      onOpenChange(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Deletion failed",
        description: error instanceof Error ? error.message : "The selected representatives could not be deleted.",
      });
    } finally {
      setDeleting(false);
    }
  };

  return <>
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b bg-slate-50 px-5 py-4 pr-12 text-left sm:px-6">
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-emerald-700 p-2 text-white"><UserRoundCog className="h-5 w-5" /></span>
            <div><DialogTitle>Manage representatives</DialogTitle><DialogDescription>Search and remove representatives from the {month} reporting roster.</DialogDescription></div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3 border-b px-5 py-3 sm:flex-row sm:items-center sm:px-6">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search representatives or shops…" className="pl-9" />
          </div>
          <select value={sortBy} onChange={event => setSortBy(event.target.value as typeof sortBy)} aria-label="Sort representatives" className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="name">Name A–Z</option>
            <option value="performance-desc">Performance: highest first</option>
            <option value="performance-asc">Performance: lowest first</option>
          </select>
          <span className="shrink-0 text-sm text-muted-foreground">{selectedKeys.length} selected</span>
        </div>

        <ScrollArea className="h-[min(58vh,520px)]">
          {filteredRepresentatives.length ? <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-700">
              <tr>
                <th className="w-14 border-b border-r border-slate-300 px-3 py-2 text-center"><Checkbox checked={allFilteredSelected} onCheckedChange={value => toggleFiltered(Boolean(value))} aria-label="Select all visible representatives" /></th>
                <th className="border-b border-r border-slate-300 px-3 py-2 text-left">Representative</th>
                <th className="border-b border-r border-slate-300 px-3 py-2 text-left">Shop</th>
                <th className="w-32 border-b border-slate-300 px-3 py-2 text-right">Performance</th>
              </tr>
            </thead>
            <tbody>{filteredRepresentatives.map(representative => {
              const checked = selectedKeySet.has(representative.key);
              return <tr key={representative.key} className="bg-white even:bg-slate-50/70 hover:bg-emerald-50/70">
                <td className="border-b border-r border-slate-200 px-3 py-3 text-center"><Checkbox checked={checked} onCheckedChange={value => setSelectedKeys(current => value ? [...current, representative.key] : current.filter(key => key !== representative.key))} aria-label={`Select ${representative.name}`} /></td>
                <th scope="row" className="border-b border-r border-slate-200 px-3 py-3 text-left font-medium">{representative.name}</th>
                <td className="border-b border-r border-slate-200 px-3 py-3 text-muted-foreground">{representative.shopName}</td>
                <td className="border-b border-slate-200 px-3 py-3 text-right font-semibold tabular-nums">{representative.achievement === null ? "—" : `${representative.achievement.toFixed(1)}%`}</td>
              </tr>;
            })}</tbody>
          </table> : <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-muted-foreground"><Users className="h-8 w-8 text-slate-300" /><p className="font-medium">No representatives found</p><p className="text-sm">Try another search or reporting month.</p></div>}
        </ScrollArea>

        <DialogFooter className="border-t bg-slate-50 px-5 py-4 sm:px-6">
          <Button type="button" variant="outline" onClick={() => handleDialogChange(false)} disabled={deleting}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={() => setConfirming(true)} disabled={!selectedKeys.length || deleting}><Trash2 className="mr-2 h-4 w-4" />Delete selected ({selectedKeys.length})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Delete {selectedKeys.length} representatives?</AlertDialogTitle><AlertDialogDescription>This removes them from the {month} reporting roster. Existing imported sales history remains unchanged, and each shop’s targets will be shared equally by its remaining representatives.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleting} onClick={event => { event.preventDefault(); void deleteSelected(); }}>{deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Delete representatives</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
