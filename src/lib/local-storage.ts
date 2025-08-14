import { type Shop, type PerformanceData, type Target, getInitialTargets } from './types';

// Local storage fallback for development
const STORAGE_KEYS = {
  SHOPS: 'targeti_shops',
  PERFORMANCE: 'targeti_performance',
  TARGETS: 'targeti_targets'
};

export class LocalDataManager {
  private static instance: LocalDataManager;
  
  private constructor() {}
  
  static getInstance(): LocalDataManager {
    if (!LocalDataManager.instance) {
      LocalDataManager.instance = new LocalDataManager();
    }
    return LocalDataManager.instance;
  }

  // Shops management
  getShops(): Shop[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SHOPS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  saveShop(shop: Shop): Shop {
    const shops = this.getShops();
    const existingIndex = shops.findIndex(s => s.id === shop.id);
    
    if (existingIndex >= 0) {
      shops[existingIndex] = shop;
    } else {
      shops.push(shop);
    }
    
    localStorage.setItem(STORAGE_KEYS.SHOPS, JSON.stringify(shops));
    return shop;
  }

  deleteShop(shopId: string): boolean {
    const shops = this.getShops();
    const filteredShops = shops.filter(s => s.id !== shopId);
    
    if (filteredShops.length !== shops.length) {
      localStorage.setItem(STORAGE_KEYS.SHOPS, JSON.stringify(filteredShops));
      return true;
    }
    return false;
  }

  // Performance data management
  getPerformanceData(shopId: string): PerformanceData[] {
    try {
      const data = localStorage.getItem(`${STORAGE_KEYS.PERFORMANCE}_${shopId}`);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  savePerformanceData(shopId: string, data: PerformanceData[]): void {
    localStorage.setItem(`${STORAGE_KEYS.PERFORMANCE}_${shopId}`, JSON.stringify(data));
  }

  // Targets management
  getTargets(shopId: string): Target {
    try {
      const data = localStorage.getItem(`${STORAGE_KEYS.TARGETS}_${shopId}`);
      return data ? JSON.parse(data) : getInitialTargets();
    } catch {
      return getInitialTargets();
    }
  }

  saveTargets(shopId: string, targets: Target): void {
    localStorage.setItem(`${STORAGE_KEYS.TARGETS}_${shopId}`, JSON.stringify(targets));
  }

  // Initialize with sample data if empty
  initializeWithSampleData(): void {
    const shops = this.getShops();
    if (shops.length === 0) {
      const sampleShop: Shop = {
        id: 'sample-shop-1',
        name: 'Sample Shop',
        description: 'This is a sample shop to get you started',
        salesRepresentatives: [
          { id: 'rep-1', name: 'John Doe' },
          { id: 'rep-2', name: 'Jane Smith' }
        ],
        monthlyTargets: getInitialTargets()
      };
      
      this.saveShop(sampleShop);
      this.saveTargets(sampleShop.id, sampleShop.monthlyTargets);
      this.savePerformanceData(sampleShop.id, []);
    }
  }
}

export const localDataManager = LocalDataManager.getInstance();
