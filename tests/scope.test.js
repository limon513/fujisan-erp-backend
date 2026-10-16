import { describe, expect, it } from "vitest";
import { buildScopeWhere, compareScope, ownershipFields } from "#core/rbac/scope.js";

const actor = {
  employeeId: "emp-1",
  teamIds: ["team-1", "team-2"],
  departmentId: "dept-1",
  branchId: "branch-1",
  isSuperAdmin: false,
};
const NOTHING = { id: { in: [] } };

describe("buildScopeWhere", () => {
  it("maps each scope to a filter", () => {
    expect(buildScopeWhere(actor, "ALL")).toEqual({});
    expect(buildScopeWhere(actor, "BRANCH")).toEqual({ branchId: "branch-1" });
    expect(buildScopeWhere(actor, "DEPARTMENT")).toEqual({ departmentId: "dept-1" });
    expect(buildScopeWhere(actor, "OWN")).toEqual({ ownerId: "emp-1" });
    expect(buildScopeWhere(actor, "TEAM")).toEqual({
      OR: [{ teamId: { in: ["team-1", "team-2"] } }, { ownerId: "emp-1" }],
    });
  });

  it("supports field overrides", () => {
    expect(buildScopeWhere(actor, "OWN", { owner: "assignedToId" })).toEqual({
      assignedToId: "emp-1",
    });
  });

  it("lets a team-less member still see their own records", () => {
    expect(buildScopeWhere({ ...actor, teamIds: [] }, "TEAM")).toEqual({
      OR: [{ ownerId: "emp-1" }],
    });
  });

  it("matches nothing when the actor lacks the org link", () => {
    const bare = {
      employeeId: null,
      teamIds: [],
      departmentId: null,
      branchId: null,
      isSuperAdmin: false,
    };
    for (const scope of ["OWN", "TEAM", "DEPARTMENT", "BRANCH"]) {
      expect(buildScopeWhere(bare, scope)).toEqual(NOTHING);
    }
    expect(buildScopeWhere(bare, "BOGUS")).toEqual(NOTHING);
  });

  it("never filters for Super Admin", () => {
    expect(buildScopeWhere({ ...actor, isSuperAdmin: true }, "OWN")).toEqual({});
  });
});

describe("scope helpers", () => {
  it("orders scopes", () => {
    expect(compareScope("ALL", "TEAM")).toBeGreaterThan(0);
    expect(compareScope("OWN", "BRANCH")).toBeLessThan(0);
    expect(compareScope("TEAM", "TEAM")).toBe(0);
  });

  it("stamps ownership fields", () => {
    expect(ownershipFields(actor)).toEqual({
      ownerId: "emp-1",
      teamId: "team-1",
      departmentId: "dept-1",
      branchId: "branch-1",
    });
  });
});
