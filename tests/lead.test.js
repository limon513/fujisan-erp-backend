import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;
let h;
let org;
let source;

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
  const crm = await prisma.department.create({ data: { code: "C", name: "CRM" } });
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
        departmentId: sales.id,
        designationId: designation.id,
        ...extra,
      },
    });
  const leaderEmp = await employee("Tania Leader");
  const team = await prisma.team.create({
    data: { name: "Alpha", branchId: branch.id, departmentId: sales.id, leaderId: leaderEmp.id },
  });
  const sellerEmp = await employee("Rahim Seller", { teamId: team.id });
  const otherEmp = await employee("Other Seller");
  const managerEmp = await employee("Selim Manager");
  const crmEmp = await employee("Mita CRM", { departmentId: crm.id });
  org = { branch, team, sellerEmp, otherEmp, leaderEmp };

  const users = {
    root: await createUser({ username: "root", roleSlug: "super-admin" }),
    seller: await createUser({
      username: "seller",
      roleSlug: "sales-executive",
      employee: sellerEmp,
    }),
    other: await createUser({ username: "other", roleSlug: "sales-executive", employee: otherEmp }),
    leader: await createUser({ username: "leader", roleSlug: "team-leader", employee: leaderEmp }),
    manager: await createUser({
      username: "manager",
      roleSlug: "sales-manager",
      employee: managerEmp,
    }),
    crm: await createUser({ username: "crm", roleSlug: "crm-executive", employee: crmEmp }),
  };
  org.users = users;
  h = {};
  for (const name of Object.keys(users)) h[name] = await authHeader(request, app, name);

  source = (await request(app).post("/api/v1/lead-sources").set(h.root).send({ name: "Walk-in" }))
    .body.data;
});

const api = (method, path, as, body) =>
  request(app)[method](`/api/v1${path}`).set(h[as]).send(body);

const newLead = (as, extra = {}) =>
  api("post", "/leads", as, {
    fullName: "Nasima Akter",
    mobile: "01911000001",
    sourceId: source.id,
    ...extra,
  });

describe("lead sources and campaigns", () => {
  it("makes a code from the name and protects sources in use", async () => {
    expect(source).toMatchObject({
      code: "WALK_IN",
      name: "Walk-in",
      isActive: true,
      leadCount: 0,
    });
    expect((await api("post", "/lead-sources", "root", { name: "walk-in" })).status).toBe(409);

    await newLead("seller");
    expect((await api("delete", `/lead-sources/${source.id}`, "root")).status).toBe(409);
    await api("patch", `/lead-sources/${source.id}`, "root", { isActive: false });
    const res = await newLead("seller", { mobile: "01911000002" });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].path).toBe("sourceId");
  });

  it("checks campaign dates, also when editing one of them", async () => {
    const bad = await api("post", "/campaigns", "root", {
      name: "Puja",
      sourceId: source.id,
      startDate: "2026-10-10",
      endDate: "2026-10-01",
    });
    expect(bad.status).toBe(400);
    const ok = await api("post", "/campaigns", "root", {
      name: "Puja",
      sourceId: source.id,
      budget: "50000",
      startDate: "2026-10-01",
    });
    expect(ok.body.data).toMatchObject({ budget: "50000", source: { name: "Walk-in" } });
    const res = await api("patch", `/campaigns/${ok.body.data.id}`, "root", {
      endDate: "2026-09-01",
    });
    expect(res.status).toBe(422);
  });
});

describe("leads", () => {
  it("assigns a new lead to its creator and starts its timeline", async () => {
    const res = await newLead("seller");
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      leadCode: "LD-000001",
      mobile: "8801911000001",
      status: "NEW",
      owner: { fullName: "Rahim Seller", team: { name: "Alpha" } },
    });
    expect(res.body.data.activities.map((a) => a.type)).toEqual(["CREATED"]);
  });

  it("refuses a duplicate mobile or email unless confirmed, and links the two", async () => {
    const first = (await newLead("seller", { email: "nasima@example.com" })).body.data;
    let res = await newLead("other", { mobile: "01811000000", altMobile: "01911000001" });
    expect(res.status).toBe(409);
    expect(res.body.errors[0]).toMatchObject({ path: "mobile" });
    expect(res.body.message).toContain("LD-000001 Nasima Akter (with Rahim Seller)");

    res = await newLead("other", { mobile: "01811000000", email: "NASIMA@example.com" });
    expect(res.body.errors[0].path).toBe("email");

    res = await newLead("other", { mobile: "01911000001", confirmDuplicate: true });
    expect(res.status).toBe(201);
    expect(res.body.data.duplicateOf).toMatchObject({ id: first.id });

    await prisma.customer.create({
      data: { customerCode: "CUS-1", fullName: "Nasima Akter", mobile: "8801911000001" },
    });
    const dup = await api("get", "/leads/duplicates?mobile=01911000001", "seller");
    expect(dup.body.data.leads).toHaveLength(2);
    expect(dup.body.data.customers[0]).toMatchObject({
      customerCode: "CUS-1",
      matchedOn: ["mobile"],
    });
  });

  it("follows data scope", async () => {
    const lead = (await newLead("seller")).body.data;
    expect((await api("get", `/leads/${lead.id}`, "other")).status).toBe(404);
    expect((await api("get", `/leads/${lead.id}`, "leader")).status).toBe(200); // team
    expect((await api("get", `/leads/${lead.id}`, "manager")).status).toBe(200); // branch
    const mine = await api("get", "/leads", "other");
    expect(mine.body.data).toEqual([]);
  });

  it("lets only those with lead.assign hand leads to others", async () => {
    let res = await newLead("seller", { ownerId: org.otherEmp.id });
    expect(res.status).toBe(403);

    res = await newLead("crm", { ownerId: org.sellerEmp.id });
    expect(res.body.data.owner.fullName).toBe("Rahim Seller");
    const note = await prisma.notification.findFirst({ where: { userId: org.users.seller.id } });
    expect(note).toMatchObject({ type: "LEAD_ASSIGNED", link: `/crm/leads/${res.body.data.id}` });

    const lead = res.body.data;
    expect(
      (await api("post", `/leads/${lead.id}/assign`, "seller", { ownerId: null })).status,
    ).toBe(403);
    res = await api("post", `/leads/${lead.id}/assign`, "leader", {
      ownerId: org.otherEmp.id,
      note: "Rahim is on leave",
    });
    expect(res.status).toBe(403); // Other Seller isn't in the leader's team

    res = await api("post", `/leads/${lead.id}/assign`, "manager", { ownerId: org.otherEmp.id });
    expect(res.body.data.owner.fullName).toBe("Other Seller");
    expect(res.body.data.activities[0]).toMatchObject({ type: "ASSIGNMENT" });
    expect((await api("get", `/leads/${lead.id}`, "seller")).status).toBe(404);
  });

  it("lists the employees each person may assign to", async () => {
    const names = async (as) =>
      (await api("get", "/leads/assignees", as)).body.data.map((e) => e.fullName);
    expect(await names("leader")).toEqual(["Rahim Seller", "Tania Leader"]);
    expect((await names("crm")).length).toBe(5);
    expect((await api("get", "/leads/assignees", "seller")).status).toBe(403);
  });

  it("keeps unassigned leads in the pool for managers", async () => {
    const lead = (await newLead("crm", { unassigned: true })).body.data;
    expect(lead.owner).toBeNull();
    expect((await newLead("seller", { unassigned: true, mobile: "01911000002" })).status).toBe(403);
    const pool = await api("get", "/leads?unassigned=true", "manager");
    expect(pool.body.data.map((l) => l.id)).toEqual([lead.id]);
    expect((await api("get", `/leads/${lead.id}`, "leader")).status).toBe(404);
  });

  it("moves a NEW lead to CONTACTED on first contact and needs a reason to lose it", async () => {
    const lead = (await newLead("seller")).body.data;
    let res = await api("post", `/leads/${lead.id}/activities`, "seller", {
      type: "CALL",
      body: "Wants a 3 katha plot near the main road",
    });
    expect(res.body.data.status).toBe("CONTACTED");
    expect(res.body.data.activities.slice(0, 2).map((a) => a.type)).toEqual(
      expect.arrayContaining(["CALL", "STATUS_CHANGE"]),
    );
    expect(res.body.data.lastActivityAt).not.toBeNull();

    expect(
      (await api("post", `/leads/${lead.id}/status`, "seller", { status: "LOST" })).status,
    ).toBe(400);
    res = await api("post", `/leads/${lead.id}/status`, "seller", {
      status: "LOST",
      lostReason: "Bought elsewhere",
    });
    expect(res.body.data).toMatchObject({ status: "LOST", lostReason: "Bought elsewhere" });
    res = await api("post", `/leads/${lead.id}/status`, "seller", { status: "INTERESTED" });
    expect(res.body.data).toMatchObject({ status: "INTERESTED", lostReason: null });
    expect(
      (await api("post", `/leads/${lead.id}/status`, "seller", { status: "CONVERTED" })).status,
    ).toBe(400);
  });

  it("converts a lead to a customer and closes it", async () => {
    const lead = (await newLead("seller")).body.data;
    const customer = await prisma.customer.create({
      data: { customerCode: "CUS-000001", fullName: "Nasima Akter", mobile: "8801911000001" },
    });
    let res = await api("post", `/leads/${lead.id}/convert`, "seller", { customerId: customer.id });
    expect(res.body.data).toMatchObject({
      status: "CONVERTED",
      convertedCustomer: { customerCode: "CUS-000001" },
    });
    res = await api("post", `/leads/${lead.id}/status`, "seller", { status: "NEW" });
    expect(res.status).toBe(409);

    await newLead("seller", { mobile: "01911000009", fullName: "Open Lead" });
    const open = await api("get", "/leads?status=OPEN", "seller");
    expect(open.body.data.map((l) => l.fullName)).toEqual(["Open Lead"]);
    const found = await api("get", "/leads?search=01911000001", "seller");
    expect(found.body.data.map((l) => l.leadCode)).toEqual(["LD-000001"]);
  });

  it("checks the budget range on edit", async () => {
    const lead = (await newLead("seller", { budgetMin: "3000000" })).body.data;
    const res = await api("patch", `/leads/${lead.id}`, "seller", { budgetMax: "2000000" });
    expect(res.status).toBe(422);
    const ok = await api("patch", `/leads/${lead.id}`, "seller", { budgetMax: "5000000" });
    expect(ok.body.data).toMatchObject({ budgetMin: "3000000", budgetMax: "5000000" });
  });
});
