import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { attendanceMonthSchema } from "@/lib/persistence-schemas";
import { attendanceText, monthDates, parseAttendanceText, type AttendanceMonth } from "@/lib/attendance";

export const MAX_ATTENDANCE_FILE_BYTES = 2 * 1024 * 1024;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false, processEntities: true });
type XmlNode = Record<string, unknown>;
const nodes = (value: unknown): XmlNode[] => value == null ? [] : (Array.isArray(value) ? value : [value]) as XmlNode[];
const text = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : value && typeof value === "object" ? text((value as XmlNode)["#text"]) : "";
function xml(bytes: Uint8Array): XmlNode {
  const source = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("invalidTemplate");
  return parser.parse(source) as XmlNode;
}
function unpack(bytes: Uint8Array) {
  if (bytes.length > MAX_ATTENDANCE_FILE_BYTES) throw new Error("fileTooLarge");
  let total = 0; let count = 0;
  return unzipSync(bytes, { filter: file => {
    total += file.originalSize; count += 1;
    if (total > 12 * 1024 * 1024 || count > 200 || file.name.includes("..") || file.name.startsWith("/")) throw new Error("invalidTemplate");
    return true;
  } });
}
const MONTH_NAMES = ["janar", "shkurt", "mars", "prill", "maj", "qershor", "korrik", "gusht", "shtator", "tetor", "nentor", "dhjetor"];
export function normalizeAttendanceName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/one\s*shop|shop/g, "").replace(/[^a-z0-9]/g, "");
}
export type WorkbookSheet = {
  name: string; path: string; month: string; shopName: string; supervisor: string;
  staff: { column: number; name: string; role: "SM" | "SR" | "IE" }[];
  days: { date: string; row: number; values: string[] }[];
};
function decodeSheets(files: Record<string, Uint8Array>): WorkbookSheet[] {
  if (!files["xl/workbook.xml"] || !files["xl/_rels/workbook.xml.rels"]) throw new Error("invalidTemplate");
  const wb = xml(files["xl/workbook.xml"]).workbook as XmlNode;
  const relationships = xml(files["xl/_rels/workbook.xml.rels"]).Relationships as XmlNode;
  const relationMap = new Map(nodes(relationships.Relationship).map(node => [text(node["@Id"]), text(node["@Target"])]));
  const sharedRoot = files["xl/sharedStrings.xml"] ? xml(files["xl/sharedStrings.xml"]).sst as XmlNode : {};
  const shared = nodes(sharedRoot.si).map(si => text(si.t) || nodes(si.r).map(run => text(run.t)).join(""));
  return nodes((wb.sheets as XmlNode).sheet).flatMap(sheet => {
    const name = text(sheet["@name"]);
    const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const year = normalized.match(/\b(20\d{2})\b/)?.[1];
    const monthNumber = MONTH_NAMES.findIndex(month => normalized.includes(month)) + 1;
    if (!year || !monthNumber) return [];
    const month = attendanceMonthSchema.parse(`${year}-${String(monthNumber).padStart(2, "0")}`);
    const target = relationMap.get(text(sheet["@r:id"]));
    const path = target?.startsWith("/") ? target.slice(1) : `xl/${target}`;
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(path) || !files[path]) throw new Error("invalidTemplate");
    const root = xml(files[path]).worksheet as XmlNode;
    const cells = new Map<string, string>();
    for (const row of nodes((root.sheetData as XmlNode).row)) for (const cell of nodes(row.c)) {
      const type = text(cell["@t"]);
      const value = type === "s" ? shared[Number(text(cell.v))] ?? "" : type === "inlineStr" ? text((cell.is as XmlNode)?.t) : text(cell.v);
      cells.set(text(cell["@r"]), value);
    }
    if (cells.get("B5")?.trim().toUpperCase() !== "DATA") return [];
    const staff: WorkbookSheet["staff"] = [];
    for (let column = 3; column <= 26; column++) {
      const letter = String.fromCharCode(64 + column);
      const role = cells.get(`${letter}5`)?.trim().toUpperCase();
      const staffName = cells.get(`${letter}6`)?.trim();
      if (staffName && (role === "SM" || role === "SR" || role === "IE")) staff.push({ column, name: staffName, role });
    }
    if (!staff.length || staff.length > 24) throw new Error("invalidTemplate");
    const days: WorkbookSheet["days"] = [];
    for (let row = 7; row <= 40; row++) {
      const day = Number(cells.get(`B${row}`)?.trim().match(/^(\d{1,2})\b/)?.[1]);
      const date = `${month}-${String(day).padStart(2, "0")}`;
      if (!monthDates(month).includes(date)) continue;
      days.push({ date, row, values: staff.map(person => cells.get(`${String.fromCharCode(64 + person.column)}${row}`) ?? "") });
    }
    if (days.length !== monthDates(month).length || new Set(days.map(day => day.date)).size !== days.length) throw new Error("invalidTemplate");
    return [{ name, path, month, shopName: cells.get("C2") ?? "", supervisor: cells.get("C3") ?? "", staff, days }];
  });
}
export function inspectAttendanceWorkbook(bytes: Uint8Array) {
  const sheets = decodeSheets(unpack(bytes));
  if (!sheets.length) throw new Error("invalidTemplate");
  return sheets;
}
function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
export function exportAttendanceWorkbook(bytes: Uint8Array, attendance: AttendanceMonth): Uint8Array {
  const files = unpack(bytes);
  const template = attendance.config.template;
  if (!template) throw new Error("noTemplate");
  const sheet = decodeSheets(files).find(item => item.name === template.sheet && item.month === (template.sourceMonth ?? template.month));
  if (!sheet) throw new Error("invalidTemplate");
  const columnIds = new Set(template.columns.map(column => column.staffId));
  if (attendance.config.staff.some(person => !columnIds.has(person.id))) throw new Error("templateCapacity");
  let source = strFromU8(files[sheet.path]);
  let outputPath = sheet.path;
  if (sheet.month !== template.month) {
    // Add a new monthly sheet; preserve all original sheets and workbook parts.
    // Do not accidentally group the cloned tab with the original selected tab.
    source = source.replace(/\btabSelected="1"/g, 'tabSelected="0"');
    const targetDates = monthDates(template.month);
    const titles = ["Janar", "Shkurt", "Mars", "Prill", "Maj", "Qershor", "Korrik", "Gusht", "Shtator", "Tetor", "Nëntor", "Dhjetor"];
    const title = `${titles[Number(template.month.slice(5)) - 1]} ${template.month.slice(0, 4)}`;
    const id = `rIdAttendance${template.month.replace("-", "")}`;
    const wb = strFromU8(files["xl/workbook.xml"]);
    if (wb.includes(`name="${escapeXml(title)}"`)) throw new Error("invalidTemplate");
    const ids = [...wb.matchAll(/\bsheetId="(\d+)"/g)].map(match => Number(match[1]));
    outputPath = `xl/worksheets/attendance-${template.month}.xml`;
    files["xl/workbook.xml"] = strToU8(wb.replace("</sheets>", `<sheet name="${escapeXml(title)}" sheetId="${Math.max(...ids) + 1}" r:id="${id}"/></sheets>`));
    files["xl/_rels/workbook.xml.rels"] = strToU8(strFromU8(files["xl/_rels/workbook.xml.rels"]).replace("</Relationships>", `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/attendance-${template.month}.xml"/></Relationships>`));
    files["[Content_Types].xml"] = strToU8(strFromU8(files["[Content_Types].xml"]).replace("</Types>", `<Override PartName="/${outputPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
    const sourceRels = sheet.path.replace("worksheets/", "worksheets/_rels/") + ".rels";
    if (files[sourceRels]) files[outputPath.replace("worksheets/", "worksheets/_rels/") + ".rels"] = files[sourceRels];
    // Extend the original last row only if the target month has more days.
    for (let day = sheet.days.length + 1; day <= targetDates.length; day++) {
      const previousRow = day + 5;
      const row = previousRow + 1;
      if (!new RegExp(`<row\\b[^>]*\\br="${row}"`).test(source)) {
        const previous = source.match(new RegExp(`<row\\b(?=[^>]*\\br="${previousRow}")[^>]*>[\\s\\S]*?<\\/row>`))?.[0];
        if (!previous) throw new Error("invalidTemplate");
        const cloned = previous.replace(new RegExp(`\\br="${previousRow}"`), `r="${row}"`).replace(new RegExp(`\\br="([A-Z]+)${previousRow}"`, "g"), `r="$1${row}"`);
        source = source.replace("</sheetData>", `${cloned}</sheetData>`);
      }
    }
    // Calendar and attendance are editable data; styles, legend and print settings remain intact.
    for (let day = 1; day <= Math.max(sheet.days.length, targetDates.length); day++) {
      const row = day + 6;
      const value = day <= targetDates.length ? `${day} ${titles[Number(template.month.slice(5)) - 1]}` : "";
      source = patchCell(source, `B${row}`, value, row, 2);
      for (const person of sheet.staff) source = patchCell(source, `${String.fromCharCode(64 + person.column)}${row}`, "", row, person.column);
    }
    const lastRow = targetDates.length + 6;
    source = source.replace(/(<dimension\b[^>]*ref="[A-Z]+\d+:[A-Z]+)\d+("[^>]*\/?>)/, `$1${Math.max(lastRow, 12)}$2`);
    source = source.replace(/(<conditionalFormatting\b[^>]*sqref="[C-Z]7:[C-Z])\d+("[^>]*>)/g, `$1${lastRow}$2`);
    sheet.days = targetDates.map((date, index) => ({ date, row: index + 7, values: sheet.staff.map(() => "") }));
  }
  // Update names and roles only when they were explicitly changed in the app roster.
  for (const mapping of template.columns) {
    const person = attendance.config.staff.find(staff => staff.id === mapping.staffId);
    const original = sheet.staff.find(staff => staff.column === mapping.column);
    if (!person || !original) throw new Error("invalidTemplate");
    if (person.name !== original.name) source = patchCell(source, `${String.fromCharCode(64 + mapping.column)}6`, person.name, 6, mapping.column);
    if (person.role !== original.role) source = patchCell(source, `${String.fromCharCode(64 + mapping.column)}5`, person.role, 5, mapping.column);
  }
  for (const day of attendance.days) {
    const row = sheet.days.find(item => item.date === day.date);
    if (!row) throw new Error("invalidTemplate");
    for (const mapping of template.columns) {
      const entry = day.entries.find(value => value.staffId === mapping.staffId);
      const ref = `${String.fromCharCode(64 + mapping.column)}${row.row}`;
      const value = attendanceText(entry);
      const original = row.values[sheet.staff.findIndex(person => person.column === mapping.column)];
      if (value !== original) source = patchCell(source, ref, value, row.row, mapping.column);
    }
  }
  files[outputPath] = strToU8(source);
  return zipSync(files, { level: 6 });
}
function patchCell(source: string, ref: string, value: string, row: number, column: number) {
  const emptyRow = new RegExp(`<row\\b(?=[^>]*\\br="${row}")([^>]*?)\\/>`);
  source = source.replace(emptyRow, (_match, attrs: string) => `<row${attrs}></row>`);
  const expression = new RegExp(`<c\\b(?=[^>]*\\br="${ref}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  const existing = source.match(expression)?.[0];
  const attributes = existing?.match(/^<c\b([^>]*?)(?:\/?>)/)?.[1].replace(/\s+t="[^"]*"/g, "").replace(/\/$/, "") ?? ` r="${ref}"`;
  const cell = `<c${attributes} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  if (existing) return source.replace(expression, () => cell);
  const rowExpression = new RegExp(`(<row\\b(?=[^>]*\\br="${row}")[^>]*>)([\\s\\S]*?)(<\\/row>)`);
  if (!rowExpression.test(source)) throw new Error("invalidTemplate");
  return source.replace(rowExpression, (_match, open: string, content: string, close: string) => {
    let offset = content.length;
    for (const next of content.matchAll(new RegExp(`<c\\b(?=[^>]*\\br="([A-Z]+)${row}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`, "g"))) {
      const position = next[1].split("").reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
      if (position > column) { offset = next.index!; break; }
    }
    return `${open}${content.slice(0, offset)}${cell}${content.slice(offset)}${close}`;
  });
}
export function workbookAttendanceDays(sheet: WorkbookSheet, mapping: { column: number; staffId: string }[]) {
  return sheet.days.map(day => ({ date: day.date, entries: mapping.flatMap(column => {
    const index = sheet.staff.findIndex(person => person.column === column.column);
    const entry = parseAttendanceText(column.staffId, day.values[index] ?? "");
    return entry ? [entry] : [];
  }) }));
}
