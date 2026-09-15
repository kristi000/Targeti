import "server-only"

import {
  applicationDefault,
  getApp,
  getApps,
  initializeApp,
} from "firebase-admin/app"
import {
  FieldPath,
  FieldValue,
  getFirestore,
  type DocumentReference,
} from "firebase-admin/firestore"
import { cert } from "firebase-admin/app"

const projectId = process.env.FIREBASE_PROJECT_ID
  ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  ?? "perf-tracker-lmp2b"
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
const credential = clientEmail && privateKey
  ? cert({ projectId, clientEmail, privateKey })
  : applicationDefault()

const app = getApps().length
  ? getApp()
  : initializeApp({
      credential,
      ...(projectId ? { projectId } : {}),
    })

export const adminDb = getFirestore(app)
export type { DocumentReference }

type QueryLike = FirebaseFirestore.Query | FirebaseFirestore.CollectionReference
type QueryConstraint = (reference: QueryLike) => QueryLike

const pathFrom = (segments: string[]) => segments.join("/")

export const collection = (database: typeof adminDb, ...segments: string[]) =>
  database.collection(pathFrom(segments))
export const collectionGroup = (database: typeof adminDb, name: string) =>
  database.collectionGroup(name)
export const doc = (database: typeof adminDb, ...segments: string[]) =>
  database.doc(pathFrom(segments))
export const documentId = () => FieldPath.documentId()
export const deleteField = () => FieldValue.delete()
export const addDoc = (
  reference: FirebaseFirestore.CollectionReference,
  data: FirebaseFirestore.DocumentData,
) => reference.add(data)
export const getDoc = (reference: DocumentReference) => reference.get()
export const setDoc = (
  reference: DocumentReference,
  data: FirebaseFirestore.DocumentData,
) => reference.set(data)
export const deleteDoc = (reference: DocumentReference) => reference.delete()
export const updateDoc = (
  reference: DocumentReference,
  data: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
) => reference.update(data)
export const getDocs = (reference: QueryLike) => reference.get()
export const writeBatch = (database: typeof adminDb) => database.batch()
export const query = (
  reference: QueryLike,
  ...constraints: QueryConstraint[]
) => constraints.reduce((current, constraint) => constraint(current), reference)
export const where =
  (
    field: string | FieldPath,
    operator: FirebaseFirestore.WhereFilterOp,
    value: unknown,
  ): QueryConstraint =>
  (reference) =>
    reference.where(field, operator, value)
export const orderBy =
  (
    field: string | FieldPath,
    direction: FirebaseFirestore.OrderByDirection = "asc",
  ): QueryConstraint =>
  (reference) =>
    reference.orderBy(field, direction)
export const limit =
  (count: number): QueryConstraint =>
  (reference) =>
    reference.limit(count)
export const startAfter =
  (...values: unknown[]): QueryConstraint =>
  (reference) =>
    reference.startAfter(...values)
export const startAt =
  (...values: unknown[]): QueryConstraint =>
  (reference) =>
    reference.startAt(...values)
export const endAt =
  (...values: unknown[]): QueryConstraint =>
  (reference) =>
    reference.endAt(...values)
export const getCountFromServer = (reference: QueryLike) =>
  reference.count().get()

export const runTransaction = <T>(
  database: typeof adminDb,
  callback: (transaction: FirebaseFirestore.Transaction) => Promise<T>,
) => database.runTransaction(callback)
