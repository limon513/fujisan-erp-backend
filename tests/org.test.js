import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import {
  authHeader,
  createUser,
  resetDatabase,
  seedAccessControl,
  TEST_PASSWORD,
} from "./helpers/db.js";

let app;
let admin;
let org; // { ho, ctg, sales, accounts, executive, accountant }

beforeAll(async () => {
  app = await createApp();
});

beforeEach(async () => {
  await resetDatabase();
  await seedAccessControl();
  await createUser({ username: "root", roleSlug: "super-admin" });
  admin = await authHeader(request, app, "root");

  const [ho, ctg, sales, accounts] = await Promise.all([
    prisma.branch.create({ data: { code: "HO", name: "Head Office", isHeadOffice: true } }),
    prisma.branch.create({ data: { code: "CTG", name: "Chattogram" } }),
    prisma.department.create({ data: { code: "SALES", name: "Sales" } }),
    prisma.department.create({ data: { code: "ACC", name: "Accounts" } }),
  ]);
  const [executive, accountant] = await Promise.all([
    prisma.designation.create({
      data: { name: "Sales Executive", departmentId: sales.id, level: 10 },
    }),
    prisma.designation.create({
      data: { name: "Accountant", departmentId: accounts.id, level: 10 },
    }),
  ]);
  org = { ho, ctg, sales, accounts, executive, accountant };
});

afterAll(async () => {
  await prisma.$disconnect();
});

const employeeBody = (overrides = {}) => ({
  fullName: "Rahim Uddin",
  mobile: "01711000001",
  branchId: org.ho.id,
  departmentId: org.sales.id,
  designationId: org.executive.id,
  joiningDate: "2026-01-15",
  ...overrides,
});

const createEmployee = (overrides, auth = admin) =>
  request(app).post("/api/v1/employees").set(auth).send(employeeBody(overrides));

describe("branches", () => {
  it("creates branches with unique codes and a single head office", async () => {
    const res = await request(app)
      .post("/api/v1/branches")
      .set(admin)
      .send({ code: "syl", name: "Sylhet", isHeadOffice: true });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code: "SYL", isHeadOffice: true, employeeCount: 0 });
    expect((await prisma.branch.findUnique({ where: { id: org.ho.id } })).isHeadOffice).toBe(false);

    const duplicate = await request(app)
      .post("/api/v1/branches")
      .set(admin)
      .send({ code: "SYL", name: "Again" });
    expect(duplicate.status).toBe(409);
  });

  it("refuses to delete a branch in use", async () => {
    await createEmployee();
    expect((await request(app).delete(`/api/v1/branches/${org.ho.id}`).set(admin)).status).toBe(
      409,
    );
    expect((await request(app).delete(`/api/v1/branches/${org.ctg.id}`).set(admin)).status).toBe(
      200,
    );
  });

  it("filters by active state", async () => {
    await request(app).patch(`/api/v1/branches/${org.ctg.id}`).set(admin).send({ isActive: false });
    const res = await request(app).get("/api/v1/branches?isActive=true").set(admin);
    expect(res.body.data.map((b) => b.code)).toEqual(["HO"]);
  });
});

describe("teams", () => {
  it("requires the leader to belong to the team's branch and department", async () => {
    const leader = (await createEmployee()).body.data;
    const wrong = await request(app).post("/api/v1/teams").set(admin).send({
      name: "CTG Sales",
      branchId: org.ctg.id,
      departmentId: org.sales.id,
      leaderId: leader.id,
    });
    expect(wrong.status).toBe(422);

    const ok = await request(app).post("/api/v1/teams").set(admin).send({
      name: "Alpha",
      branchId: org.ho.id,
      departmentId: org.sales.id,
      leaderId: leader.id,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.leader.fullName).toBe("Rahim Uddin");
  });
});

describe("employees", () => {
  it("auto-generates codes and normalizes mobile numbers", async () => {
    const first = await createEmployee();
    const second = await createEmployee({ fullName: "Karim", mobile: "+880 1811-000002" });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ employeeCode: "EMP-0001", mobile: "8801711000001" });
    expect(second.body.data).toMatchObject({ employeeCode: "EMP-0002", mobile: "8801811000002" });

    const manual = await createEmployee({ employeeCode: "fpl-100" });
    expect(manual.body.data.employeeCode).toBe("FPL-100");
    expect((await createEmployee({ employeeCode: "FPL-100" })).status).toBe(409);
  });

  it("validates designation, team and reporting line", async () => {
    expect((await createEmployee({ designationId: org.accountant.id })).status).toBe(422);
    expect((await createEmployee({ mobile: "12345" })).status).toBe(400);

    const boss = (await createEmployee({ fullName: "Boss" })).body.data;
    const worker = (await createEmployee({ fullName: "Worker", reportingManagerId: boss.id })).body
      .data;
    const loop = await request(app)
      .patch(`/api/v1/employees/${boss.id}`)
      .set(admin)
      .send({ reportingManagerId: worker.id });
    expect(loop.status).toBe(422);
    expect(loop.body.errors[0].path).toBe("reportingManagerId");
  });

  it("limits a branch-scoped HR user to their own branch", async () => {
    const hrEmployee = (await createEmployee({ fullName: "HR Person" })).body.data;
    await createEmployee({ fullName: "Far Away", branchId: org.ctg.id });

    const role = await prisma.role.create({
      data: { name: "Branch HR", slug: "branch-hr", level: 40 },
    });
    const permissions = await prisma.permission.findMany({
      where: { key: { in: ["employee.view", "employee.create", "employee.edit"] } },
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id, scope: "BRANCH" })),
    });
    await createUser({ username: "branchhr", roleSlug: "branch-hr", employee: hrEmployee });
    const hr = await authHeader(request, app, "branchhr");

    const list = await request(app).get("/api/v1/employees").set(hr);
    expect(list.body.data.map((e) => e.fullName).sort()).toEqual(["HR Person"]);

    expect((await createEmployee({ fullName: "Mine" }, hr)).status).toBe(201);
    expect((await createEmployee({ fullName: "Not mine", branchId: org.ctg.id }, hr)).status).toBe(
      403,
    );

    const mine = list.body.data[0];
    const moveAway = await request(app)
      .patch(`/api/v1/employees/${mine.id}`)
      .set(hr)
      .send({ branchId: org.ctg.id });
    expect(moveAway.status).toBe(403);
  });

  it("signs out an employee who resigns, and removal disables the login", async () => {
    const employee = (await createEmployee()).body.data;
    await createUser({ username: "rahim", employee });
    const rahim = await authHeader(request, app, "rahim");

    await request(app)
      .patch(`/api/v1/employees/${employee.id}`)
      .set(admin)
      .send({ employmentStatus: "RESIGNED" });
    expect((await request(app).get("/api/v1/auth/me").set(rahim)).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ identifier: "rahim", password: TEST_PASSWORD })
      ).status,
    ).toBe(403);

    const team = await prisma.team.create({
      data: {
        name: "Alpha",
        branchId: org.ho.id,
        departmentId: org.sales.id,
        leaderId: employee.id,
      },
    });
    expect((await request(app).delete(`/api/v1/employees/${employee.id}`).set(admin)).status).toBe(
      200,
    );
    expect((await prisma.team.findUnique({ where: { id: team.id } })).leaderId).toBeNull();
    expect((await prisma.user.findUnique({ where: { username: "rahim" } })).status).toBe(
      "INACTIVE",
    );
    expect((await request(app).get(`/api/v1/employees/${employee.id}`).set(admin)).status).toBe(
      404,
    );
  });
});

describe("user accounts", () => {
  it("creates a login for an employee with a one-time temporary password", async () => {
    const employee = (await createEmployee({ email: "Rahim@Fujisan.test" })).body.data;
    const role = await prisma.role.findUniqueOrThrow({ where: { slug: "sales-executive" } });

    const res = await request(app)
      .post("/api/v1/users")
      .set(admin)
      .send({ username: "Rahim.Uddin", roleId: role.id, employeeId: employee.id });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      username: "rahim.uddin",
      email: "rahim@fujisan.test",
      mobile: "8801711000001",
      mustChangePassword: true,
      employee: { employeeCode: "EMP-0001" },
    });
    const { temporaryPassword } = res.body.data;
    expect(temporaryPassword).toHaveLength(12);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: "rahim.uddin", password: temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.data.user.mustChangePassword).toBe(true);

    const again = await request(app)
      .post("/api/v1/users")
      .set(admin)
      .send({ username: "rahim2", roleId: role.id, employeeId: employee.id });
    expect(again.status).toBe(422);

    const list = await request(app).get("/api/v1/users?search=EMP-0001").set(admin);
    expect(list.body.data.map((u) => u.username)).toEqual(["rahim.uddin"]);
  });

  it("only manages accounts below your own level", async () => {
    const employee = (await createEmployee()).body.data;
    await createUser({ username: "hrmanager", roleSlug: "hr-manager", employee });
    const hr = await authHeader(request, app, "hrmanager");
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { slug: "super-admin" } });
    const viewer = await prisma.role.findUniqueOrThrow({ where: { slug: "viewer" } });

    expect(
      (
        await request(app)
          .post("/api/v1/users")
          .set(hr)
          .send({ username: "evil", roleId: superAdmin.id })
      ).status,
    ).toBe(403);
    const ok = await request(app)
      .post("/api/v1/users")
      .set(hr)
      .send({ username: "reader", roleId: viewer.id });
    expect(ok.status).toBe(201);

    const root = await prisma.user.findUniqueOrThrow({ where: { username: "root" } });
    expect(
      (await request(app).post(`/api/v1/users/${root.id}/reset-password`).set(hr)).status,
    ).toBe(403);
  });

  it("resets passwords, unlocks, and protects the last Super Admin", async () => {
    const target = await createUser({ username: "locked" });
    await prisma.user.update({
      where: { id: target.id },
      data: { lockedUntil: new Date(Date.now() + 600_000) },
    });

    const listLocked = await request(app).get("/api/v1/users?status=LOCKED").set(admin);
    expect(listLocked.body.data.map((u) => u.username)).toEqual(["locked"]);

    const unlocked = await request(app).post(`/api/v1/users/${target.id}/unlock`).set(admin);
    expect(unlocked.body.data.isLocked).toBe(false);

    const reset = await request(app).post(`/api/v1/users/${target.id}/reset-password`).set(admin);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: "locked", password: reset.body.data.temporaryPassword });
    expect(login.status).toBe(200);

    const root = await prisma.user.findUniqueOrThrow({ where: { username: "root" } });
    expect((await request(app).delete(`/api/v1/users/${root.id}`).set(admin)).status).toBe(422);
    expect(
      (await request(app).patch(`/api/v1/users/${root.id}`).set(admin).send({ status: "INACTIVE" }))
        .status,
    ).toBe(422);

    expect((await request(app).delete(`/api/v1/users/${target.id}`).set(admin)).status).toBe(200);
    expect((await request(app).get(`/api/v1/users/${target.id}`).set(admin)).status).toBe(404);
  });
});
