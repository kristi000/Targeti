
'use client';

import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import { type Shop, type PerformanceData, type Target, getInitialTargets } from '@/lib/types';
import { handleAddShop, handleDeleteShop, handleUpdateShop, handleSaveTargets, handleSavePerformanceData, fetchShops, fetchPerformanceData } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { useTranslations } from 'next-intl';

type ShopContextType = {
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
};

const ShopContext = createContext<ShopContextType | undefined>(undefined);

export function ShopProvider({ children }: { children: React.ReactNode }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [allPerformanceData, setAllPerformanceData] = useState<Record<string, PerformanceData[]>>({});
  const [allMonthlyTargets, setAllMonthlyTargets] = useState<Record<string, Target>>({});
  const [loading, setLoading] = useState(true);

  const { toast } = useToast();
  const t = useTranslations("Toasts");

  const refreshDataForShop = useCallback(async (shopId: string) => {
    try {
        const perfData = await fetchPerformanceData(shopId);
        setAllPerformanceData(prev => ({ ...prev, [shopId]: perfData }));

        const updatedShops = await fetchShops();
        const shop = updatedShops.find(s => s.id === shopId);
        if (shop?.monthlyTargets) {
            setAllMonthlyTargets(prev => ({ ...prev, [shopId]: shop.monthlyTargets! }));
        }
    } catch (error) {
        console.error(`Failed to refresh data for shop ${shopId}:`, error);
        toast({
            variant: "destructive",
            title: t('error'),
            description: `Failed to refresh data for the shop.`
        });
    }
  }, [toast, t]);

  useEffect(() => {
    async function loadInitialData() {
      setLoading(true);
      try {
        const fetchedShops = await fetchShops();
        const performanceDataPromises = fetchedShops.map(shop => fetchPerformanceData(shop.id));
        const allPerformanceDataResults = await Promise.all(performanceDataPromises);

        const performanceDataMap: Record<string, PerformanceData[]> = {};
        const monthlyTargetsMap: Record<string, Target> = {};

        fetchedShops.forEach((shop, index) => {
          performanceDataMap[shop.id] = allPerformanceDataResults[index];
          if (shop.monthlyTargets) {
            monthlyTargetsMap[shop.id] = shop.monthlyTargets;
          } else {
            // If for some reason a shop in the DB has no targets, initialize them.
            monthlyTargetsMap[shop.id] = getInitialTargets();
          }
        });
        
        setShops(fetchedShops);
        setAllPerformanceData(performanceDataMap);
        setAllMonthlyTargets(monthlyTargetsMap);
        
        if (fetchedShops.length > 0 && !selectedShop) {
          setSelectedShop(fetchedShops[0]);
        }

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
    }
    loadInitialData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const addShop = useCallback(async (shopName: string, description?: string) => {
    const result = await handleAddShop(shopName, description);
    if (result.success && result.data) {
        const newShop = result.data;
        setShops(prev => [...prev, newShop]);
        if (newShop.monthlyTargets) {
            setAllMonthlyTargets(prev => ({...prev, [newShop.id]: newShop.monthlyTargets!}));
        }
        setAllPerformanceData(prev => ({...prev, [newShop.id]: []}));
        toast({ title: t('shopAdded'), description: t('shopAddedSuccess', {shopName}) });
    } else {
        toast({ variant: "destructive", title: t('error'), description: t('addShopFailed') });
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
    refreshDataForShop
  }), [shops, selectedShop, addShop, updateShop, deleteShop, allPerformanceData, allMonthlyTargets, updatePerformanceData, updateMonthlyTargets, loading, refreshDataForShop]);
  
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
