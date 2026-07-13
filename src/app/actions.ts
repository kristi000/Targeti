
"use server";

import { type PerformanceData, type Target, type Shop, type BonusSnapshot, getInitialTargets } from "@/lib/types";
import { db } from "@/lib/firebase";
import { collection, addDoc, doc, updateDoc, deleteDoc, writeBatch, getDocs, runTransaction, type DocumentReference } from "firebase/firestore";

// Ensure Firebase is initialized
if (!db) {
  throw new Error("Firebase database not initialized. Please check your configuration.");
}

export async function handleSaveTargets(shopId: string, targets: Target) {
  try {
    const shopRef = doc(db, "shops", shopId);
    await updateDoc(shopRef, { monthlyTargets: targets });
    return { success: true, data: targets };
  } catch (error) {
    console.error("Error saving targets with Firebase:", error);
    
    // If Firebase fails, try local storage as fallback
    try {
        console.log("Falling back to local storage for targets...");
        const { localDataManager } = await import('@/lib/local-storage');
        
        localDataManager.saveTargets(shopId, targets as Target);
        console.log("Targets saved to local storage for shop:", shopId);
        
        return { success: true, data: targets, fallback: true };
    } catch (fallbackError) {
        console.error("Local storage fallback also failed:", fallbackError);
        return { success: false, error: "Failed to save targets." };
    }
  }
}

export async function handleSavePerformanceData(shopId: string, data: PerformanceData[]) {
    try {
        const batch = writeBatch(db);
        const performanceCollectionRef = collection(db, "shops", shopId, "performance");
        
        data.forEach(performanceEntry => {
            const docRef = doc(performanceCollectionRef, performanceEntry.date);
            batch.set(docRef, performanceEntry);
        });

        await batch.commit();
        return { success: true, data };
    } catch (error) {
        console.error(`Error saving performance data with Firebase for shop ${shopId}:`, error);
        
        // If Firebase fails, try local storage as fallback
        try {
            console.log("Falling back to local storage for performance data...");
            const { localDataManager } = await import('@/lib/local-storage');
            
            const merged = new Map(localDataManager.getPerformanceData(shopId).map(item => [item.date, item]));
            data.forEach(item => merged.set(item.date, item));
            localDataManager.savePerformanceData(shopId, [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)));
            console.log("Performance data saved to local storage for shop:", shopId);
            
            return { success: true, data, fallback: true };
        } catch (fallbackError) {
            console.error("Local storage fallback also failed:", fallbackError);
            return { success: false, error: "Failed to save performance data" };
        }
    }
}

export async function handleSaveExcelPerformanceData(shopId: string, data: PerformanceData[]) {
    try {
        const batch = writeBatch(db);
        const performanceCollectionRef = collection(db, "shops", shopId, "performance");
        data.forEach(performanceEntry => {
            batch.set(doc(performanceCollectionRef, performanceEntry.importId ?? performanceEntry.date), performanceEntry);
        });
        await batch.commit();
        return { success: true, data };
    } catch (error) {
        console.error(`Error saving Excel performance data for shop ${shopId}:`, error);
        try {
            const { localDataManager } = await import('@/lib/local-storage');
            const existing = localDataManager.getPerformanceData(shopId);
            const merged = new Map(existing.map(item => [item.importId ?? item.id ?? item.date, item]));
            data.forEach(item => merged.set(item.importId ?? item.date, item));
            const result = [...merged.values()].sort((a, b) => (a.importedAt ?? a.date).localeCompare(b.importedAt ?? b.date));
            localDataManager.savePerformanceData(shopId, result);
            return { success: true, data: result, fallback: true };
        } catch (fallbackError) {
            console.error("Local storage Excel save also failed:", fallbackError);
            return { success: false, error: "Failed to save Excel performance data." };
        }
    }
}

export async function saveBonusSnapshot(shopId: string, snapshot: BonusSnapshot) {
    const snapshotRef = doc(db, "shops", shopId, "bonusSnapshots", snapshot.month);
    try {
        await runTransaction(db, async transaction => {
            if ((await transaction.get(snapshotRef)).exists()) throw new Error("ALREADY_FINALIZED");
            transaction.set(snapshotRef, JSON.parse(JSON.stringify(snapshot)) as BonusSnapshot);
        });
        return { success: true, data: snapshot };
    } catch (error) {
        return { success: false, error: error instanceof Error && error.message === "ALREADY_FINALIZED" ? "This month has already been finalized." : "Could not save the payroll snapshot." };
    }
}

export async function fetchBonusSnapshots(shopId: string): Promise<Record<string, BonusSnapshot>> {
    const snapshot = await getDocs(collection(db, "shops", shopId, "bonusSnapshots"));
    return Object.fromEntries(snapshot.docs.map(item => [item.id, item.data() as BonusSnapshot]));
}

export async function handleAddShop(shopName: string, description?: string) {
    try {
        console.log("Starting to add shop:", shopName);
        
        // Check if we can access the database
        if (!db) {
            throw new Error("Firestore database not initialized");
        }

        const monthlyTargets = getInitialTargets();
        
        // Create the shop document
        const shopsCollectionRef = collection(db, "shops");
        console.log("Collection reference created");
        
        const shopData = {
            name: shopName,
            description: description || "",
            salesRepresentatives: [],
            monthlyTargets,
            createdAt: new Date().toISOString()
        };
        
        console.log("Adding document to collection...");
        const docRef = await addDoc(shopsCollectionRef, shopData);
        console.log("Document added successfully with ID:", docRef.id);
        
        const newShop: Shop = {
            id: docRef.id,
            name: shopName,
            description: description || "",
            salesRepresentatives: [],
            monthlyTargets,
        };
        
        console.log("Shop created successfully:", newShop);
        return { success: true, data: newShop };
    } catch (error) {
        console.error("Error adding shop with Firebase:", error);
        
        // If Firebase fails, try local storage as fallback
        try {
            console.log("Falling back to local storage...");
            const { localDataManager } = await import('@/lib/local-storage');
            
            const newShop: Shop = {
                id: `local-${Date.now()}`,
                name: shopName,
                description: description || "",
                salesRepresentatives: [],
                monthlyTargets: getInitialTargets(),
            };
            
            localDataManager.saveShop(newShop);
            console.log("Shop saved to local storage:", newShop);
            
            return { success: true, data: newShop, fallback: true };
        } catch (fallbackError) {
            console.error("Local storage fallback also failed:", fallbackError);
            
            // Provide more specific error messages
            if (error instanceof Error) {
                if (error.message.includes("permission-denied")) {
                    return { success: false, error: "Permission denied. Please check your Firebase security rules." };
                } else if (error.message.includes("unavailable")) {
                    return { success: false, error: "Firebase service unavailable. Please check your internet connection." };
                } else if (error.message.includes("NOT_FOUND")) {
                    return { success: false, error: "Database not found. Using local storage as fallback." };
                }
            }
            
            return { success: false, error: `Failed to add shop: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
    }
}

export async function handleUpdateShop(shop: Shop) {
    try {
        const shopRef = doc(db, "shops", shop.id);
        await updateDoc(shopRef, {
            name: shop.name,
            description: shop.description,
            ...(shop.revenue !== undefined && { revenue: shop.revenue }),
            salesRepresentatives: shop.salesRepresentatives,
            ...(shop.metricSettings !== undefined && { metricSettings: shop.metricSettings }),
            ...(shop.metricOrder !== undefined && { metricOrder: shop.metricOrder }),
            ...(shop.monthlyData !== undefined && { monthlyData: shop.monthlyData }),
        });
        return { success: true, data: shop };
    } catch (error) {
        console.error("Error updating shop with Firebase:", error);
        
        // If Firebase fails, try local storage as fallback
        try {
            console.log("Falling back to local storage for update...");
            const { localDataManager } = await import('@/lib/local-storage');
            
            localDataManager.saveShop(shop);
            console.log("Shop updated in local storage:", shop);
            
            return { success: true, data: shop, fallback: true };
        } catch (fallbackError) {
            console.error("Local storage fallback also failed:", fallbackError);
            return { success: false, error: "Failed to update shop." };
        }
    }
}

export async function handleDeleteShop(shopId: string) {
    try {
        await deleteDoc(doc(db, "shops", shopId));
        return { success: true };
    } catch (error) {
        console.error("Error deleting shop with Firebase:", error);
        
        // If Firebase fails, try local storage as fallback
        try {
            console.log("Falling back to local storage for delete...");
            const { localDataManager } = await import('@/lib/local-storage');
            
            const deleted = localDataManager.deleteShop(shopId);
            if (deleted) {
                console.log("Shop deleted from local storage:", shopId);
                return { success: true, fallback: true };
            } else {
                return { success: false, error: "Shop not found." };
            }
        } catch (fallbackError) {
            console.error("Local storage fallback also failed:", fallbackError);
            return { success: false, error: "Failed to delete shop." };
        }
    }
}

export async function handleClearAllData() {
    try {
        const shopsSnapshot = await getDocs(collection(db, "shops"));
        const references: DocumentReference[] = [];

        await Promise.all(shopsSnapshot.docs.map(async shopDocument => {
            const [performance, bonusSnapshots] = await Promise.all([
                getDocs(collection(db, "shops", shopDocument.id, "performance")),
                getDocs(collection(db, "shops", shopDocument.id, "bonusSnapshots")),
            ]);
            references.push(...performance.docs.map(item => item.ref));
            references.push(...bonusSnapshots.docs.map(item => item.ref));
            references.push(shopDocument.ref);
        }));

        for (let start = 0; start < references.length; start += 450) {
            const batch = writeBatch(db);
            references.slice(start, start + 450).forEach(reference => batch.delete(reference));
            await batch.commit();
        }

        return { success: true };
    } catch (error) {
        console.error("Error clearing application data:", error);
        return { success: false, error: "Failed to clear all data." };
    }
}

export async function fetchShops(): Promise<Shop[]> {
    try {
        const shopsCollection = collection(db, "shops");
        const shopsSnapshot = await getDocs(shopsCollection);
        const shops: Shop[] = [];
        shopsSnapshot.forEach(doc => {
            const data = doc.data();
            shops.push({
                id: doc.id,
                name: data.name,
                description: data.description,
                revenue: data.revenue,
                salesRepresentatives: data.salesRepresentatives,
            monthlyTargets: data.monthlyTargets,
            metricSettings: data.metricSettings,
            metricOrder: data.metricOrder,
            monthlyData: data.monthlyData,
            });
        });
        return shops;
    } catch (error) {
        console.error("Firebase fetchShops failed, using local storage:", error);
        
        // Fallback to local storage
        const { localDataManager } = await import('@/lib/local-storage');
        localDataManager.initializeWithSampleData();
        return localDataManager.getShops();
    }
}

export async function fetchPerformanceData(shopId: string): Promise<PerformanceData[]> {
    try {
        const performanceCollection = collection(db, "shops", shopId, "performance");
        const performanceSnapshot = await getDocs(performanceCollection);
        const performanceData: PerformanceData[] = [];
        performanceSnapshot.forEach(doc => {
            performanceData.push({ id: doc.id, ...doc.data() } as PerformanceData);
        });
        return performanceData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    } catch (error) {
        console.error(`Firebase fetchPerformanceData failed for shop ${shopId}, using local storage:`, error);
        
        // Fallback to local storage
        const { localDataManager } = await import('@/lib/local-storage');
        return localDataManager.getPerformanceData(shopId);
    }
}
