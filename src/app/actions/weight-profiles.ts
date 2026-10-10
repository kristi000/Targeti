"use server";

import { z } from "zod";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, where, writeBatch } from "@/lib/firebase-admin";
import { requireAdmin, requireEditorForShops } from "@/lib/access";
import { refreshDashboardSummaries } from "@/app/dashboard-actions";
import { metricWeightProfileSchema, newMetricWeightProfileSchema, shopIdSchema, weightProfileIdSchema } from "@/lib/persistence-schemas";
import { type MetricWeightProfile } from "@/lib/types";
import { getWeightProfileImportConfiguration, getWeightProfilePeriodKey } from "@/lib/import-weight-profiles";
import { mutationError, omitId, recordActivity, toFirestoreData } from "@/app/actions/shared";
import { adminDb as db } from "@/lib/firebase-admin";

function hasPeriodConflict(
  profile: Pick<MetricWeightProfile, "name" | "year" | "quarter" | "group">,
  documents: readonly { id: string; data(): unknown }[],
  excludedId?: string,
) {
  const periodKey = getWeightProfilePeriodKey(profile);
  if (!periodKey) return false;
  return documents.some(document => {
    if (document.id === excludedId) return false;
    const parsed = metricWeightProfileSchema.safeParse({ id: document.id, ...document.data() as Record<string, unknown> });
    return parsed.success && getWeightProfilePeriodKey(parsed.data) === periodKey;
  });
}

export async function handleCreateWeightProfile(profile: Omit<MetricWeightProfile, "id" | "createdAt" | "updatedAt">) {
  try {
    await requireAdmin();
    const parsed = newMetricWeightProfileSchema.parse(profile);
    const input = newMetricWeightProfileSchema.parse({ ...parsed, ...getWeightProfileImportConfiguration(parsed) });
    const existing = await getDocs(collection(db, "weightProfiles"));
    if (existing.docs.some(document => String(document.data().name ?? "").trim().toLocaleLowerCase() === input.name.toLocaleLowerCase())) {
      throw new Error("PROFILE_NAME_EXISTS");
    }
    if (hasPeriodConflict(input, existing.docs)) throw new Error("PROFILE_PERIOD_EXISTS");
    const now = new Date().toISOString();
    const data = { ...input, createdAt: now, updatedAt: now };
    const document = await addDoc(collection(db, "weightProfiles"), toFirestoreData(data));
    await recordActivity({ action: "weight_profile_created", summary: `Created weight profile ${input.name}.`, shopIds: [], shopNames: [] });
    return { success: true as const, data: { id: document.id, ...data } as MetricWeightProfile };
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_NAME_EXISTS") return { success: false as const, error: "A profile with this name already exists." };
    if (error instanceof Error && error.message === "PROFILE_PERIOD_EXISTS") return { success: false as const, error: "A weight profile already exists for this quarter, year and group.", code: "PROFILE_PERIOD_EXISTS" as const };
    return { success: false as const, error: mutationError("create the weight profile", error) };
  }
}

export async function handleUpdateWeightProfile(profile: MetricWeightProfile) {
  try {
    await requireAdmin();
    const submitted = metricWeightProfileSchema.parse({ ...profile, updatedAt: new Date().toISOString() });
    const existing = await getDocs(collection(db, "weightProfiles"));
    const currentDocument = existing.docs.find(document => document.id === submitted.id);
    if (!currentDocument) throw new Error("PROFILE_NOT_FOUND");
    const current = metricWeightProfileSchema.parse({ id: currentDocument.id, ...currentDocument.data() });
    const configuration = getWeightProfileImportConfiguration(
      submitted.year === undefined && submitted.quarter === undefined ? current : submitted,
    );
    const input = metricWeightProfileSchema.parse({ ...submitted, ...configuration }) as MetricWeightProfile;
    if (existing.docs.some(document => document.id !== input.id && String(document.data().name ?? "").trim().toLocaleLowerCase() === input.name.toLocaleLowerCase())) {
      throw new Error("PROFILE_NAME_EXISTS");
    }
    if (hasPeriodConflict(input, existing.docs, input.id)) throw new Error("PROFILE_PERIOD_EXISTS");
    const reference = doc(db, "weightProfiles", input.id);
    const data = omitId(input);
    await setDoc(reference, toFirestoreData(data));
    await recordActivity({ action: "weight_profile_edited", summary: `Edited weight profile ${input.name}.`, shopIds: [], shopNames: [] });
    return { success: true as const, data: input };
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_NAME_EXISTS") return { success: false as const, error: "A profile with this name already exists." };
    if (error instanceof Error && error.message === "PROFILE_PERIOD_EXISTS") return { success: false as const, error: "A weight profile already exists for this quarter, year and group.", code: "PROFILE_PERIOD_EXISTS" as const };
    if (error instanceof Error && error.message === "PROFILE_NOT_FOUND") return { success: false as const, error: "The weight profile no longer exists." };
    return { success: false as const, error: mutationError("update the weight profile", error) };
  }
}

export async function handleDeleteWeightProfile(profileId: string) {
  try {
    await requireAdmin();
    const id = weightProfileIdSchema.parse(profileId);
    const [profileDocument, assignedShops] = await Promise.all([
      getDoc(doc(db, "weightProfiles", id)),
      getDocs(query(collection(db, "shops"), where("weightProfileId", "==", id), limit(1))),
    ]);
    if (!profileDocument.exists) throw new Error("PROFILE_NOT_FOUND");
    if (!assignedShops.empty) throw new Error("PROFILE_ASSIGNED");
    const name = String(profileDocument.data()?.name ?? "profile");
    await deleteDoc(profileDocument.ref);
    await recordActivity({ action: "weight_profile_deleted", summary: `Deleted weight profile ${name}.`, shopIds: [], shopNames: [] });
    return { success: true as const };
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_NOT_FOUND") return { success: false as const, error: "The weight profile no longer exists." };
    if (error instanceof Error && error.message === "PROFILE_ASSIGNED") return { success: false as const, error: "Reassign every shop using this profile before deleting it." };
    return { success: false as const, error: mutationError("delete the weight profile", error) };
  }
}

export async function handleAssignWeightProfile(profileId: string, shopIds: string[]) {
  try {
    const id = weightProfileIdSchema.parse(profileId);
    const selectedIds = new Set(z.array(shopIdSchema).min(1).max(500).parse(shopIds));
    await requireEditorForShops([...selectedIds]);
    const [profileDocument, shopsSnapshot] = await Promise.all([
      getDoc(doc(db, "weightProfiles", id)),
      getDocs(collection(db, "shops")),
    ]);
    if (!profileDocument.exists) throw new Error("PROFILE_NOT_FOUND");
    const profile = metricWeightProfileSchema.parse({ id, ...profileDocument.data() });
    const selectedShops = shopsSnapshot.docs.filter(document => selectedIds.has(document.id));
    if (selectedShops.length !== selectedIds.size) throw new Error("SHOP_NOT_FOUND");
    const batch = writeBatch(db);
    selectedShops.forEach(document => batch.update(document.ref, { weightProfileId: id }));
    await batch.commit();
    await refreshDashboardSummaries({ shopIds: selectedShops.map(document => document.id) });
    await recordActivity({
      action: "weight_profile_assignments_changed",
      summary: `Assigned ${profile.name} to ${selectedShops.length} shops.`,
      shopIds: selectedShops.map(document => document.id),
      shopNames: selectedShops.map(document => String(document.data().name ?? document.id)),
      metadata: { profileId: id, shopCount: selectedShops.length },
    });
    return { success: true as const, count: selectedShops.length };
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_NOT_FOUND") return { success: false as const, error: "The weight profile no longer exists." };
    if (error instanceof Error && error.message === "SHOP_NOT_FOUND") return { success: false as const, error: "One or more shops no longer exist." };
    return { success: false as const, error: mutationError("assign the weight profile", error) };
  }
}
