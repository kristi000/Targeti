import { z } from "zod";
import { read, utils, type WorkBook } from "xlsx";
import { performanceMetrics, type PerformanceMetric, type Target } from "@/lib/types";
import { EXCEL_METRIC_LABELS } from "@/lib/metric-definitions";

const numericRecordSchema = z.object({
  newSim: z.number().finite().nonnegative(),
  newLine: z.number().finite().nonnegative(),
  migrations: z.number().finite().nonnegative(),
  fixContractRenewal: z.number().finite().nonnegative(),
  mobileContractRenewal: z.number().finite().nonnegative(),
  newTv: z.number().finite().nonnegative(),
  newPostpaid: z.number().finite().nonnegative(),
  device: z.number().finite().nonnegative(),
}).catchall(z.number().finite().nonnegative());
const importedWorkbookSchema = z.object({
  shopName: z.string().trim().min(1),
  date: z.string().date(),
  targets: numericRecordSchema,
  representatives: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    achievements: numericRecordSchema,
  })).min(1),
});

export type ImportedWorkbookData = z.infer<typeof importedWorkbookSchema>;
type Cell = string | number | boolean | Date | null | undefined;

function normalize(value: Cell) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function numberValue(value: Cell) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function representativeId(name: string) {
  return `excel-${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function excelDate(value: Cell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
  }
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function findRow(rows: Cell[][], label: string, start = 0) {
  const expected = normalize(label);
  return rows.findIndex((row, index) => index >= start && row.some(cell => normalize(cell) === expected));
}

function parseWorkbook(workbook: WorkBook, customMetricLabels: Partial<Record<PerformanceMetric, string>>): ImportedWorkbookData {
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("The workbook does not contain a worksheet.");

  const rows = utils.sheet_to_json<Cell[]>(firstSheet, { header: 1, raw: true, defval: null });
  const shopHeaderRowIndex = findRow(rows, "SHOP_EPOS");
  const representativesHeaderRowIndex = findRow(rows, "Users");
  if (shopHeaderRowIndex < 0 || representativesHeaderRowIndex < 0) {
    throw new Error("This file does not match the expected One Shop target report format.");
  }

  const shopHeaders = rows[shopHeaderRowIndex];
  const shopValues = rows[shopHeaderRowIndex + 1] ?? [];
  const shopNameColumn = shopHeaders.findIndex(cell => normalize(cell) === normalize("SHOP_EPOS"));
  const shopName = String(shopValues[shopNameColumn] ?? "").trim();

  const customMetricEntries = Object.entries(customMetricLabels).filter(
    (entry): entry is [PerformanceMetric, string] => typeof entry[1] === "string" && entry[1].trim().length > 0,
  );
  const metricEntries = [
    ...(Object.entries(EXCEL_METRIC_LABELS) as [PerformanceMetric, string][]),
    ...customMetricEntries,
  ];
  const targetColumns = Object.fromEntries(metricEntries.flatMap(([metric, label]) => {
    const expected = normalize(`${label} T`);
    const column = shopHeaders.findIndex(cell => normalize(cell) === expected);
    if (column < 0) {
      if (!metric.startsWith("custom_")) throw new Error(`Missing target column: ${label}`);
      return [];
    }
    return [[metric, column]];
  })) as Record<PerformanceMetric, number>;

  const repHeaders = rows[representativesHeaderRowIndex];
  const userColumn = repHeaders.findIndex(cell => normalize(cell) === "users");
  const achievementColumns = Object.fromEntries(metricEntries.flatMap(([metric, label]) => {
    const expected = normalize(`${label} A`);
    const column = repHeaders.findIndex(cell => normalize(cell) === expected);
    if (column < 0) {
      if (!metric.startsWith("custom_")) throw new Error(`Missing achievement column: ${label}`);
      return [];
    }
    return [[metric, column]];
  })) as Record<PerformanceMetric, number>;
  const importedMetrics = metricEntries
    .map(([metric]) => metric)
    .filter(metric => targetColumns[metric] !== undefined && achievementColumns[metric] !== undefined);

  const representatives = [];
  for (let rowIndex = representativesHeaderRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const name = String(row[userColumn] ?? "").trim();
    if (!name) break;
    representatives.push({
      id: representativeId(name),
      name,
      achievements: Object.fromEntries(importedMetrics.map(metric => [metric, numberValue(row[achievementColumns[metric]])])) as Target,
    });
  }

  const detailHeaderRowIndex = findRow(rows, "MSISDN", representativesHeaderRowIndex + 1);
  const dates = detailHeaderRowIndex < 0 ? [] : rows.slice(detailHeaderRowIndex + 1)
    .map(row => excelDate(row[rows[detailHeaderRowIndex].findIndex(cell => normalize(cell) === "date")]))
    .filter((date): date is Date => Boolean(date));
  const latestDate = dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : new Date();

  return importedWorkbookSchema.parse({
    shopName,
    date: latestDate.toISOString().slice(0, 10),
    targets: Object.fromEntries(importedMetrics.map(metric => [metric, numberValue(shopValues[targetColumns[metric]])])),
    representatives,
  });
}

export async function importTargetWorkbook(file: File, customMetricLabels: Partial<Record<PerformanceMetric, string>> = {}) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("Please choose an Excel .xlsx or .xls file.");
  return parseWorkbook(read(await file.arrayBuffer(), { type: "array", cellDates: true }), customMetricLabels);
}
