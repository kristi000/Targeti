
"use server";

import {
  analyzePerformanceData,
  type AnalyzePerformanceDataInput,
} from "@/ai/flows/analyze-performance-data";
import {
  generateWhatsappMessage,
  type GenerateWhatsappMessageInput,
} from "@/ai/flows/generate-whatsapp-message";
import { type PerformanceData, type Target, type Shop, type RepPerformanceData, getInitialTargets } from "@/lib/types";
import { db } from "@/lib/firebase";
import { collection, addDoc, doc, updateDoc, deleteDoc, writeBatch, getDocs, getDoc } from "firebase/firestore";

// Ensure Firebase is initialized
if (!db) {
  throw new Error("Firebase database not initialized. Please check your configuration.");
}

export async function handleAnalyzePerformanceData(
  input: AnalyzePerformanceDataInput
) {
  try {
    const result = await analyzePerformanceData(input);
    return { success: true, data: result };
  } catch (error) {
    console.error("Error analyzing performance data:", error);
    return { success: false, error: "Failed to analyze performance data." };
  }
}

export async function handleGenerateWhatsappMessage(
  input: GenerateWhatsappMessageInput
) {
  try {
    const result = await generateWhatsappMessage(input);
    return { success: true, data: result };
  } catch (error) {
    console.error("Error generating WhatsApp message:", error);
    return { success: false, error: "Failed to generate message." };
  }
}

export async function handleSaveTargets(shopId: string, targets: Record<string, number>) {
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
        
        // Clear existing data for simplicity, or implement more complex update logic
        const existingDocs = await getDocs(performanceCollectionRef);
        existingDocs.forEach(doc => batch.delete(doc.ref));

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
            
            localDataManager.savePerformanceData(shopId, data);
            console.log("Performance data saved to local storage for shop:", shopId);
            
            return { success: true, data, fallback: true };
        } catch (fallbackError) {
            console.error("Local storage fallback also failed:", fallbackError);
            return { success: false, error: "Failed to save performance data" };
        }
    }
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
            salesRepresentatives: shop.salesRepresentatives
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
                salesRepresentatives: data.salesRepresentatives,
                monthlyTargets: data.monthlyTargets,
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
