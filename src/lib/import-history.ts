export type ImportHistoryItem = {
  id: string;
  fileName: string;
  month: string;
  createdAt: string;
  actorName: string;
  status: "active" | "superseded" | "undone" | "removed";
  recordCount: number;
  undoneAt?: string;
};
