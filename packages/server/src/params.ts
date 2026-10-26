import type { ParamSpec } from "@pliant/core";
import { z } from "zod";

function specOf(t: z.ZodTypeAny): ParamSpec {
  let optional = false;
  let cur: any = t;
  for (;;) {
    const name = cur._def.typeName as string;
    if (name === "ZodOptional" || name === "ZodNullable" || name === "ZodDefault") {
      optional = true;
      cur = cur._def.innerType;
    } else if (name === "ZodEffects") cur = cur._def.schema;
    else break;
  }
  const name = cur._def.typeName as string;
  const type = name === "ZodString" ? "string" : name === "ZodNumber" ? "number" : name === "ZodBoolean" ? "boolean" : "any";
  return { type, ...(optional ? { optional: true } : {}) };
}

/** Derive the manifest's JSON-able param description from a Zod object schema. */
export function paramSpecs(schema: z.ZodObject<any>): Record<string, ParamSpec> {
  return Object.fromEntries(Object.entries(schema.shape).map(([k, v]) => [k, specOf(v as z.ZodTypeAny)]));
}
