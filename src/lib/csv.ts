/**
 * @fileoverview CSV helpers for canonical preview and export.
 */

/**
 * Escape a primitive value into a CSV-safe cell.
 * @param value Cell value to serialize.
 * @returns Escaped CSV cell string.
 */
export function escapeCsv(value: string | number | boolean | null): string {
  const text = value === null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

/**
 * Split one CSV line while honoring quoted commas.
 * @param line CSV line text.
 * @returns Parsed cell list.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

/**
 * Return the first N lines for preview including header.
 * @param csv CSV text.
 * @param maxLines Max lines to return.
 * @returns CSV line array.
 */
export function previewCsvLines(csv: string, maxLines = 21): string[] {
  return csv.split(/\r?\n/).slice(0, maxLines);
}
