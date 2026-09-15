"use server";

import { z } from "zod";
import { addDoc, collection, deleteField, doc, documentId, getDocs, limit, query, updateDoc, where, writeBatch } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/access";
import { refreshDashboardSummaries } from "@/app/dashboard-actions";
import { newSupervisorSchema, shopIdSchema, supervisorIdSchema, supervisorSchema } from "@/lib/persistence-schemas";
import { type Supervisor } from "@/lib/types";
import { createActivity, mutationError, recordActivity } from "@/app/actions/shared";
import { adminDb as db } from "@/lib/firebase-admin";

async function supervisorNameExists(name: string, excludedId?: string) {
  const normalizedName = name.toLocaleLowerCase();
  const snapshot = await getDocs(collection(db, "supervisors"));
  return snapshot.docs.some(document => document.id !== excludedId && String(document.data().name ?? "").trim().toLocaleLowerCase() === normalizedName);
}

export async function handleAddSupervisor(name: string) {
  try {
    await requireAdmin();
    const input = newSupervisorSchema.parse({ name });
    if (await supervisorNameExists(input.name)) throw new Error("DUPLICATE_SUPERVISOR");
    const document = await addDoc(collection(db, "supervisors"), input);
    const supervisor = { id: document.id, name: input.name } satisfies Supervisor;
    await recordActivity({ action: "supervisor_created", summary: `Created supervisor ${supervisor.name}.`, shopIds: [], shopNames: [], metadata: { supervisorId: supervisor.id } });
    return { success: true as const, data: supervisor };
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_SUPERVISOR") return { success: false as const, error: "A supervisor with this name already exists." };
    return { success: false as const, error: mutationError("add the supervisor", error) };
  }
}

export async function handleUpdateSupervisor(supervisor: Supervisor) {
  try {
    await requireAdmin();
    const validSupervisor = supervisorSchema.parse(supervisor) as Supervisor;
    if (await supervisorNameExists(validSupervisor.name, validSupervisor.id)) throw new Error("DUPLICATE_SUPERVISOR");
    await updateDoc(doc(db, "supervisors", validSupervisor.id), { name: validSupervisor.name });
    const assignedShops = await getDocs(query(collection(db, "shops"), where("supervisorId", "==", validSupervisor.id)));
    if (!assignedShops.empty) await refreshDashboardSummaries({ shopIds: assignedShops.docs.map(document => document.id) });
    await recordActivity({ action: "supervisor_edited", summary: `Renamed supervisor to ${validSupervisor.name}.`, shopIds: [], shopNames: [], metadata: { supervisorId: validSupervisor.id } });
    return { success: true as const, data: validSupervisor };
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_SUPERVISOR") return { success: false as const, error: "A supervisor with this name already exists." };
    return { success: false as const, error: mutationError("update the supervisor", error) };
  }
}

export async function handleAssignSupervisor(supervisorId: string, shopIds: string[]) {
  try {
    await requireAdmin();
    const validSupervisorId = supervisorIdSchema.parse(supervisorId);
    const validShopIds = z.array(shopIdSchema).max(500).parse(shopIds);
    const [supervisorDocument, shopsSnapshot] = await Promise.all([
      getDocs(query(collection(db, "supervisors"), where(documentId(), "==", validSupervisorId), limit(1))),
      getDocs(collection(db, "shops")),
    ]);
    if (!supervisorDocument.docs[0]) throw new Error("SUPERVISOR_NOT_FOUND");
    const selectedIds = new Set(validShopIds);
    if (shopsSnapshot.docs.filter(document => selectedIds.has(document.id)).length !== selectedIds.size) throw new Error("SHOP_NOT_FOUND");
    const changedDocuments = shopsSnapshot.docs.filter(document => selectedIds.has(document.id) || document.data().supervisorId === validSupervisorId);
    for (let start = 0; start < changedDocuments.length; start += 450) {
      const batch = writeBatch(db);
      changedDocuments.slice(start, start + 450).forEach(document => batch.update(document.ref, {
        supervisorId: selectedIds.has(document.id) ? validSupervisorId : deleteField(),
      }));
      await batch.commit();
    }
    if (changedDocuments.length) await refreshDashboardSummaries({ shopIds: changedDocuments.map(document => document.id) });
    const selectedShops = shopsSnapshot.docs.filter(document => selectedIds.has(document.id));
    const supervisorName = String(supervisorDocument.docs[0].data().name ?? validSupervisorId);
    await recordActivity({ action: "supervisor_assignments_changed", summary: `Assigned ${selectedShops.length} shop(s) to ${supervisorName}.`, shopIds: selectedShops.map(document => document.id), shopNames: selectedShops.map(document => String(document.data().name ?? document.id)), metadata: { supervisorId: validSupervisorId, shopCount: selectedShops.length } });
    return { success: true as const, count: selectedShops.length };
  } catch (error) {
    if (error instanceof Error && error.message === "SUPERVISOR_NOT_FOUND") return { success: false as const, error: "The supervisor no longer exists." };
    if (error instanceof Error && error.message === "SHOP_NOT_FOUND") return { success: false as const, error: "One or more shops no longer exist." };
    return { success: false as const, error: mutationError("assign shops to the supervisor", error) };
  }
}

export async function handleDeleteSupervisor(supervisorId: string) {
  try {
    await requireAdmin();
    const validSupervisorId = supervisorIdSchema.parse(supervisorId);
    const [supervisorSnapshot, assignedShops] = await Promise.all([
      getDocs(query(collection(db, "supervisors"), where(documentId(), "==", validSupervisorId), limit(1))),
      getDocs(query(collection(db, "shops"), where("supervisorId", "==", validSupervisorId))),
    ]);
    const supervisorDocument = supervisorSnapshot.docs[0];
    if (!supervisorDocument) throw new Error("SUPERVISOR_NOT_FOUND");
    for (let start = 0; start < assignedShops.docs.length; start += 450) {
      const batch = writeBatch(db);
      assignedShops.docs.slice(start, start + 450).forEach(document => batch.update(document.ref, { supervisorId: deleteField() }));
      await batch.commit();
    }
    const supervisorName = String(supervisorDocument.data().name ?? validSupervisorId);
    const activity = await createActivity({ action: "supervisor_deleted", summary: `Deleted supervisor ${supervisorName} and unassigned ${assignedShops.size} shop(s).`, shopIds: assignedShops.docs.map(document => document.id), shopNames: assignedShops.docs.map(document => String(document.data().name ?? document.id)), metadata: { supervisorId: validSupervisorId, shopCount: assignedShops.size } });
    const finalBatch = writeBatch(db);
    finalBatch.delete(supervisorDocument.ref);
    finalBatch.set(activity.reference, activity.data);
    await finalBatch.commit();
    if (!assignedShops.empty) await refreshDashboardSummaries({ shopIds: assignedShops.docs.map(document => document.id) });
    return { success: true as const };
  } catch (error) {
    if (error instanceof Error && error.message === "SUPERVISOR_NOT_FOUND") return { success: false as const, error: "The supervisor no longer exists." };
    return { success: false as const, error: mutationError("delete the supervisor", error) };
  }
}
