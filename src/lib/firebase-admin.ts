import "server-only"

import {
  applicationDefault,
  getApp,
  getApps,
  initializeApp,
} from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import {
  FieldPath,
  FieldValue,
  getFirestore,
  type DocumentReference,
} from "firebase-admin/firestore"
import { cert } from "firebase-admin/app"

const projectId = process.env.FIREBASE_PROJECT_ID || "perf-tracker-lmp2b"
const FIREBASE_CLIENT_EMAIL =
  "firebase-adminsdk-fbsvc@perf-tracker-lmp2b.iam.gserviceaccount.com"
const FIREBASE_PRIVATE_KEY =
  "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDMBITvyGggU1uX\nwtubXN73Ra9unDzeWESRa0Y6Lr8HoElgwhQlDUARGtuW7wf1UCOH6wIPHl70JjHv\nhN3zI/WerOB2as0kzQ3nWTaXA3d3oXpbOKqOcEBRyOXE+KvTgrgDw9XWr7a/02bA\nNrAim3R7DLE8eblR7vp/C2717Rr0zFKdxSpL06UCFVhmH9M58XDRfVeBCelD7m3n\nqbiFrOvhfTkzrZ/66RPcyhfZ6ueAUZPeFo0YnliFq5vVnlVjxp0FvylRClNT48wF\n18dUSftjf/OQkqwQkLzKn0sW9tNxhgLwYYpLBHUYXrqpcbeJzXQxPvtyKA7U6BO5\nKpkFcyf/AgMBAAECggEANm2OOZoxjU4vxVEK3WvtX/KLVur/oiHSSSlhVuxZsmMk\nsFeWoDvkt6t+ocmrSdrTX9NmfToRAvmdoNTFkbQqNubQC0d66zJ5XxsB4U/fc171\nEZkQh2eTAT6jbeUZkhfxl6+LQPcnvg1cADOW0eS/MoS0U/n1YtJqqbIXLCzRYDUY\nYorWPdTd6c8Y/RrSkvi8TAC26/C5Utq50osDRwCNhSFwPBdpp743PGKPbHlYHjvg\nJZS8IBJ7O04HD3B96k2XC+f0xlKkY0YGBQ723wK/H6frIx7n0f7/uspdo0e0SPP+\nM/ZFlCn5UVgxFvaPmKzfL/JT2iihqPbLiKnpJAJ0AQKBgQDsfN1exTdGGPjGMNkj\n9/DoDabu8HHYN/x7G/BLaVB3NNegYd07NjSxP38FmCuFz5SJGjrwxQdra99bO96d\nJ1FMu4r4J9rivdKeorA92lIj2OG76TQ/2xqL0RXbmQAOigXF0081o/MYAL7Y9u+N\n/YsxIRIgN/2WhHg6srdBMVLgfwKBgQDc2dDEMe9OePB8tfPQ2Xf2+pVp9frpHAzw\nM0KQv8SU665ctOL+HH/sYu7yaPoO0rU3uU2ABsTagjSz5i+9d2J+XF/fqN8pg+8w\nY0HVwuuC7zFqgTYVv9/whiCmwYgVEvRGIjf3nHk9xLqcioMA2rud1NLmLBo/1Nok\nHflC5Ev4gQKBgCULYjnoNsJaQw34tOr3eds/2DhxncO68WfvdnK5qosh0e0jp14R\nHavuQF2F+rtZSvE3FKiGlKT1HuXRuQtxD0Ev15ML2zPNfGKxJV5rBpbq8GFZJIAk\nOEJSnFPr4aBlaoYUlcHXTsshwsOF2vypDNbDUW2Ol8CuO48mU6J4sXzNAoGAD5zS\nVlxVV43TKm3Oe7Az++DBGUmLYFlcTMrC5Oq5ofF7VRBwj5hCLtrbm4VyUAPzTaoq\n4WcZGX1k7mbSbyl2bAppuKz+gbfS+++4Yr0x2wK/0pCp2yXCVgWVX1SFI0BAxoh6\nvmVwaL50lsZv9mqAIus9sYninSqV9UGtMl5jRIECgYEAyyLi3ITLP1IkGNqKIkiU\nMMo6KFV6gOYt86ni00cJU4OeS76dHZMcnh8xaPM1mAKGCBolFVZT/+JqAVq+pzd7\n0mgJI4DOtQObMN8LuWDBl6h+byQu0zpk+dJFS1gF45WHxqwEIQiZWj3A5sJKvhWR\nmJvPi8Kyzck70yMmFjNUR8Q=\n-----END PRIVATE KEY-----\n"

const app = getApps().length
  ? getApp()
  : initializeApp({
      credential: cert({
        projectId,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
      projectId,
    })

export const adminDb = getFirestore(app)
export const adminAuth = getAuth(app)
export type { DocumentReference }

type QueryLike = FirebaseFirestore.Query | FirebaseFirestore.CollectionReference
type QueryConstraint = (reference: QueryLike) => QueryLike

const pathFrom = (segments: string[]) => segments.join("/")

export const collection = (_database: typeof adminDb, ...segments: string[]) =>
  adminDb.collection(pathFrom(segments))
export const collectionGroup = (_database: typeof adminDb, name: string) =>
  adminDb.collectionGroup(name)
export const doc = (_database: typeof adminDb, ...segments: string[]) =>
  adminDb.doc(pathFrom(segments))
export const documentId = () => FieldPath.documentId()
export const deleteField = () => FieldValue.delete()
export const addDoc = (
  reference: FirebaseFirestore.CollectionReference,
  data: FirebaseFirestore.DocumentData,
) => reference.add(data)
export const updateDoc = (
  reference: DocumentReference,
  data: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
) => reference.update(data)
export const getDocs = (reference: QueryLike) => reference.get()
export const writeBatch = (_database: typeof adminDb) => adminDb.batch()
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
  _database: typeof adminDb,
  callback: (transaction: FirebaseFirestore.Transaction) => Promise<T>,
) => adminDb.runTransaction(callback)
