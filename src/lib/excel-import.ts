import { z } from "zod";
import type { WorkBook, WorkSheet } from "xlsx";
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
  qualityMetrics: z.object({
    checklistScore: z.number().finite().nonnegative().optional(),
    npsScore: z.number().finite().optional(),
    npsResponses: z.number().finite().nonnegative().optional(),
  }).optional(),
  representatives: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    achievements: numericRecordSchema,
    targets: numericRecordSchema.optional(),
  })).min(1),
});

const importedWorkbookSchema = z.object({
  shops: z.array(shopSchema).min(1),
  detectedMetrics: z.array(z.string().min(1)).min(1),
  detectedMetricLabels: z.record(z.string().min(1)),
  warnings: z.array(z.string()),
});

export type ImportedShopData = z.infer<typeof shopSchema>;
export type ImportedWorkbookData = Omit<z.infer<typeof importedWorkbookSchema>, "detectedMetrics"> & {
  detectedMetrics: PerformanceMetric[];
};

type Cell = string | number | boolean | Date | null | undefined;
type SheetToJson = typeof import("xlsx")["utils"]["sheet_to_json"];
type MetricColumns = Partial<Record<PerformanceMetric, number>>;
type Table = {
  rows: Cell[][];
  headerStart: number;
  headerEnd: number;
  headers: string[];
  displayHeaders: string[];
  identityColumn: number;
  shopColumn: number;
  targetColumns: MetricColumns;
  achievementColumns: MetricColumns;
  metricLabels: Partial<Record<PerformanceMetric, string>>;
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

function numberValue(value: Cell, warnings?: string[]) {
  const warn = () => {
    const message = "One or more non-empty numeric cells were invalid or negative and were set to zero. Review all zero values before importing.";
    if (warnings && !warnings.includes(message)) warnings.push(message);
  };
  if (typeof value === "number") {
    if (Number.isFinite(value) && value >= 0) return value;
    warn();
    return 0;
  }
  const text = String(value ?? "").trim().replace(/\s/g, "");
  if (!text) return 0;
  const normalized = text.includes(",") && text.includes(".")
    ? text.replace(/,/g, "")
    : text.replace(",", ".");
  const numericText = normalized.replace(/[^0-9.-]/g, "");
  if (!numericText || numericText === "-" || numericText === "." || numericText === "-.") {
    warn();
    return 0;
  }
  const parsed = Number(numericText);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  warn();
  return 0;
}

function signedNumberValue(value: Cell, warnings?: string[]) {
  const text = String(value ?? "").trim().replace(/\s/g, "");
  if (!text) return 0;
  const normalized = text.includes(",") && text.includes(".") ? text.replace(/,/g, "") : text.replace(",", ".");
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  if (Number.isFinite(parsed)) return parsed;
  const message = "One or more quality-indicator cells were invalid and were set to zero. Review NPS and checklist values before importing.";
  if (warnings && !warnings.includes(message)) warnings.push(message);
  return 0;
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

function rowsOf(sheet: WorkSheet, sheetToJson: SheetToJson) {
  return sheetToJson<Cell[]>(sheet, { header: 1, raw: true, defval: null });
}

function columnHeaders(rows: Cell[][], start: number, end: number) {
  const width = Math.max(...rows.slice(start, end + 1).map(row => row.length), 0);
  return Array.from({ length: width }, (_, column) => normalize(
    rows.slice(start, end + 1).map(row => row[column]).filter(Boolean).join(" "),
  ));
}

function displayColumnHeaders(rows: Cell[][], start: number, end: number) {
  const width = Math.max(...rows.slice(start, end + 1).map(row => row.length), 0);
  return Array.from({ length: width }, (_, column) => rows
    .slice(start, end + 1)
    .map(row => String(row[column] ?? "").trim())
    .filter(Boolean)
    .join(" "));
}

function aliasColumn(headers: string[], aliases: string[]) {
  return headers.findIndex(header => aliases.some(alias => header === normalize(alias)));
}

function metricId(label: string, customMetricLabels: Partial<Record<PerformanceMetric, string>>) {
  const labels = { ...EXCEL_METRIC_LABELS, ...consolidatedMetricLabels, ...customMetricLabels };
  const known = Object.entries(labels).find(([, knownLabel]) => normalize(knownLabel) === label)?.[0];
  if (known) return known as PerformanceMetric;
  return `custom_${label.replace(/\s+/g, "_")}` as PerformanceMetric;
}

function splitMetricHeader(header: string) {
  const words = header.split(" ");
  const marker = words.at(-1);
  if (!marker) return null;
  if (targetMarkers.includes(marker)) return { kind: "target" as const, label: words.slice(0, -1).join(" ") };
  if (achievementMarkers.includes(marker)) return { kind: "achievement" as const, label: words.slice(0, -1).join(" ") };
  return null;
}

function dynamicMetricColumns(headers: string[], displayHeaders: string[], customMetricLabels: Partial<Record<PerformanceMetric, string>>) {
  const candidates = new Map<string, { target?: number; achievement?: number; displayLabel?: string }>();
  headers.forEach((header, column) => {
    const parsed = splitMetricHeader(header);
    if (!parsed?.label) return;
    if (parsed.label.includes("vlera e te ardhurave") || parsed.label.includes("vlera e ardhurave") || parsed.label === "revenue") return;
    const candidate = candidates.get(parsed.label) ?? {};
    candidate[parsed.kind] = column;
    candidate.displayLabel ??= displayHeaders[column].replace(/\s+(T|A|Target|Targets|Achievement|Achievements|Actual|Actuals)\s*$/i, "").trim();
    candidates.set(parsed.label, candidate);
  });

  const targetColumns: MetricColumns = {};
  const achievementColumns: MetricColumns = {};
  const metricLabels: Partial<Record<PerformanceMetric, string>> = {};
  candidates.forEach((candidate, label) => {
    if (candidate.target === undefined || candidate.achievement === undefined) return;
    const metric = metricId(label, customMetricLabels);
    targetColumns[metric] = candidate.target;
    achievementColumns[metric] = candidate.achievement;
    metricLabels[metric] = candidate.displayLabel || label;
  });
  return { targetColumns, achievementColumns, metricLabels };
}

function findTables(workbook: WorkBook, role: "shop" | "representative", customMetricLabels: Partial<Record<PerformanceMetric, string>>, sheetToJson: SheetToJson) {
  const aliases = role === "shop" ? shopAliases : userAliases;
  const tables: Table[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = rowsOf(sheet, sheetToJson);
    let best: (Table & { score: number }) | null = null;

    for (let start = 0; start < rows.length; start += 1) {
      for (let depth = 1; depth <= 3 && start + depth <= rows.length; depth += 1) {
        const headerEnd = start + depth - 1;
        const headers = columnHeaders(rows, start, headerEnd);
        const displayHeaders = displayColumnHeaders(rows, start, headerEnd);
        const identityColumn = aliasColumn(headers, aliases);
        if (identityColumn < 0) continue;
        const { targetColumns, achievementColumns, metricLabels } = dynamicMetricColumns(headers, displayHeaders, customMetricLabels);
        const metricCount = Object.keys(targetColumns).length + Object.keys(achievementColumns).length;
        if (!metricCount) continue;
        const shopColumn = aliasColumn(headers, shopAliases);
        const score = metricCount * 10 + (shopColumn >= 0 ? 2 : 0) - depth;
        if (!best || score > best.score) {
          best = { rows, headerStart: start, headerEnd, headers, displayHeaders, identityColumn, shopColumn, targetColumns, achievementColumns, metricLabels, score };
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

function metricsFrom(row: Cell[], columns: MetricColumns, warnings?: string[]) {
  return {
    ...emptyMetrics(),
    ...Object.fromEntries(Object.entries(columns).map(([metric, column]) => [metric, numberValue(row[column!], warnings)])),
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

function parseDetectedWorkbook(workbook: WorkBook, customMetricLabels: Partial<Record<PerformanceMetric, string>>, sheetToJson: SheetToJson) {
  const warnings: string[] = [];
  const shopTable = findTables(workbook, "shop", customMetricLabels, sheetToJson)[0];
  const representativeTable = findTables(workbook, "representative", customMetricLabels, sheetToJson)[0];
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
      achievements: metricsFrom(row, representativeTable.achievementColumns, warnings),
      ...(Object.keys(representativeTable.targetColumns).length && { targets: metricsFrom(row, representativeTable.targetColumns, warnings) }),
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
  const checklistColumn = shopTable.headers.findIndex(header => header.includes("vleresimi i checklist") || header.includes("checklist score"));
  const npsColumn = shopTable.headers.findIndex(header => header.includes("vleresimi i nps") || header === "nps" || header.includes("nps score"));
  const npsResponsesColumn = shopTable.headers.findIndex(header => header.includes("nps numri i vleresimeve") || header.includes("nps responses"));
  const shops = shopRows.flatMap(row => {
    const shopName = String(row[shopTable.identityColumn] ?? "").trim();
    const representatives = representativesByShop.get(normalize(shopName)) ?? [];
    if (!shopName || !representatives.length) return [];
    const achievements = Object.keys(shopTable.achievementColumns).length
      ? metricsFrom(row, shopTable.achievementColumns, warnings)
      : performanceMetrics.reduce((totals, metric) => {
          totals[metric] = representatives.reduce((sum, representative) => sum + representative.achievements[metric], 0);
          return totals;
        }, emptyMetrics());
    return [{
      shopName,
      revenue: revenueColumn >= 0 ? numberValue(row[revenueColumn], warnings) : 0,
      date,
      targets: metricsFrom(row, shopTable.targetColumns, warnings),
      achievements,
      representatives,
      ...((checklistColumn >= 0 || npsColumn >= 0 || npsResponsesColumn >= 0) && { qualityMetrics: {
        ...(checklistColumn >= 0 && { checklistScore: numberValue(row[checklistColumn], warnings) }),
        ...(npsColumn >= 0 && { npsScore: signedNumberValue(row[npsColumn], warnings) }),
        ...(npsResponsesColumn >= 0 && { npsResponses: numberValue(row[npsResponsesColumn], warnings) }),
      } }),
    }];
  });

  if (!shops.length) throw new Error("Target and achievement tables were found, but their shops and representatives could not be matched.");
  const detectedMetrics = Array.from(new Set([
    ...Object.keys(shopTable.targetColumns),
    ...Object.keys(shopTable.achievementColumns),
    ...Object.keys(representativeTable.targetColumns),
    ...Object.keys(representativeTable.achievementColumns),
  ])) as PerformanceMetric[];
  const detectedMetricLabels = Object.fromEntries(detectedMetrics.map(metric => [
    metric,
    shopTable.metricLabels[metric] ?? representativeTable.metricLabels[metric] ?? metric,
  ]));
  if (revenueColumn < 0) warnings.push("No revenue column was detected. Revenue was set to zero for review.");
  return importedWorkbookSchema.parse({ shops, detectedMetrics, detectedMetricLabels, warnings }) as ImportedWorkbookData;
}

export async function importTargetWorkbook(file: File, customMetricLabels: Partial<Record<PerformanceMetric, string>> = {}) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("Please choose an Excel .xlsx or .xls file.");
  const { read, utils } = await import("xlsx");
  const workbook = read(await file.arrayBuffer(), { type: "array", cellDates: true });
  return parseDetectedWorkbook(workbook, customMetricLabels, utils.sheet_to_json);
}
