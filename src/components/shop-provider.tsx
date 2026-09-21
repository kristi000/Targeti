
'use client';

import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type Shop, type Supervisor, type Target, type MetricWeightProfile, type ShopData } from '@/lib/types';
import { handleAddShop, handleDeleteShop, handleUpdateShop } from "@/app/actions/shops";
import { fetchShopData } from "@/app/actions/shop-data";
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
  allMonthlyTargets: Record<string, Target>;
  loading: boolean;
  refreshDataForShop: (shopId: string) => Promise<void>;
  refreshShopDirectory: () => Promise<void>;
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
  const [allMonthlyTargets, setAllMonthlyTargets] = useState<Record<string, Target>>(initialData.monthlyTargets);
  const [loading, setLoading] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedPerformanceId, setSelectedPerformanceId] = useState<string | null>(null);

  const { toast } = useToast();
  const t = useTranslations("Toasts");

  const refreshDataForShop = useCallback(async (shopId: string) => {
    try {
        const data = await fetchShopData();
        const shop = data.shops.find(item => item.id === shopId);
        setShops(data.shops);
        setSupervisors(data.supervisors);
        setWeightProfiles(data.weightProfiles);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: shopPerformanceQueryKey(shopId) }),
          queryClient.invalidateQueries({ queryKey: ["performance", "month"] }),
        ]);
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

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const { shops, supervisors, weightProfiles, monthlyTargets } = await fetchShopData();
      
      setShops(shops);
      setSupervisors(supervisors);
      setWeightProfiles(weightProfiles);
      setAllMonthlyTargets(monthlyTargets);
      
      setSelectedShop(current => shops.find(shop => shop.id === current?.id) ?? shops[0] ?? null);
      await queryClient.invalidateQueries({ queryKey: ["performance"] });
      
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
  }, [toast, t, queryClient]);

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
  }, [toast, t]);

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
    allMonthlyTargets,
    loading,
    refreshDataForShop,
    refreshShopDirectory,
    reloadData: loadInitialData,
    selectedDatasetId,
    setSelectedDatasetId,
    selectedPerformanceId,
    setSelectedPerformanceId,
  }), [actor, shops, supervisors, weightProfiles, selectedShop, handleSetSelectedShop, addShop, updateShop, deleteShop, allMonthlyTargets, loading, refreshDataForShop, refreshShopDirectory, loadInitialData, selectedDatasetId, selectedPerformanceId]);
  
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
