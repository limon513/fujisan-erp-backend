import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;
let h;
let org;
let fb;
let walkIn;
let project;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedAccessControl();

  const branch = await prisma.branch.create({ data: { code: "HO", name: "HO" } });
  const sales = await prisma.department.create({ data: { code: "S", name: "Sales" } });
  const designation = await prisma.designation.create({ data: { name: "Staff" } });
  const team = await prisma.team.create({
    data: { name: "Alpha", branchId: branch.id, departmentId: sales.id },
  });
  let n = 0;
  const employee = (fullName, extra = {}) =>
    prisma.employee.create({
      data: {
        employeeCode: `E${++n}`,
        fullName,
        mobile: `88017110000${String(n).padStart(2, "0")}`,
        joiningDate: new Date("2026-01-01"),
        branchId: branch.id,
        departmentId: sales.id,
        designationId: designation.id,
        ...extra,
      },
    });
  org = {
    team,
    anika: await employee("Anika", { teamId: team.id }),
    babul: await employee("Babul", { teamId: team.id }),
    gone: await employee("Gone", { teamId: team.id, employmentStatus: "RESIGNED" }),
    uttara: await employee("Uttara Specialist"),
    manager: await employee("Selim Manager"),
  };
  org.users = {
    crm: await createUser({ username: "crm", roleSlug: "crm-executive" }),
    anika: await createUser({
      username: "anika",
      roleSlug: "sales-executive",
      employee: org.anika,
    }),
    manager: await createUser({
      username: "manager",
      roleSlug: "sales-manager",
      employee: org.manager,
    }),
  };
  h = {};
  for (const name of Object.keys(org.users)) h[name] = await authHeader(request, app, name);

  fb = await prisma.leadSource.create({ data: { code: "FACEBOOK", name: "Facebook" } });
  walkIn = await prisma.leadSource.create({ data: { code: "WALK_IN", name: "Walk-in" } });
  project = await prisma.project.create({ data: { code: "FC", name: "Fujisan City" } });
});

const api = (method, path, as, body) =>
  request(app)[method](`/api/v1${path}`).set(h[as]).send(body);

let mobile = 0;
const poolLead = async (extra = {}) =>
  (
    await api("post", "/leads", "crm", {
      fullName: `Lead ${++mobile}`,
      mobile: `0191100${String(mobile).padStart(4, "0")}`,
      sourceId: fb.id,
      unassigned: true,
      ...extra,
    })
  ).body.data;

const rule = (body) => api("post", "/lead-assignment-rules", "manager", body);

describe("assignment rules", () => {
  it("hands Facebook leads to the team's active members in turn", async () => {
    const res = await rule({
      name: "Facebook to Alpha",
      sourceId: fb.id,
      poolType: "TEAM",
      teamId: org.team.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.pool.map((p) => p.fullName)).toEqual(["Anika", "Babul"]);

    const owners = [];
    for (let i = 0; i < 3; i += 1) owners.push((await poolLead()).owner?.fullName);
    expect(owners).toEqual(["Anika", "Babul", "Anika"]);

    const walkInLead = await poolLead({ sourceId: walkIn.id });
    expect(walkInLead.owner).toBeNull(); // no rule matched: stays in the pool

    const timeline = (await poolLead()).activities.map((a) => [a.type, a.body]);
    expect(timeline).toContainEqual(["ASSIGNMENT", 'Assigned by rule "Facebook to Alpha"']);
    const notes = await prisma.notification.count({
      where: { userId: org.users.anika.id, type: "LEAD_ASSIGNED" },
    });
    expect(notes).toBe(2);
    const listed = (await api("get", "/lead-assignment-rules", "manager")).body.data[0];
    expect(listed).toMatchObject({ assignedCount: 4 });
  });

  it("tries rules by priority and skips empty pools", async () => {
    await rule({
      name: "Everything to Alpha",
      poolType: "TEAM",
      teamId: org.team.id,
      priority: 100,
    });
    await rule({
      name: "Uttara",
      locationKeywords: ["uttara", "Diabari"],
      poolType: "EMPLOYEES",
      employeeIds: [org.uttara.id],
      priority: 10,
    });
    const nobody = await prisma.team.create({
      data: { name: "Empty", branchId: org.team.branchId, departmentId: org.team.departmentId },
    });
    await rule({ name: "Empty team", poolType: "TEAM", teamId: nobody.id, priority: 1 });

    expect((await poolLead({ location: "Sector 7, UTTARA" })).owner.fullName).toBe(
      "Uttara Specialist",
    );
    expect((await poolLead({ location: "Mirpur" })).owner.fullName).toBe("Anika");
  });

  it("matches the project the lead is interested in", async () => {
    await rule({
      name: "Fujisan City",
      projectId: project.id,
      poolType: "EMPLOYEES",
      employeeIds: [org.babul.id],
    });
    expect((await poolLead({ preferredProjectId: project.id })).owner.fullName).toBe("Babul");
    expect((await poolLead()).owner).toBeNull();
  });

  it("distributes leads already waiting in the pool", async () => {
    await poolLead();
    await poolLead();
    await rule({ name: "Alpha", poolType: "TEAM", teamId: org.team.id });
    const res = await api("post", "/lead-assignment-rules/distribute", "manager");
    expect(res.body.data).toEqual({ assigned: 2, left: 0 });
    expect(await prisma.lead.count({ where: { ownerId: null } })).toBe(0);
  });

  it("validates pools and permissions", async () => {
    expect((await rule({ name: "Bad", poolType: "TEAM" })).status).toBe(400);
    expect(
      (await rule({ name: "Bad", poolType: "EMPLOYEES", employeeIds: [org.gone.id] })).status,
    ).toBe(422);
    expect((await api("get", "/lead-assignment-rules", "anika")).status).toBe(403);

    const created = (await rule({ name: "Alpha", poolType: "TEAM", teamId: org.team.id })).body
      .data;
    const res = await api("patch", `/lead-assignment-rules/${created.id}`, "manager", {
      poolType: "EMPLOYEES",
      employeeIds: [org.babul.id, org.anika.id],
    });
    expect(res.body.data).toMatchObject({
      team: null,
      pool: [{ fullName: "Babul" }, { fullName: "Anika" }],
    });
    expect(
      (await api("patch", `/lead-assignment-rules/${created.id}`, "manager", { poolType: "TEAM" }))
        .status,
    ).toBe(422);
  });
});

describe("pipeline board", () => {
  it("groups open leads by stage within scope", async () => {
    await rule({ name: "Anika", poolType: "EMPLOYEES", employeeIds: [org.anika.id] });
    const a = await poolLead();
    await poolLead();
    const c = await poolLead();
    await api("post", `/leads/${a.id}/status`, "anika", { status: "INTERESTED" });
    await api("post", `/leads/${c.id}/status`, "anika", {
      status: "LOST",
      lostReason: "No budget",
    });

    const board = (await api("get", "/leads/pipeline", "anika")).body.data;
    const counts = Object.fromEntries(board.columns.map((col) => [col.status, col.count]));
    expect(counts).toMatchObject({ NEW: 1, INTERESTED: 1, BOOKING: 0 });
    expect(board.columns.map((col) => col.status)).not.toContain("LOST");
    expect(board.closed).toEqual({ converted: 0, lost: 1 });
    expect(board.columns.find((col) => col.status === "INTERESTED").leads[0].id).toBe(a.id);

    const managerView = (await api("get", "/leads/pipeline?search=Lead", "manager")).body.data;
    expect(managerView.columns.find((col) => col.status === "NEW").count).toBe(1);
  });
});
