import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import type { ErrorObject } from "ajv";

let compiled: ReturnType<Ajv["compile"]> | null = null;

/**
 * 加载并编译 JSON Schema（单例）。
 */
function getValidator() {
  if (!compiled) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schemaPath = path.join(process.cwd(), "schema", "extract_session.schema.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
    compiled = ajv.compile(schema);
  }
  return compiled;
}

/**
 * 校验抽取 JSON 是否符合 Schema。
 * @param data 解析后的对象。
 */
export function validateExtraction(data: unknown): { ok: true } | { ok: false; errors: string } {
  const validate = getValidator();
  const valid = validate(data);
  if (!valid) {
    const errs = (validate.errors ?? []) as ErrorObject[];
    return { ok: false, errors: errs.map((e) => `${e.instancePath} ${e.message}`).join("; ") };
  }
  return { ok: true };
}
