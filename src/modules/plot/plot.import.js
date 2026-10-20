import ExcelJS from "exceljs";
import AppError from "#core/errors/AppError.js";
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS } from "./plot.constant.js";

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const cellText = (value) => {
  if (value == null) return "";
  if (typeof value === "object") {
    if ("result" in value) return String(value.result ?? ""); // formula
    if ("text" in value) return String(value.text); // rich text / hyperlink
    if (value.richText) return value.richText.map((part) => part.text).join("");
  }
  return String(value);
};

async function readXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values.slice(1).map(cellText); // exceljs rows are 1-based
    rows.push(values);
  });
  return rows;
}

/**
 * Reads an uploaded .xlsx or .csv into [{ rowNumber, block, plotNumber, areaSqft, price, ... }].
 * The first row holds the headers (matched case-insensitively against IMPORT_COLUMNS aliases).
 */
export async function readPlotSheet(file) {
  if (!file?.buffer?.length)
    throw AppError.badRequest("Choose a file", [{ path: "file", message: "Required" }]);

  const isXlsx = file.buffer.subarray(0, 2).toString() === "PK"; // xlsx is a zip
  const rows = isXlsx ? await readXlsx(file.buffer) : parseCsv(file.buffer.toString("utf8"));
  if (rows.length < 2) {
    throw AppError.unprocessable("The file has no plot rows", [
      { path: "file", message: "Empty file" },
    ]);
  }
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    throw AppError.unprocessable(`At most ${MAX_IMPORT_ROWS} plots per import`);
  }

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const index = {};
  for (const [field, { aliases }] of Object.entries(IMPORT_COLUMNS)) {
    const position = headers.findIndex((h) => aliases.includes(h));
    if (position !== -1) index[field] = position;
  }
  const missing = Object.entries(IMPORT_COLUMNS)
    .filter(([field, { required }]) => required && index[field] === undefined)
    .map(([field]) => field);
  if (missing.length) {
    throw AppError.unprocessable(`Missing column(s): ${missing.join(", ")}`, [
      {
        path: "file",
        message: `Expected columns: Block, Plot, Area, Price (optional: Road, Facing, Dimensions, Remarks)`,
      },
    ]);
  }

  return rows.slice(1).map((cells, i) => {
    const record = { rowNumber: i + 2 };
    for (const [field, position] of Object.entries(index))
      record[field] = (cells[position] ?? "").trim();
    return record;
  });
}

/** CSV template users can fill in. */
export const IMPORT_TEMPLATE =
  "Block,Plot,Area (sqft),Price (BDT),Road,Facing,Dimensions,Remarks\n" +
  "A,1,1440,4800000,Road 1,NORTH,40 x 36 ft,\n" +
  "A,2,1440,4650000,Road 1,NORTH,40 x 36 ft,\n";
