/**
 * @fileoverview Minimal YAML serializer used for agent-readable package files.
 */

/**
 * Render one JavaScript value to YAML.
 *
 * @param value Serializable object or array.
 * @returns YAML document string.
 */
export function renderYamlDocument(value: unknown): string {
  const lines = renderNode(value, 0);
  return `${lines.join("\n")}\n`;
}

/**
 * Render one YAML node recursively.
 *
 * @param value Node value.
 * @param indent Current indentation width.
 * @returns YAML lines.
 */
function renderNode(value: unknown, indent: number): string[] {
  const prefix = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${prefix}[]`];
    }

    return value.flatMap((item) => renderArrayItem(item, indent));
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return [`${prefix}{}`];
    }

    return entries.flatMap(([key, item]) => renderObjectEntry(key, item, indent));
  }

  return [`${prefix}${formatScalar(value)}`];
}

/**
 * Render one array item into YAML.
 *
 * @param value Item value.
 * @param indent Current indentation width.
 * @returns YAML lines.
 */
function renderArrayItem(value: unknown, indent: number): string[] {
  const prefix = " ".repeat(indent);
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return [`${prefix}- ${formatScalar(value)}`];
  }

  if (Array.isArray(value)) {
    const nested = renderNode(value, indent + 2);
    return [`${prefix}-`, ...nested];
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return [`${prefix}- {}`];
  }

  const [firstKey, firstValue] = entries[0];
  const lines: string[] = [];
  if (!Array.isArray(firstValue) && !isPlainObject(firstValue)) {
    lines.push(`${prefix}- ${firstKey}: ${formatScalar(firstValue)}`);
  } else {
    lines.push(`${prefix}- ${firstKey}:`);
    lines.push(...renderNode(firstValue, indent + 4));
  }

  for (const [key, item] of entries.slice(1)) {
    lines.push(...renderObjectEntry(key, item, indent + 2));
  }
  return lines;
}

/**
 * Render one object entry into YAML.
 *
 * @param key Object key.
 * @param value Entry value.
 * @param indent Current indentation width.
 * @returns YAML lines.
 */
function renderObjectEntry(key: string, value: unknown, indent: number): string[] {
  const prefix = " ".repeat(indent);
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return [`${prefix}${key}: ${formatScalar(value)}`];
  }

  if (Array.isArray(value) && value.length === 0) {
    return [`${prefix}${key}: []`];
  }

  if (isPlainObject(value) && Object.keys(value).length === 0) {
    return [`${prefix}${key}: {}`];
  }

  return [`${prefix}${key}:`, ...renderNode(value, indent + 2)];
}

/**
 * Format one scalar for safe YAML output.
 *
 * @param value Scalar value.
 * @returns YAML-safe scalar.
 */
function formatScalar(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "null";
  }
  return JSON.stringify(value);
}

/**
 * Check whether one value is a plain object.
 *
 * @param value Candidate value.
 * @returns `true` when the value is a plain record.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
