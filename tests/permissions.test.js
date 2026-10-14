import { describe, expect, it } from "vitest";
import { definePermissions, matchesPattern, resolveTemplateScope } from "#core/rbac/permissions.js";

describe("definePermissions", () => {
  it("builds keys, labels and custom actions", () => {
    const list = definePermissions({
      module: "project",
      resource: "unit",
      label: "Plots",
      actions: ["view", "edit"],
      extra: [{ action: "hold", label: "Hold / release" }],
    });
    expect(list.map((p) => p.key)).toEqual(["unit.view", "unit.edit", "unit.hold"]);
    expect(list[2]).toMatchObject({
      module: "project",
      label: "Plots: Hold / release",
      supportsScope: true,
    });
  });

  it("rejects unknown standard actions", () => {
    expect(() => definePermissions({ module: "x", label: "X", actions: ["hold"] })).toThrow(
      /extra/,
    );
  });
});

describe("role templates", () => {
  it("matches exact, resource and action wildcards", () => {
    expect(matchesPattern("*", "lead.view")).toBe(true);
    expect(matchesPattern("lead.*", "lead.delete")).toBe(true);
    expect(matchesPattern("*.view", "booking.view")).toBe(true);
    expect(matchesPattern("*.view", "booking.edit")).toBe(false);
    expect(matchesPattern("lead.view", "lead-source.view")).toBe(false);
  });

  it("lets later rules win and supports revoking with null", () => {
    const rules = [
      ["*.view", "ALL"],
      ["lead.*", "OWN"],
      ["audit-log.view", null],
    ];
    const p = (key, supportsScope = true) => ({ key, supportsScope });
    expect(resolveTemplateScope(rules, p("booking.view"))).toBe("ALL");
    expect(resolveTemplateScope(rules, p("lead.view"))).toBe("OWN");
    expect(resolveTemplateScope(rules, p("audit-log.view"))).toBeNull();
    expect(resolveTemplateScope(rules, p("booking.edit"))).toBeNull();
  });

  it("grants unscoped permissions with ALL", () => {
    expect(
      resolveTemplateScope([["setting.*", "OWN"]], { key: "setting.edit", supportsScope: false }),
    ).toBe("ALL");
  });
});
