import { z } from "zod";
import { read, utils, type WorkBook, type WorkSheet } from "xlsx";
import { EXCEL_METRIC_LABELS } from "@/lib/metric-definitions";
import { performanceMetrics, type PerformanceMetric, type Target } from "@/lib/types";

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

const shopSchema = z.object({
  shopName: z.string().trim().min(1),
  revenue: z.number().finite().nonnegative(),
  date: z.string().date(),
  targets: numericRecordSchema,
  achievements: numericRecordSchema,
  representatives: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    achievements: numericRecordSchema,
    targets: numericRecordSchema.optional(),
  })).min(1),
});

const importedWorkbookSchema = z.object({ shops: z.array(shopSchema).min(1) });

export type ImportedShopData = z.infer<typeof shopSchema>;
export type ImportedWorkbookData = z.infer<typeof importedWorkbookSchema>;

type Cell = string | number | boolean | Date | null | undefined;
type MetricColumns = Partial<Record<PerformanceMetric, number>>;
type Table = {
  rows: Cell[][];
  headerStart: number;
  headerEnd: number;
  headers: string[];
  identityColumn: number;
  shopColumn: number;
  targetColumns: MetricColumns;
  achievementColumns: MetricColumns;
};

const consolidatedMetricLabels: Partial<Record<PerformanceMetric, string>> = { custom_mixmax: "MixMax" };
const shopAliases = ["shop epos", "shop", "dyqani", "pika", "store"];
const userAliases = ["users", "user", "sales representative", "representative", "punonjesi", "agjenti", "emri"];
const targetMarkers = ["t", "target", "targets", "objektiv", "objektivi"];
const achievementMarkers = ["a", "achievement", "achievements", "actual", "actuals", "realizim", "realizimi"];

function normalize(value: Cell) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numberValue(value: Cell) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : 0;
  const text = String(value ?? "").trim().replace(/\s/g, "");
  const normalized = text.includes(",") && text.includes(".")
    ? text.replace(/,/g, "")
    : text.replace(",", ".");
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function representativeId(name: string) {
  return `excel-${normalize(name).replace(/\s+/g, "-")}`;
}

function excelDate(value: Cell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function rowsOf(sheet: WorkSheet) {
  return utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null });
}

function columnHeaders(rows: Cell[][], start: number, end: number) {
  const width = Math.max(...rows.slice(start, end + 1).map(row => row.length), 0);
  return Array.from({ length: width }, (_, column) => normalize(
    rows.slice(start, end + 1).map(row => row[column]).filter(Boolean).join(" "),
  ));
}

function aliasColumn(headers: string[], aliases: string[]) {
  return headers.findIndex(header => aliases.some(alias => header === normalize(alias)));
}

function hasMarker(header: string, markers: string[]) {
  const words = header.split(" ");
  return markers.some(marker => words.includes(marker));
}

function metricColumns(headers: string[], kind: "target" | "achievement", customMetricLabels: Partial<Record<PerformanceMetric, string>>) {
  const labels = { ...EXCEL_METRIC_LABELS, ...consolidatedMetricLabels, ...customMetricLabels };
  const markers = kind === "target" ? targetMarkers : achievementMarkers;
  return Object.fromEntries(Object.entries(labels).flatMap(([metric, label]) => {
    const expected = normalize(label);
    const column = headers.findIndex(header =>
      header.includes(expected) && hasMarker(header.replace(expected, "").trim(), markers),
    );
    return column < 0 ? [] : [[metric, column]];
  })) as MetricColumns;
}

function findTables(workbook: WorkBook, role: "shop" | "representative", customMetricLabels: Partial<Record<PerformanceMetric, string>>) {
  const aliases = role === "shop" ? shopAliases : userAliases;
  const tables: Table[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = rowsOf(sheet);
    let best: (Table & { score: number }) | null = null;

    for (let start = 0; start < rows.length; start += 1) {
      for (let depth = 1; depth <= 3 && start + depth <= rows.length; depth += 1) {
        const headerEnd = start + depth - 1;
        const headers = columnHeaders(rows, start, headerEnd);
        const identityColumn = aliasColumn(headers, aliases);
        if (identityColumn < 0) continue;
        const targetColumns = metricColumns(headers, "target", customMetricLabels);
        const achievementColumns = metricColumns(headers, "achievement", customMetricLabels);
        const metricCount = Object.keys(targetColumns).length + Object.keys(achievementColumns).length;
        if (!metricCount) continue;
        const shopColumn = aliasColumn(headers, shopAliases);
        const score = metricCount * 10 + (shopColumn >= 0 ? 2 : 0) - depth;
        if (!best || score > best.score) {
          best = { rows, headerStart: start, headerEnd, headers, identityColumn, shopColumn, targetColumns, achievementColumns, score };
        }
      }
    }
    if (best) tables.push(best);
  }
  return tables.sort((left, right) =>
    Object.keys(right.targetColumns).length + Object.keys(right.achievementColumns).length
    - Object.keys(left.targetColumns).length - Object.keys(left.achievementColumns).length,
  );
}

function emptyMetrics() {
  return Object.fromEntries(performanceMetrics.map(metric => [metric, 0])) as Target;
}

function metricsFrom(row: Cell[], columns: MetricColumns) {
  return {
    ...emptyMetrics(),
    ...Object.fromEntries(Object.entries(columns).map(([metric, column]) => [metric, numberValue(row[column!])])),
  } as Target;
}

function reportDate(rows: Cell[][]) {
  const cells = rows.slice(0, 15).flat();
  const explicitDates = cells.map(excelDate).filter((date): date is Date =>
    Boolean(date && date.getUTCFullYear() >= 2000 && date.getUTCFullYear() <= 2100),
  );
  if (explicitDates.length) return new Date(Math.max(...explicitDates.map(date => date.getTime()))).toISOString().slice(0, 10);

  const text = cells.map(value => normalize(value)).join(" ");
  const months: Record<string, number> = {
    janar: 1, january: 1, shkurt: 2, february: 2, mars: 3, march: 3, prill: 4, april: 4,
    maj: 5, may: 5, qershor: 6, june: 6, korrik: 7, july: 7, gusht: 8, august: 8,
    shtator: 9, september: 9, tetor: 10, october: 10, nentor: 11, november: 11,
    dhjetor: 12, december: 12,
  };
  const month = Object.entries(months).find(([name]) => text.includes(name))?.[1];
  const year = Number(text.match(/\b20\d{2}\b/)?.[0]);
  return month && year
    ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
}

function dataRows(table: Table) {
  const rows: Cell[][] = [];
  let blankRows = 0;
  for (const row of table.rows.slice(table.headerEnd + 1)) {
    if (!String(row[table.identityColumn] ?? "").trim()) {
      blankRows += 1;
      if (blankRows >= 2 && rows.length) break;
      continue;
    }
    blankRows = 0;
    rows.push(row);
  }
  return rows;
}

function parseDetectedWorkbook(workbook: WorkBook, customMetricLabels: Partial<Record<PerformanceMetric, string>>) {
  const shopTable = findTables(workbook, "shop", customMetricLabels)[0];
  const representativeTable = findTables(workbook, "representative", customMetricLabels)[0];
  if (!shopTable || !representativeTable) {
    throw new Error("Could not find the shop and representative target/achievement tables in this workbook.");
  }
  if (!Object.keys(shopTable.targetColumns).length || !Object.keys(representativeTable.achievementColumns).length) {
    throw new Error("The workbook tables were found, but their target or achievement columns could not be identified.");
  }

  const shopRows = dataRows(shopTable);
  const representativeRows = dataRows(representativeTable);
  const onlyShopName = shopRows.length === 1 ? String(shopRows[0][shopTable.identityColumn] ?? "").trim() : "";
  const representativesByShop = new Map<string, ImportedShopData["representatives"]>();

  for (const row of representativeRows) {
    const name = String(row[representativeTable.identityColumn] ?? "").trim();
    const shopName = representativeTable.shopColumn >= 0
      ? String(row[representativeTable.shopColumn] ?? "").trim()
      : onlyShopName;
    if (!name || !shopName) continue;
    const key = normalize(shopName);
    const representatives = representativesByShop.get(key) ?? [];
    representatives.push({
      id: representativeId(name),
      name,
      achievements: metricsFrom(row, representativeTable.achievementColumns),
      ...(Object.keys(representativeTable.targetColumns).length && { targets: metricsFrom(row, representativeTable.targetColumns) }),
    });
    representativesByShop.set(key, representatives);
  }

  const date = reportDate(shopTable.rows);
  const monthlyRevenueHeader = "vlera e te ardhurave 1mujore a";
  const exactRevenueColumn = shopTable.headers.findIndex(header =>
    header === monthlyRevenueHeader || header.includes(monthlyRevenueHeader),
  );
  const revenueColumn = exactRevenueColumn >= 0
    ? exactRevenueColumn
    : shopTable.headers.findIndex(header =>
        header.includes("vlera e te ardhurave") || header.includes("vlera e ardhurave") || header.includes("revenue"),
      );
  const shops = shopRows.flatMap(row => {
    const shopName = String(row[shopTable.identityColumn] ?? "").trim();
    const representatives = representativesByShop.get(normalize(shopName)) ?? [];
    if (!shopName || !representatives.length) return [];
    const achievements = Object.keys(shopTable.achievementColumns).length
      ? metricsFrom(row, shopTable.achievementColumns)
      : performanceMetrics.reduce((totals, metric) => {
          totals[metric] = representatives.reduce((sum, representative) => sum + representative.achievements[metric], 0);
          return totals;
        }, emptyMetrics());
    return [{
      shopName,
      revenue: revenueColumn >= 0 ? numberValue(row[revenueColumn]) : 0,
      date,
      targets: metricsFrom(row, shopTable.targetColumns),
      achievements,
      representatives,
    }];
  });

  if (!shops.length) throw new Error("Target and achievement tables were found, but their shops and representatives could not be matched.");
  return importedWorkbookSchema.parse({ shops });
}

export async function importTargetWorkbook(file: File, customMetricLabels: Partial<Record<PerformanceMetric, string>> = {}) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("Please choose an Excel .xlsx or .xls file.");
  const workbook = read(await file.arrayBuffer(), { type: "array", cellDates: true });
  return parseDetectedWorkbook(workbook, customMetricLabels);
}
