import "server-only";
import { readSheet } from "read-excel-file/node";
import { createHash } from "node:crypto";
import { attendanceMonthSchema, procedureFieldsSchema, procedureDateTimeSchema } from "@/lib/persistence-schemas";
import { adjustProcedureSummary, EMPTY_PROCEDURE_SUMMARY } from "@/lib/procedures";

const HEADERS = ["Order Number", "Name", "ID", "Product", "Date", "User", "Status"];

export async function readProceduresWorkbook(bytes: Buffer, month: string, correctReversedDates: boolean) {
  attendanceMonthSchema.parse(month);
  const sheet = await readSheet(bytes);
  if (!HEADERS.every((header, index) => String(sheet[0]?.[index] ?? "").trim() === header)) throw new Error("invalidWorkbook");
  const summary = { ...EMPTY_PROCEDURE_SUMMARY };
  let correctedDates = 0;
  const rows = sheet.slice(1).flatMap((cells, index) => {
    if (cells.slice(0, 7).every(cell => cell === null || cell === "" || cell === undefined)) return [];
    const rawDate = cells[4];
    const date = rawDate instanceof Date ? rawDate : typeof rawDate === "number" ? new Date(Date.UTC(1899, 11, 30) + Math.round(rawDate * 86400000)) : null;
    if (!date || !Number.isFinite(date.getTime())) throw new Error("invalidWorkbook");
    const originalDateTime = procedureDateTimeSchema.parse(new Date(Math.round(date.getTime() / 1000) * 1000).toISOString().slice(0, 19));
    let dateTime = originalDateTime;
    if (correctReversedDates && !dateTime.startsWith(`${month}-`)) {
      // The source accidentally stores e.g. October 8 as August 10. Never rewrite unrelated dates.
      if (dateTime.slice(0, 4) !== month.slice(0, 4) || dateTime.slice(8, 10) !== month.slice(5, 7)) throw new Error("dateMismatch");
      dateTime = `${month}-${dateTime.slice(5, 7)}${dateTime.slice(10)}`;
      correctedDates += 1;
    }
    const text = (column: number) => String(cells[column] ?? "").trim();
    const fields = procedureFieldsSchema.parse({ orderNumber: text(0), name: text(1), customerId: text(2), product: text(3), dateTime, user: text(5), status: text(6).toLowerCase() });
    adjustProcedureSummary(summary, fields, 1);
    return [{ fields, row: index + 2, originalDateTime }];
  });
  if (!rows.length || rows.length > 400) throw new Error("invalidWorkbook");
  return { rows, summary, correctedDates, fileHash: createHash("sha256").update(bytes).digest("hex") };
}
