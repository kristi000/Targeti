import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type WorkbookFiles = Record<string, Uint8Array>;
export type WorkbookCellValue = string | number | null | { formula: string; value?: number };

export function escapeWorkbookXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function unpackClosingWorkbook(bytes: Uint8Array): WorkbookFiles {
  if (bytes.length > 4 * 1024 * 1024) throw new Error("invalidTemplate");
  let total = 0;
  let count = 0;
  const files = unzipSync(bytes, { filter: file => {
    total += file.originalSize;
    count += 1;
    if (total > 40 * 1024 * 1024 || count > 200 || file.name.includes("..") || file.name.startsWith("/")) {
      throw new Error("invalidTemplate");
    }
    if (/vbaProject|externalLinks|connections\.xml/i.test(file.name)) throw new Error("invalidTemplate");
    return true;
  } });
  if (!files["xl/workbook.xml"] || !files["xl/_rels/workbook.xml.rels"] || !files["[Content_Types].xml"]) {
    throw new Error("invalidTemplate");
  }
  return files;
}

export function readWorkbookXml(files: WorkbookFiles, path: string): string {
  if (!files[path]) throw new Error("invalidTemplate");
  const source = strFromU8(files[path]);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("invalidTemplate");
  return source;
}

export function writeWorkbookXml(files: WorkbookFiles, path: string, source: string): void {
  files[path] = strToU8(source);
}

export function excelDateSerial(date: string): number {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) throw new Error("invalidDate");
  const value = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (new Date(value).toISOString().slice(0, 10) !== date) throw new Error("invalidDate");
  return (value - Date.UTC(1899, 11, 30)) / 86400000;
}

export function workbookCellXml(ref: string, value: WorkbookCellValue, prototypeCell = "", style?: string): string {
  let attributes = prototypeCell.match(/^<c\b([^>]*?)(?:\/?>)/)?.[1]
    .replace(/\s+(?:r|t)="[^"]*"/g, "").replace(/\/$/, "") ?? "";
  if (style !== undefined) attributes = attributes.replace(/\s+s="[^"]*"/g, "") + ` s="${style}"`;
  const open = `<c r="${ref}"${attributes}`;
  if (value === null) return `${open}/>`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalidWorkbookValue");
    return `${open}><v>${value}</v></c>`;
  }
  if (typeof value === "object") {
    if (value.value !== undefined && !Number.isFinite(value.value)) throw new Error("invalidWorkbookValue");
    return `${open}><f>${escapeWorkbookXml(value.formula)}</f>${value.value === undefined ? "" : `<v>${value.value}</v>`}</c>`;
  }
  return `${open} t="inlineStr"><is><t xml:space="preserve">${escapeWorkbookXml(value)}</t></is></c>`;
}

export function patchWorkbookCell(source: string, ref: string, value: WorkbookCellValue, style?: string): string {
  const parts = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!parts) throw new Error("invalidTemplate");
  const row = Number(parts[2]);
  const cellExpression = new RegExp(`<c\\b(?=[^>]*\\br="${ref}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  const existing = source.match(cellExpression)?.[0];
  const cell = workbookCellXml(ref, value, existing, style);
  if (existing) return source.replace(cellExpression, () => cell);
  source = source.replace(new RegExp(`<row\\b(?=[^>]*\\br="${row}")([^>]*?)\\/>`), (_match, attributes: string) => `<row${attributes}></row>`);
  const rowExpression = new RegExp(`(<row\\b(?=[^>]*\\br="${row}")[^>]*>)([\\s\\S]*?)(<\\/row>)`);
  if (!rowExpression.test(source)) throw new Error("invalidTemplate");
  const columnIndex = (letters: string) => [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
  return source.replace(rowExpression, (_match, open: string, content: string, close: string) => {
    const next = [...content.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)]
      .find(match => columnIndex(match[1]) > columnIndex(parts[1]));
    const offset = next?.index ?? content.length;
    return `${open}${content.slice(0, offset)}${cell}${content.slice(offset)}${close}`;
  });
}

export function renumberWorkbookRow(row: string, newRow: number): string {
  return row.replace(/(<row\b[^>]*\br=")\d+("[^>]*>)/, `$1${newRow}$2`)
    .replace(/(<c\b[^>]*\br="[A-Z]+)\d+("[^>]*>)/g, `$1${newRow}$2`);
}

export function packClosingWorkbook(files: WorkbookFiles): Uint8Array {
  delete files["xl/calcChain.xml"];
  const rels = readWorkbookXml(files, "xl/_rels/workbook.xml.rels")
    .replace(/<Relationship\b(?=[^>]*\bType="[^"]*\/calcChain")[^>]*\/>/g, "");
  writeWorkbookXml(files, "xl/_rels/workbook.xml.rels", rels);
  writeWorkbookXml(files, "[Content_Types].xml", readWorkbookXml(files, "[Content_Types].xml")
    .replace(/<Override\b(?=[^>]*\bPartName="\/xl\/calcChain\.xml")[^>]*\/>/g, ""));
  let workbook = readWorkbookXml(files, "xl/workbook.xml");
  const calculation = '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>';
  workbook = /<calcPr\b/.test(workbook) ? workbook.replace(/<calcPr\b[^>]*\/>/, calculation) : workbook.replace("</workbook>", `${calculation}</workbook>`);
  writeWorkbookXml(files, "xl/workbook.xml", workbook);
  return zipSync(files, { level: 6 });
}
