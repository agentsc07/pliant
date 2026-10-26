import type { ComponentType } from "react";
import type { z } from "zod";

export interface RegisteredComponent {
  name: string;
  component: ComponentType<any>;
  propsSchema?: z.ZodTypeAny;
  /** For views: the prop that receives each entity item. Default "item". */
  itemProp: string;
}

const registry = new Map<string, RegisteredComponent>();

/** Put a developer component in the catalog so generated UI can use it (stays on-brand). */
export function registerComponent(
  name: string, component: ComponentType<any>, propsSchema?: z.ZodTypeAny, opts: { itemProp?: string } = {},
) {
  registry.set(name, { name, component, propsSchema, itemProp: opts.itemProp ?? "item" });
}
export const getRegistered = (name: string) => registry.get(name);
export const registeredNames = () => [...registry.keys()];
