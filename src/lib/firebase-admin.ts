import "server-only";

import { applicationDefault, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, getFirestore, type DocumentReference } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "perf-tracker-lmp2b";

const app = getApps().length
  ? getApp()
  : initializeApp({ credential: applicationDefault(), projectId });

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
export type { DocumentReference };

type QueryLike = FirebaseFirestore.Query | FirebaseFirestore.CollectionReference;
type QueryConstraint = (reference: QueryLike) => QueryLike;

const pathFrom = (segments: string[]) => segments.join("/");

export const collection = (_database: typeof adminDb, ...segments: string[]) => adminDb.collection(pathFrom(segments));
export const collectionGroup = (_database: typeof adminDb, name: string) => adminDb.collectionGroup(name);
export const doc = (_database: typeof adminDb, ...segments: string[]) => adminDb.doc(pathFrom(segments));
export const documentId = () => FieldPath.documentId();
export const addDoc = (reference: FirebaseFirestore.CollectionReference, data: FirebaseFirestore.DocumentData) => reference.add(data);
export const updateDoc = (reference: DocumentReference, data: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>) => reference.update(data);
export const getDocs = (reference: QueryLike) => reference.get();
export const writeBatch = (_database: typeof adminDb) => adminDb.batch();
export const query = (reference: QueryLike, ...constraints: QueryConstraint[]) => constraints.reduce((current, constraint) => constraint(current), reference);
export const where = (field: string | FieldPath, operator: FirebaseFirestore.WhereFilterOp, value: unknown): QueryConstraint => reference => reference.where(field, operator, value);
export const orderBy = (field: string | FieldPath, direction: FirebaseFirestore.OrderByDirection = "asc"): QueryConstraint => reference => reference.orderBy(field, direction);
export const limit = (count: number): QueryConstraint => reference => reference.limit(count);
export const startAfter = (...values: unknown[]): QueryConstraint => reference => reference.startAfter(...values);
export const startAt = (...values: unknown[]): QueryConstraint => reference => reference.startAt(...values);
export const endAt = (...values: unknown[]): QueryConstraint => reference => reference.endAt(...values);
export const getCountFromServer = (reference: QueryLike) => reference.count().get();

export const runTransaction = <T>(_database: typeof adminDb, callback: (transaction: FirebaseFirestore.Transaction) => Promise<T>) => adminDb.runTransaction(callback);
