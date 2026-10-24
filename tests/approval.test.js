import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { finalStepFor, submitApproval } from "#core/approval/engine.js";
import { registerApprovalHandlers } from "#core/approval/handlers.js";
import { syncApprovalWorkflows } from "../prisma/seed/core/approvals.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;
const calls = [];
let failOnApprove = false;

registerApprovalHandlers("TEST", {
  onApproved: async (tx, req) => {
    if (failOnApprove) throw new Error("Plot is no longer available");
    calls.push(["approved", req.entityId]);
  },
  onRejected: async (tx, req) => calls.push(["rejected", req.entityId]),
  onCancelled: async (tx, req) => calls.push(["cancelled", req.entityId]),
});

const DISCOUNT_CHAIN = [
  { name: "Team Leader", approverType: "TEAM_LEADER", maxPercent: 2 },
  { name: "Sales Manager", approverType: "ROLE", role: "sales-manager", maxPercent: 5 },
  { name: "Director", approverType: "ROLE", role: "director" },
];

const testModule = { name: "test", approvalWorkflows: [{ code: "TEST", name: "Discount" }] };

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

let users;
let headers;

async function setupChain(chain = DISCOUNT_CHAIN) {
  await prisma.approvalWorkflow.deleteMany({ where: { code: "TEST" } });
  await prisma.$transaction((tx) =>
    syncApprovalWorkflows(tx, { modules: [testModule], chains: { TEST: chain } }),
  );
}

beforeEach(async () => {
  await resetDatabase();
  await seedAccessControl();
  calls.length = 0;
  failOnApprove = false;

  const branch = await prisma.branch.create({ data: { code: "HO", name: "HO" } });
  const department = await prisma.department.create({ data: { code: "S", name: "Sales" } });
  const designation = await prisma.designation.create({ data: { name: "Staff" } });
  let n = 0;
  const employee = (fullName, extra = {}) =>
    prisma.employee.create({
      data: {
        employeeCode: `E${++n}`,
        fullName,
        mobile: `88017110000${String(n).padStart(2, "0")}`,
        joiningDate: new Date("2026-01-01"),
        branchId: branch.id,
        departmentId: department.id,
        designationId: designation.id,
        ...extra,
      },
    });

  const leader = await employee("Tania Leader");
  const team = await prisma.team.create({
    data: { name: "Alpha", branchId: branch.id, departmentId: department.id, leaderId: leader.id },
  });
  const seller = await employee("Rahim Seller", { teamId: team.id, reportingManagerId: leader.id });
  const loner = await employee("Lone Seller");
  const manager = await employee("Selim Manager");
  const director = await employee("Dina Director");
  const other = await employee("Other Seller");
  users = {
    root: await createUser({ username: "root", roleSlug: "super-admin" }),
    seller: await createUser({ username: "seller", roleSlug: "sales-executive", employee: seller }),
    loner: await createUser({ username: "loner", roleSlug: "sales-executive", employee: loner }),
    leader: await createUser({ username: "leader", roleSlug: "team-leader", employee: leader }),
    manager: await createUser({
      username: "manager",
      roleSlug: "sales-manager",
      employee: manager,
    }),
    director: await createUser({ username: "director", roleSlug: "director", employee: director }),
    other: await createUser({ username: "other", roleSlug: "sales-executive", employee: other }),
  };
  headers = {};
  for (const name of Object.keys(users)) headers[name] = await authHeader(request, app, name);

  await setupChain();
});

const actorOf = (name) => ({
  userId: users[name].id,
  username: name,
  employeeId: users[name].employeeId,
  isSuperAdmin: name === "root",
});

const submit = (name, values = {}, entityId = "plot-1") =>
  prisma.$transaction((tx) =>
    submitApproval(tx, actorOf(name), {
      workflow: "TEST",
      entityType: "Plot",
      entityId,
      title: `Discount on ${entityId}`,
      ...values,
    }),
  );

const act = (name, id, action, body = {}) =>
  request(app).post(`/api/v1/approvals/${id}/${action}`).set(headers[name]).send(body);

const inboxIds = async (name) =>
  (await request(app).get("/api/v1/approvals/inbox").set(headers[name])).body.data.map((r) => r.id);

describe("approval limits", () => {
  const steps = [
    { stepOrder: 1, maxPercent: "2" },
    { stepOrder: 2, maxPercent: "5" },
    { stepOrder: 3 },
  ];

  it("stops at the first step whose limit covers the request", () => {
    expect(finalStepFor(steps, { percent: 1.5 })).toBe(1);
    expect(finalStepFor(steps, { percent: 2 })).toBe(1);
    expect(finalStepFor(steps, { percent: 3 })).toBe(2);
    expect(finalStepFor(steps, { percent: 12 })).toBe(3);
  });

  it("goes further up when the request doesn't carry the limited value", () => {
    expect(finalStepFor(steps, { amount: 1000 })).toBe(3);
    expect(finalStepFor([{ stepOrder: 1, maxAmount: "10" }], {})).toBe(1);
  });

  it("needs every step when none has a limit", () => {
    expect(finalStepFor([{ stepOrder: 1 }, { stepOrder: 2 }], { percent: 1 })).toBe(2);
  });
});

describe("approval flow", () => {
  it("walks Team Leader → Sales Manager for a 3% discount and skips the Director", async () => {
    const req = await submit("seller", { percent: 3 });
    expect(req.requestNo).toBe("APR-000001");
    expect(req.currentStepOrder).toBe(1);
    expect(await inboxIds("leader")).toEqual([req.id]);
    expect(await inboxIds("manager")).toEqual([]);

    expect((await act("seller", req.id, "approve")).status).toBe(403); // own request
    expect((await act("manager", req.id, "approve")).status).toBe(403); // not their step yet

    let res = await act("leader", req.id, "approve", { comment: "Good customer" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.currentStep.name).toBe("Sales Manager");
    expect(await inboxIds("manager")).toEqual([req.id]);
    expect(await inboxIds("leader")).toEqual([]);

    res = await act("manager", req.id, "approve");
    expect(res.body.data.status).toBe("APPROVED");
    expect(res.body.data.steps.map((s) => s.state)).toEqual(["APPROVED", "APPROVED", "NOT_NEEDED"]);
    expect(calls).toEqual([["approved", "plot-1"]]);

    const notes = await prisma.notification.findMany({
      where: { userId: users.seller.id },
      select: { type: true },
    });
    expect(notes.map((n) => n.type)).toEqual(["APPROVAL_APPROVED"]);
    const audit = await prisma.auditLog.findMany({
      where: { entityType: "Plot", entityId: "plot-1" },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(audit.map((a) => a.action)).toEqual(["APPROVAL_SUBMITTED", "APPROVE", "APPROVE"]);

    expect((await act("manager", req.id, "approve")).status).toBe(409);
  });

  it("approves changed amounts only where the workflow allows it", async () => {
    const req = await submit("seller", { percent: 1, amount: 1000 });
    const res = await act("leader", req.id, "approve", { amount: 500 });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].path).toBe("amount");
  });

  it("needs only the Team Leader within 2%", async () => {
    const req = await submit("seller", { percent: 1.5 });
    const res = await act("leader", req.id, "approve");
    expect(res.body.data.status).toBe("APPROVED");
  });

  it("rejects with a reason and tells the module", async () => {
    const req = await submit("seller", { percent: 3 });
    expect((await act("leader", req.id, "reject", {})).status).toBe(400);
    const res = await act("leader", req.id, "reject", { comment: "Too much" });
    expect(res.body.data.status).toBe("REJECTED");
    expect(res.body.data.steps.map((s) => s.state)).toEqual([
      "REJECTED",
      "NOT_REACHED",
      "NOT_NEEDED",
    ]);
    expect(calls).toEqual([["rejected", "plot-1"]]);
  });

  it("skips a step nobody can approve", async () => {
    const req = await submit("loner", { percent: 3 }); // no team, so no team leader
    expect(req.currentStepOrder).toBe(2);
    const detail = await request(app).get(`/api/v1/approvals/${req.id}`).set(headers.loner);
    expect(detail.body.data.steps[0].state).toBe("SKIPPED");
    expect(detail.body.data.currentApprovers).toEqual([
      { id: users.manager.id, name: "Selim Manager" },
    ]);
  });

  it("counts a step as approved when the same person already approved", async () => {
    await setupChain([
      { name: "Team Leader", approverType: "TEAM_LEADER" },
      { name: "Reporting manager", approverType: "REPORTING_MANAGER" }, // the same person
    ]);
    const req = await submit("seller");
    const res = await act("leader", req.id, "approve");
    expect(res.body.data.status).toBe("APPROVED");
    expect(res.body.data.steps.map((s) => s.state)).toEqual(["APPROVED", "SKIPPED"]);
  });

  it("escalates to the Super Admin when the chain has nobody", async () => {
    await setupChain([{ name: "Team Leader", approverType: "TEAM_LEADER" }]);
    const req = await submit("loner");
    expect(req.currentApproverIds).toEqual([users.root.id]);
    const res = await act("root", req.id, "approve");
    expect(res.body.data.status).toBe("APPROVED");
    expect(res.body.data.steps.at(-1)).toMatchObject({
      name: "Super Admin (escalated)",
      state: "APPROVED",
    });
  });

  it("approves at once when the process is switched off", async () => {
    await prisma.approvalWorkflow.update({ where: { code: "TEST" }, data: { isActive: false } });
    const req = await submit("seller", { percent: 10 });
    expect(req.status).toBe("APPROVED");
    expect(calls).toEqual([["approved", "plot-1"]]);
  });

  it("allows one pending request per record", async () => {
    await submit("seller", { percent: 3 });
    await expect(submit("seller", { percent: 4 })).rejects.toMatchObject({ statusCode: 409 });
    await submit("seller", { percent: 4 }, "plot-2");
  });

  it("rolls back the decision when the module refuses it", async () => {
    const req = await submit("seller", { percent: 1 });
    failOnApprove = true;
    expect((await act("leader", req.id, "approve")).status).toBe(500);
    const after = await prisma.approvalRequest.findUnique({ where: { id: req.id } });
    expect(after.status).toBe("PENDING");
    expect(await prisma.approvalAction.count({ where: { requestId: req.id } })).toBe(1);
  });

  it("lets only the requester (or a Super Admin) withdraw", async () => {
    const req = await submit("seller", { percent: 3 });
    expect((await act("leader", req.id, "cancel")).status).toBe(403);
    const res = await act("seller", req.id, "cancel", { comment: "Customer left" });
    expect(res.body.data.status).toBe("CANCELLED");
    expect(calls).toEqual([["cancelled", "plot-1"]]);
    expect(await inboxIds("leader")).toEqual([]);
  });

  it("shows a request only to those involved or with approval.view", async () => {
    const req = await submit("seller", { percent: 3 });
    const get = (name) => request(app).get(`/api/v1/approvals/${req.id}`).set(headers[name]);
    expect((await get("seller")).status).toBe(200);
    expect((await get("leader")).status).toBe(200);
    expect((await get("other")).status).toBe(404);
    expect((await get("director")).status).toBe(200); // management: approval.view ALL

    expect((await request(app).get("/api/v1/approvals").set(headers.other)).status).toBe(403);
    const all = await request(app).get("/api/v1/approvals").set(headers.director);
    expect(all.body.data.map((r) => r.id)).toEqual([req.id]);
    const mine = await request(app).get("/api/v1/approvals/mine").set(headers.seller);
    expect(mine.body.data[0]).toMatchObject({
      requestNo: "APR-000001",
      currentStep: { name: "Team Leader" },
    });
    const count = await request(app).get("/api/v1/approvals/inbox/count").set(headers.leader);
    expect(count.body.data).toEqual({ count: 1 });
  });
});

describe("approval chains", () => {
  const workflowId = async () =>
    (await prisma.approvalWorkflow.findUniqueOrThrow({ where: { code: "TEST" } })).id;

  it("lists chains and lets admins replace the steps", async () => {
    const list = await request(app).get("/api/v1/approvals/workflows").set(headers.root);
    expect(list.body.data[0].steps.map((s) => s.name)).toEqual([
      "Team Leader",
      "Sales Manager",
      "Director",
    ]);
    const id = await workflowId();
    const inFlight = await submit("seller", { percent: 3 });

    const patch = (name, body) =>
      request(app).patch(`/api/v1/approvals/workflows/${id}`).set(headers[name]).send(body);
    expect((await patch("manager", { isActive: false })).status).toBe(403);
    expect((await patch("root", { steps: [{ name: "Role", approverType: "ROLE" }] })).status).toBe(
      400,
    );

    const res = await patch("root", {
      steps: [
        { name: "Owner", approverType: "USER", approverUserId: users.director.id, maxPercent: "" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.steps).toMatchObject([
      { stepOrder: 1, name: "Owner", approverUser: { name: "Dina Director" }, maxPercent: null },
    ]);
    const audit = await prisma.auditLog.findFirst({ where: { action: "APPROVAL_CHAIN_CHANGED" } });
    expect(audit.newValues).toEqual({ steps: ["1. Owner (Dina Director)"] });

    // The request already waiting keeps its original chain
    const detail = await request(app).get(`/api/v1/approvals/${inFlight.id}`).set(headers.seller);
    expect(detail.body.data.steps).toHaveLength(3);
  });

  it("keeps a role that approves in a chain", async () => {
    const role = await prisma.role.create({
      data: { slug: "approver", name: "Approver", level: 40 },
    });
    const id = await workflowId();
    await request(app)
      .patch(`/api/v1/approvals/workflows/${id}`)
      .set(headers.root)
      .send({ steps: [{ name: "Approver", approverType: "ROLE", approverRoleId: role.id }] });
    const res = await request(app).delete(`/api/v1/roles/${role.id}`).set(headers.root);
    expect(res.status).toBe(409);
  });
});
