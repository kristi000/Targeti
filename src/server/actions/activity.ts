"use server";

import { z } from "zod";
import { collection, documentId, getDocs, limit, orderBy, query, startAfter } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/access";
import { activityEventSchema, shopIdSchema } from "@/lib/persistence-schemas";
import { type ActivityEvent } from "@/lib/types";
import { adminDb as db } from "@/lib/firebase-admin";

const activityCursorSchema = z.object({ occurredAt: z.string().datetime({ offset: true }), id: shopIdSchema }).optional();

export async function fetchActivityPage(cursor?: { occurredAt: string; id: string }) {
  await requireAdmin();
  const validCursor = activityCursorSchema.parse(cursor);
  const constraints = [orderBy("occurredAt", "desc"), orderBy(documentId(), "desc"), ...(validCursor ? [startAfter(validCursor.occurredAt, validCursor.id)] : []), limit(21)];
  const snapshot = await getDocs(query(collection(db, "activity"), ...constraints));
  const hasMore = snapshot.docs.length > 20;
  const documents = snapshot.docs.slice(0, 20);
  const events = documents.flatMap(document => {
    const parsed = activityEventSchema.safeParse({ id: document.id, ...document.data() });
    return parsed.success ? [parsed.data as ActivityEvent] : [];
  });
  const last = documents.at(-1);
  return {
    events,
    nextCursor: hasMore && last ? { occurredAt: String(last.data().occurredAt), id: last.id } : null,
  };
}
