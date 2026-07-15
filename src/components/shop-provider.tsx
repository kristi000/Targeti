
'use client';

import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { type Shop, type PerformanceData, type Target, getInitialTargets } from '@/lib/types';
import { handleAddShop, handleDeleteShop, handleUpdateShop, handleSaveTargets, handleSavePerformanceData, fetchShopData, type ShopData } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { useTranslations } from 'next-intl';
import type { AppActor } from '@/lib/access';

type ShopContextType = {
  actor: AppActor;
  isAdmin: boolean;
  shops: Shop[];
  selectedShop: Shop | null;
  setSelectedShop: (shop: Shop | null) => void;
  addShop: (shopName: string, description?: string) => Promise<void>;
  updateShop: (shop: Shop) => Promise<void>;
  deleteShop: (shopId: string) => Promise<void>;
  allPerformanceData: Record<string, PerformanceData[]>;
  allMonthlyTargets: Record<string, Target>;
  updatePerformanceData: (shopId: string, data: PerformanceData[]) => void;
  updateMonthlyTargets: (shopId: string, targets: Target) => void;
  loading: boolean;
  refreshDataForShop: (shopId: string) => Promise<void>;
  reloadData: () => Promise<void>;
  selectedDatasetId: string;
  setSelectedDatasetId: (datasetId: string) => void;
};

const ShopContext = createContext<ShopContextType | undefined>(undefined);

export function ShopProvider({ children, initialData, actor }: { children: React.ReactNode; initialData: ShopData; actor: AppActor }) {
  const [shops, setShops] = useState<Shop[]>(initialData.shops);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(initialData.shops[0] ?? null);
  const [allPerformanceData, setAllPerformanceData] = useState<Record<string, PerformanceData[]>>(initialData.performanceData);
  const [allMonthlyTargets, setAllMonthlyTargets] = useState<Record<string, Target>>(initialData.monthlyTargets);
  const [loading, setLoading] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");

  const { toast } = useToast();
  const t = useTranslations("Toasts");

  const refreshDataForShop = useCallback(async (shopId: string) => {
    try {
        const data = await fetchShopData();
        const shop = data.shops.find(item => item.id === shopId);
        setShops(data.shops);
        setAllPerformanceData(data.performanceData);
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
  }, [toast, t]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const { shops, performanceData, monthlyTargets } = await fetchShopData();
      
      setShops(shops);
      setAllPerformanceData(performanceData);
      setAllMonthlyTargets(monthlyTargets);
      
      setSelectedShop(current => shops.find(shop => shop.id === current?.id) ?? shops[0] ?? null);
      
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
  }, [toast, t]);

  const addShop = useCallback(async (shopName: string, description?: string) => {
    setLoading(true);
    try {
        console.log("Adding shop in provider:", shopName);
        const result = await handleAddShop(shopName, description);
        if (result.success && result.data) {
            const newShop = result.data;
            setShops(prev => [...prev, newShop]);
            if (newShop.monthlyTargets) {
                const targets = newShop.monthlyTargets as Target;
                setAllMonthlyTargets(prev => ({...prev, [newShop.id]: targets}));
            }
            setAllPerformanceData(prev => ({...prev, [newShop.id]: []}));
            
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
      // Also remove data associated with the shop
      setAllPerformanceData(prev => {
        const newData = {...prev};
        delete newData[shopId];
        return newData;
      });
      setAllMonthlyTargets(prev => {
        const newTargets = {...prev};
        delete newTargets[shopId];
        return newTargets;
      });
      toast({ title: t('shopDeleted'), description: t('shopDeletedSuccess') });
    } else {
      toast({ variant: "destructive", title: t('error'), description: t('deleteShopFailed') });
    }
  }, [selectedShop?.id, toast, t]);

  const handleSetSelectedShop = (shop: Shop | null) => {
    setSelectedShop(shop);
  };
  
  const updatePerformanceData = useCallback(async (shopId: string, data: PerformanceData[]) => {
      const result = await handleSavePerformanceData(shopId, data);
      if (result.success && result.data) {
        setAllPerformanceData(prev => ({...prev, [shopId]: result.data!}));
      }
  }, []);

  const updateMonthlyTargets = useCallback(async (shopId: string, targets: Target) => {
      const result = await handleSaveTargets(shopId, targets);
      if(result.success && result.data) {
        setAllMonthlyTargets(prev => ({...prev, [shopId]: result.data!}));
        setShops(prev => prev.map(s => s.id === shopId ? {...s, monthlyTargets: result.data} : s));
      }
  }, []);

  const contextValue = useMemo(() => ({
    actor,
    isAdmin: actor.role === "admin",
    shops,
    selectedShop: selectedShop,
    setSelectedShop: handleSetSelectedShop,
    addShop,
    updateShop,
    deleteShop,
    allPerformanceData,
    allMonthlyTargets,
    updatePerformanceData,
    updateMonthlyTargets,
    loading,
    refreshDataForShop,
    reloadData: loadInitialData,
    selectedDatasetId,
    setSelectedDatasetId,
  }), [actor, shops, selectedShop, addShop, updateShop, deleteShop, allPerformanceData, allMonthlyTargets, updatePerformanceData, updateMonthlyTargets, loading, refreshDataForShop, loadInitialData, selectedDatasetId]);
  
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
