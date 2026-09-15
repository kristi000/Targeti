
'use client';

import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type Shop, type Supervisor, type PerformanceData, type Target, type MetricWeightProfile, type ShopData } from '@/lib/types';
import { handleAddShop, handleDeleteShop, handleUpdateShop } from "@/app/actions/shops";
import { handleSavePerformanceData } from "@/app/actions/performance";
import { fetchPerformanceData, fetchShopData } from "@/app/actions/shop-data";
import { fetchPerformanceDataForMonth } from '@/app/dashboard-actions';
import { useToast } from '@/hooks/use-toast';
import { useTranslations } from 'next-intl';
import type { AppActor } from '@/lib/auth-types';
import { shopPerformanceQueryKey } from '@/lib/query-keys';

type ShopContextType = {
  actor: AppActor;
  isAdmin: boolean;
  shops: Shop[];
  supervisors: Supervisor[];
  weightProfiles: MetricWeightProfile[];
  selectedShop: Shop | null;
  setSelectedShop: (shop: Shop | null) => void;
  addShop: (shopName: string, description?: string) => Promise<void>;
  updateShop: (shop: Shop) => Promise<void>;
  deleteShop: (shopId: string) => Promise<void>;
  allPerformanceData: Record<string, PerformanceData[]>;
  allMonthlyTargets: Record<string, Target>;
  updatePerformanceData: (shopId: string, data: PerformanceData[]) => void;
  loading: boolean;
  refreshDataForShop: (shopId: string) => Promise<void>;
  refreshShopDirectory: () => Promise<void>;
  loadPerformanceForShop: (shopId: string) => Promise<void>;
  loadPerformanceMonth: (month: string) => Promise<void>;
  reloadData: () => Promise<void>;
  selectedDatasetId: string;
  setSelectedDatasetId: (datasetId: string) => void;
  selectedPerformanceId: string | null;
  setSelectedPerformanceId: (performanceId: string | null) => void;
};

const ShopContext = createContext<ShopContextType | undefined>(undefined);

export function ShopProvider({ children, initialData, actor }: { children: React.ReactNode; initialData: ShopData; actor: AppActor }) {
  const queryClient = useQueryClient();
  const [shops, setShops] = useState<Shop[]>(initialData.shops);
  const [supervisors, setSupervisors] = useState<Supervisor[]>(initialData.supervisors);
  const [weightProfiles, setWeightProfiles] = useState<MetricWeightProfile[]>(initialData.weightProfiles);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(initialData.shops[0] ?? null);
  const [allPerformanceData, setAllPerformanceData] = useState<Record<string, PerformanceData[]>>({});
  const [allMonthlyTargets, setAllMonthlyTargets] = useState<Record<string, Target>>(initialData.monthlyTargets);
  const [loading, setLoading] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedPerformanceId, setSelectedPerformanceId] = useState<string | null>(null);

  const { toast } = useToast();
  const t = useTranslations("Toasts");

  const refreshDataForShop = useCallback(async (shopId: string) => {
    try {
        const [data, performanceData] = await Promise.all([fetchShopData(), fetchPerformanceData(shopId)]);
        const shop = data.shops.find(item => item.id === shopId);
        setShops(data.shops);
        setSupervisors(data.supervisors);
        setWeightProfiles(data.weightProfiles);
        setAllPerformanceData(current => ({ ...current, [shopId]: performanceData }));
        queryClient.setQueryData(shopPerformanceQueryKey(shopId), performanceData);
        setAllMonthlyTargets(data.monthlyTargets);
        if (shop) setSelectedShop(shop);
    } catch (error) {
        console.error(`Failed to refresh data for shop ${shopId}:`, error);
        toast({
            variant: "destructive",
            title: t('error'),
            description: `Failed to refresh data for the shop.`
        });
    }
  }, [queryClient, toast, t]);

  const loadPerformanceForShop = useCallback(async (shopId: string) => {
    const performanceData = await queryClient.fetchQuery({
      queryKey: shopPerformanceQueryKey(shopId),
      queryFn: () => fetchPerformanceData(shopId),
      staleTime: 60_000,
    });
    setAllPerformanceData(current => ({ ...current, [shopId]: performanceData }));
  }, [queryClient]);

  const loadPerformanceMonth = useCallback(async (month: string) => {
    if (!month) return;
    const performanceByShop = await queryClient.fetchQuery({
      queryKey: ["performance", "month", month],
      queryFn: () => fetchPerformanceDataForMonth(month),
      staleTime: 60_000,
    });
      setAllPerformanceData(current => {
        const next = { ...current };
        const shopIds = new Set([...Object.keys(current), ...Object.keys(performanceByShop)]);
        shopIds.forEach(shopId => {
          const retained = (current[shopId] ?? []).filter(entry => !entry.date.startsWith(month));
          next[shopId] = [...retained, ...(performanceByShop[shopId] ?? [])]
            .sort((left, right) => left.date.localeCompare(right.date));
        });
        return next;
      });
  }, [queryClient]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const { shops, supervisors, weightProfiles, monthlyTargets } = await fetchShopData();
      
      setShops(shops);
      setSupervisors(supervisors);
      setWeightProfiles(weightProfiles);
      setAllMonthlyTargets(monthlyTargets);
      
      setSelectedShop(current => shops.find(shop => shop.id === current?.id) ?? shops[0] ?? null);
      queryClient.removeQueries({ queryKey: ["performance"] });
      if (selectedShop?.id) await loadPerformanceForShop(selectedShop.id);
      if (selectedDatasetId) await loadPerformanceMonth(selectedDatasetId);
      
    } catch (error) {
      console.error("Failed to load initial data:", error);
      toast({
        variant: "destructive",
        title: t('error'),
        description: "Failed to load data from the database."
      });
    } finally {
      setLoading(false);
    }
  }, [toast, t, selectedShop?.id, selectedDatasetId, loadPerformanceForShop, loadPerformanceMonth, queryClient]);

  const refreshShopDirectory = useCallback(async () => {
    const { shops, supervisors, weightProfiles, monthlyTargets } = await fetchShopData();
    setShops(shops);
    setSupervisors(supervisors);
    setWeightProfiles(weightProfiles);
    setAllMonthlyTargets(monthlyTargets);
    setSelectedShop(current => shops.find(shop => shop.id === current?.id) ?? shops[0] ?? null);
  }, []);

  const addShop = useCallback(async (shopName: string, description?: string) => {
    setLoading(true);
    try {
        const result = await handleAddShop(shopName, description);
        if (result.success && result.data) {
            const newShop = result.data;
            setShops(prev => [...prev, newShop]);
            if (newShop.monthlyTargets) {
                const targets = newShop.monthlyTargets as Target;
                setAllMonthlyTargets(prev => ({...prev, [newShop.id]: targets}));
            }
            setAllPerformanceData(prev => ({...prev, [newShop.id]: []}));
            queryClient.setQueryData(shopPerformanceQueryKey(newShop.id), []);
            
            toast({ title: t('shopAdded'), description: t('shopAddedSuccess', {shopName}) });
        } else {
            console.error("Failed to add shop:", result.error);
            toast({ variant: "destructive", title: t('error'), description: result.error || t('addShopFailed') });
        }
    } catch (error) {
        console.error("Unexpected error adding shop:", error);
        toast({ variant: "destructive", title: t('error'), description: t('addShopFailed') });
    } finally {
        setLoading(false);
    }
  }, [queryClient, toast, t]);

  const updateShop = useCallback(async (updatedShop: Shop) => {
    const result = await handleUpdateShop(updatedShop);
    if (result.success && result.data) {
      setShops(prev => prev.map(s => s.id === updatedShop.id ? {...s, ...result.data!} : s));
      if (selectedShop?.id === updatedShop.id) {
        setSelectedShop(prev => prev ? {...prev, ...result.data!} : null);
      }
      
      toast({ title: t('shopUpdated'), description: t('shopUpdatedSuccess', {shopName: updatedShop.name}) });
    } else {
      toast({ variant: "destructive", title: t('error'), description: t('updateShopFailed') });
    }
  }, [selectedShop?.id, toast, t]);

  const deleteShop = useCallback(async (shopId: string) => {
    const result = await handleDeleteShop(shopId);
    if(result.success) {
      setShops(prev => {
        const newShops = prev.filter(s => s.id !== shopId);
        if (selectedShop?.id === shopId) {
          setSelectedShop(newShops.length > 0 ? newShops[0] : null);
        }
        return newShops;
      });
      // Also remove data associated with the shop
      setAllPerformanceData(prev => {
        const newData = {...prev};
        delete newData[shopId];
        return newData;
      });
      queryClient.removeQueries({ queryKey: shopPerformanceQueryKey(shopId) });
      setAllMonthlyTargets(prev => {
        const newTargets = {...prev};
        delete newTargets[shopId];
        return newTargets;
      });
      toast({ title: t('shopDeleted'), description: t('shopDeletedSuccess') });
    } else {
      toast({ variant: "destructive", title: t('error'), description: t('deleteShopFailed') });
    }
  }, [queryClient, selectedShop?.id, toast, t]);

  const handleSetSelectedShop = useCallback((shop: Shop | null) => {
    setSelectedShop(shop);
  }, []);
  
  const updatePerformanceData = useCallback(async (shopId: string, data: PerformanceData[]) => {
      const result = await handleSavePerformanceData(shopId, data);
      if (result.success && result.data) {
        setAllPerformanceData(prev => ({...prev, [shopId]: result.data!}));
        queryClient.setQueryData(shopPerformanceQueryKey(shopId), result.data);
        void queryClient.invalidateQueries({ queryKey: ["performance", "month"] });
      }
  }, [queryClient]);

  const contextValue = useMemo(() => ({
    actor,
    isAdmin: actor.role === "admin",
    shops,
    supervisors,
    weightProfiles,
    selectedShop: selectedShop,
    setSelectedShop: handleSetSelectedShop,
    addShop,
    updateShop,
    deleteShop,
    allPerformanceData,
    allMonthlyTargets,
    updatePerformanceData,
    loading,
    refreshDataForShop,
    refreshShopDirectory,
    loadPerformanceForShop,
    loadPerformanceMonth,
    reloadData: loadInitialData,
    selectedDatasetId,
    setSelectedDatasetId,
    selectedPerformanceId,
    setSelectedPerformanceId,
  }), [actor, shops, supervisors, weightProfiles, selectedShop, handleSetSelectedShop, addShop, updateShop, deleteShop, allPerformanceData, allMonthlyTargets, updatePerformanceData, loading, refreshDataForShop, refreshShopDirectory, loadPerformanceForShop, loadPerformanceMonth, loadInitialData, selectedDatasetId, selectedPerformanceId]);
  
  return (
    <ShopContext.Provider value={contextValue}>
      {children}
    </ShopContext.Provider>
  );
}

export function useShop() {
  const context = useContext(ShopContext);
  if (context === undefined) {
    throw new Error('useShop must be used within a ShopProvider');
  }
  return context;
}
