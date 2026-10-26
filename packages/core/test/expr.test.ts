import { describe, expect, it } from "vitest";
import { evalBool, evalExpr, resolveTemplate, checkExpr } from "../src";

describe("expr", () => {
  const ctx = { input: [1, 2, 3], item: { id: "g1", unread: 60, name: "a" }, selection: { count: 4 } };
  it("field access and comparisons", () => {
    expect(evalBool("item.unread > 50", ctx)).toBe(true);
    expect(evalBool("item.name == 'a' and not item.unread < 10", ctx)).toBe(true);
    expect(evalBool("(item.unread < 10) or selection.count >= 4", ctx)).toBe(true);
  });
  it("count on arrays", () => expect(evalExpr("input.count", ctx)).toBe(3));
  it("templates", () => {
    expect(resolveTemplate("Mute {{input.count}} groups?", ctx)).toBe("Mute 3 groups?");
    expect(resolveTemplate({ groupId: "{{item.id}}", n: "{{item.unread}}" }, ctx)).toEqual({ groupId: "g1", n: 60 });
  });
  it("is safe: no code execution or prototype access", () => {
    expect(checkExpr("process.exit()")).not.toBeNull();
    expect(evalExpr("item.constructor", ctx)).toBeUndefined();
    expect(evalExpr("item.__proto__", ctx)).toBeUndefined();
    expect(checkExpr("1 +")).not.toBeNull();
  });
});
