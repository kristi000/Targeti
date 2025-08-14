
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
    console.error("Error saving targets:", error);
    return { success: false, error: "Failed to save targets." };
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
        console.error(`Error saving performance data for shop ${shopId}:`, error);
        return { success: false, error: "Failed to save performance data" };
    }
}

export async function handleAddShop(shopName: string, description?: string) {
    try {
        const monthlyTargets = getInitialTargets();
        const docRef = await addDoc(collection(db, "shops"), {
            name: shopName,
            description: description || "",
            salesRepresentatives: [],
            monthlyTargets
        });
        const newShop: Shop = {
            id: docRef.id,
            name: shopName,
            description: description || "",
            salesRepresentatives: [],
            monthlyTargets,
        };
        return { success: true, data: newShop };
    } catch (error) {
        console.error("Error adding shop:", error);
        return { success: false, error: "Failed to add shop." };
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
        console.error("Error updating shop:", error);
        return { success: false, error: "Failed to update shop." };
    }
}

export async function handleDeleteShop(shopId: string) {
    try {
        await deleteDoc(doc(db, "shops", shopId));
        return { success: true };
    } catch (error) {
        console.error("Error deleting shop:", error);
        return { success: false, error: "Failed to delete shop." };
    }
}

export async function fetchShops(): Promise<Shop[]> {
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
}

export async function fetchPerformanceData(shopId: string): Promise<PerformanceData[]> {
    const performanceCollection = collection(db, "shops", shopId, "performance");
    const performanceSnapshot = await getDocs(performanceCollection);
    const performanceData: PerformanceData[] = [];
    performanceSnapshot.forEach(doc => {
        performanceData.push({ id: doc.id, ...doc.data() } as PerformanceData);
    });
    return performanceData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}
