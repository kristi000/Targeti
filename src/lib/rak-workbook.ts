import type { AnnualClosingWorkbookData } from "@/lib/annual-closing";
import {
  excelDateSerial,
  packClosingWorkbook,
  patchWorkbookCell,
  readWorkbookXml,
  renumberWorkbookRow,
  unpackClosingWorkbook,
  writeWorkbookXml,
} from "@/lib/closing-workbook-xml";

const MONTH_TITLES = ["Janar", "Shkurt", "Mars", "Prill", "Maj", "Qershor", "Korrik", "Gusht", "Shtator", "Tetor", "Nentor", "Dhjetor"];
const SHEET_NAMES = ["Janar", "shkurt", "mars", "prill", "maj", "qershor", "korrik", "gusht", "shtator", "tetor", "nentor", "dhjetor"];
const FIRST_DEPOSIT_ROW = 10;
const TEMPLATE_DEPOSIT_ROWS = 26;
const MAX_DEPOSITS = 366;

function shiftLedgerReferences(value: string, extra: number): string {
  return value.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (reference, column: string, row: string) =>
    Number(row) >= FIRST_DEPOSIT_ROW + TEMPLATE_DEPOSIT_ROWS ? `${column}${Number(row) + extra}` : reference);
}

function expandDepositLedger(source: string, count: number): string {
  const extra = Math.max(0, count - TEMPLATE_DEPOSIT_ROWS);
  if (!extra) return source;
  const lastTemplateRow = FIRST_DEPOSIT_ROW + TEMPLATE_DEPOSIT_ROWS - 1;
  const prototype = source.match(new RegExp(`<row\\b(?=[^>]*\\br="${lastTemplateRow}")[^>]*>[\\s\\S]*?<\\/row>`))?.[0];
  if (!prototype) throw new Error("invalidTemplate");
  const expanded = source.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (row, value: string) => {
    const number = Number(value);
    if (number < lastTemplateRow) return row;
    if (number > lastTemplateRow) return renumberWorkbookRow(row, number + extra);
    return row + Array.from({ length: extra }, (_, index) => renumberWorkbookRow(prototype, lastTemplateRow + index + 1)).join("");
  });
  return expanded.replace(/(\b(?:ref|sqref)=")([^"]+)(")/g, (_match, open: string, value: string, close: string) =>
    `${open}${shiftLedgerReferences(value, extra)}${close}`)
    .replace(/<rowBreaks\b[^>]*>[\s\S]*?<\/rowBreaks>/g, breaks => breaks.replace(/(\bid=")(\d+)(")/g,
      (_match, open: string, value: string, close: string) => `${open}${Number(value) >= lastTemplateRow ? Number(value) + extra : value}${close}`));
}

/** Fill the sanitized annual RAK template without rebuilding its formatting. */
export function exportRakWorkbook(templateBytes: Uint8Array, data: AnnualClosingWorkbookData): Uint8Array {
  const files = unpackClosingWorkbook(templateBytes);
  let workbook = readWorkbookXml(files, "xl/workbook.xml");
  if (SHEET_NAMES.some(name => !workbook.includes(`name="${name}"`)) || !workbook.includes('name="Total"')) {
    throw new Error("invalidTemplate");
  }
  const differences: number[] = [];
  for (let index = 0; index < 12; index++) {
    const month = `${data.year}-${String(index + 1).padStart(2, "0")}`;
    const days = data.days.filter(day => day.date.startsWith(`${month}-`));
    const settings = data.months.find(item => item.month === month);
    const deposits = settings?.deposits ?? [];
    if (deposits.length > MAX_DEPOSITS) throw new Error("templateCapacity");
    const carryover = settings?.carryover ?? 0;
    const boss = days.reduce((total, day) => total + day.boss, 0);
    const invoice = days.reduce((total, day) => total + day.invoice, 0);
    const unsubscribe = days.reduce((total, day) => total + day.unsubscribe, 0);
    const deposited = deposits.reduce((total, deposit) => total + deposit.amount, 0);
    const difference = deposited - boss - invoice + carryover;
    differences.push(difference);
    const path = `xl/worksheets/sheet${index + 1}.xml`;
    let source = expandDepositLedger(readWorkbookXml(files, path), deposits.length);
    const depositRows = Math.max(TEMPLATE_DEPOSIT_ROWS, deposits.length);
    const totalRow = FIRST_DEPOSIT_ROW + depositRows;
    const extraRows = depositRows - TEMPLATE_DEPOSIT_ROWS;
    if (extraRows) {
      // The supplied template has no print areas; retain them correctly if added later.
      workbook = workbook.replace(new RegExp(`(<definedName\\b(?=[^>]*\\blocalSheetId="${index}")[^>]*>)([\\s\\S]*?)(<\\/definedName>)`, "g"),
        (_match, open: string, value: string, close: string) => `${open}${shiftLedgerReferences(value, extraRows)}${close}`);
    }
    // Only saved closings supply BOSS/Invoice inputs. Missing days are not zeros.
    source = patchWorkbookCell(source, "B1", `Rakordime ${MONTH_TITLES[index]} ${data.year}`);
    source = patchWorkbookCell(source, "E1", data.shopName, "37");
    source = patchWorkbookCell(source, "C3", days.length ? boss : null);
    source = patchWorkbookCell(source, "C4", days.length ? invoice : null);
    source = patchWorkbookCell(source, "C5", { formula: "SUM(C3:C4)", value: boss + invoice });
    source = patchWorkbookCell(source, "C6", { formula: `C${totalRow}`, value: deposited });
    source = patchWorkbookCell(source, "C7", { formula: "C6-C5+F12", value: difference });
    source = patchWorkbookCell(source, "E4", days.length ? `Unsubscribe: ${unsubscribe} Lek` : null);
    source = patchWorkbookCell(source, "F12", settings ? carryover : null, "18");
    source = patchWorkbookCell(source, "G12", "Mbartje (+/-)", "38");
    source = patchWorkbookCell(source, "G13", settings?.carryoverNote || null, "38");
    // Keep each receipt, including repeated dates and dates outside this reporting month.
    source = source.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (row, value: string) => {
      const rowNumber = Number(value);
      if (rowNumber < FIRST_DEPOSIT_ROW || rowNumber >= totalRow) return row;
      const deposit = deposits[rowNumber - FIRST_DEPOSIT_ROW];
      let output = patchWorkbookCell(row, `B${rowNumber}`, deposit ? excelDateSerial(deposit.date) : null, "20");
      output = patchWorkbookCell(output, `C${rowNumber}`, deposit ? deposit.amount : null);
      return output;
    });
    source = patchWorkbookCell(source, `C${totalRow}`, { formula: `SUM(C10:C${totalRow - 1})`, value: deposited });
    writeWorkbookXml(files, path, source);
  }
  const totalPath = "xl/worksheets/sheet13.xml";
  let total = readWorkbookXml(files, totalPath);
  total = patchWorkbookCell(total, "B1", data.year);
  total = patchWorkbookCell(total, "E1", data.shopName, "37");
  for (let index = 0; index < 12; index++) {
    total = patchWorkbookCell(total, `C${index + 5}`, { formula: `'${SHEET_NAMES[index]}'!C7`, value: differences[index] });
  }
  total = patchWorkbookCell(total, "C17", { formula: "SUM(C5:C16)", value: differences.reduce((sum, value) => sum + value, 0) });
  writeWorkbookXml(files, totalPath, total);
  writeWorkbookXml(files, "xl/workbook.xml", workbook);
  return packClosingWorkbook(files);
}
