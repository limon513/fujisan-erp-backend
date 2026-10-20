import { rm } from "node:fs/promises";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGP4z8DAwMDAxMDAAAAeLwIEXYCmfwAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

let app;
let admin;
let alice; // sales executive, team Alpha
let carol; // sales executive, team Beta
let lead; // team leader of Alpha
let staff;

beforeAll(async () => {
  app = await createApp();
});

beforeEach(async () => {
  await resetDatabase();
  await seedAccessControl();
  const branch = await prisma.branch.create({ data: { code: "HO", name: "Head Office" } });
  const department = await prisma.department.create({ data: { code: "SALES", name: "Sales" } });
  const designation = await prisma.designation.create({ data: { name: "Sales Executive" } });
  const [alpha, beta] = await Promise.all([
    prisma.team.create({
      data: { name: "Alpha", branchId: branch.id, departmentId: department.id },
    }),
    prisma.team.create({
      data: { name: "Beta", branchId: branch.id, departmentId: department.id },
    }),
  ]);
  const employee = (code, fullName, teamId) =>
    prisma.employee.create({
      data: {
        employeeCode: code,
        fullName,
        mobile: `88017110000${code.slice(-2)}`,
        joiningDate: new Date("2026-01-01"),
        branchId: branch.id,
        departmentId: department.id,
        designationId: designation.id,
        teamId,
      },
    });
  staff = {
    alice: await employee("E01", "Alice Akter", alpha.id),
    lead: await employee("E02", "Lutfor Rahman", alpha.id),
    carol: await employee("E03", "Carol Das", beta.id),
  };
  await prisma.team.update({ where: { id: alpha.id }, data: { leaderId: staff.lead.id } });

  await createUser({ username: "root", roleSlug: "super-admin" });
  await createUser({ username: "alice", roleSlug: "sales-executive", employee: staff.alice });
  await createUser({ username: "carol", roleSlug: "sales-executive", employee: staff.carol });
  await createUser({ username: "lead", roleSlug: "team-leader", employee: staff.lead });
  [admin, alice, carol, lead] = await Promise.all(
    ["root", "alice", "carol", "lead"].map((u) => authHeader(request, app, u)),
  );
});

afterAll(async () => {
  await rm(".test-storage", { recursive: true, force: true });
  await prisma.$disconnect();
});

const createCustomer = (auth, body = {}) =>
  request(app)
    .post("/api/v1/customers")
    .set(auth)
    .send({ fullName: "Karim Ahmed", mobile: "01811000001", nidNumber: "1234567890", ...body });

describe("customers", () => {
  it("creates customers owned by the salesperson, visible within their scope", async () => {
    const res = await createCustomer(alice);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      customerCode: "CUS-000001",
      mobile: "8801811000001",
      owner: { fullName: "Alice Akter", team: { name: "Alpha" } },
    });
    const id = res.body.data.id;

    expect((await request(app).get("/api/v1/customers").set(carol)).body.meta.total).toBe(0);
    expect((await request(app).get(`/api/v1/customers/${id}`).set(carol)).status).toBe(404);
    expect((await request(app).get("/api/v1/customers").set(lead)).body.meta.total).toBe(1);
    expect((await request(app).get(`/api/v1/customers/${id}`).set(alice)).status).toBe(200);
  });

  it("refuses a duplicate NID and asks to confirm a duplicate mobile", async () => {
    await createCustomer(alice);

    const sameNid = await createCustomer(carol, { mobile: "01911000009" });
    expect(sameNid.status).toBe(409);
    expect(sameNid.body.errors[0]).toMatchObject({ path: "nidNumber" });
    expect(sameNid.body.message).toMatch(/CUS-000001 Karim Ahmed \(handled by Alice Akter\)/);

    const sameMobile = await createCustomer(carol, {
      fullName: "Rokeya Ahmed",
      nidNumber: "9876543210",
    });
    expect(sameMobile.status).toBe(409);
    expect(sameMobile.body.errors[0].path).toBe("mobile");

    const confirmed = await createCustomer(carol, {
      fullName: "Rokeya Ahmed",
      nidNumber: "9876543210",
      confirmDuplicateMobile: true,
    });
    expect(confirmed.status).toBe(201);

    // the check sees across scopes, with minimal details
    const check = await request(app)
      .get("/api/v1/customers/duplicates?mobile=01811-000001")
      .set(carol);
    expect(check.body.data.map((m) => [m.customerCode, m.ownerName, m.matchedOn])).toEqual(
      expect.arrayContaining([["CUS-000001", "Alice Akter", ["mobile"]]]),
    );
  });

  it("lets only wider scopes assign another owner", async () => {
    expect((await createCustomer(alice, { ownerId: staff.carol.id })).status).toBe(403);
    const assigned = await createCustomer(admin, { ownerId: staff.carol.id });
    expect(assigned.body.data.owner.fullName).toBe("Carol Das");
    expect(
      (await request(app).get(`/api/v1/customers/${assigned.body.data.id}`).set(carol)).status,
    ).toBe(200);

    // a team leader can reassign within the team, not to another team
    const own = (await createCustomer(alice, { mobile: "01811000002", nidNumber: "1111111111" }))
      .body.data;
    expect(
      (
        await request(app)
          .patch(`/api/v1/customers/${own.id}`)
          .set(lead)
          .send({ ownerId: staff.lead.id })
      ).status,
    ).toBe(200);
    const outside = await request(app)
      .patch(`/api/v1/customers/${own.id}`)
      .set(lead)
      .send({ ownerId: staff.carol.id });
    expect(outside.status).toBe(403);
  });

  it("keeps nominee shares within 100%", async () => {
    const customer = (await createCustomer(alice)).body.data;
    const base = `/api/v1/customers/${customer.id}/nominees`;
    const first = await request(app)
      .post(base)
      .set(alice)
      .send({ fullName: "Salma Ahmed", relation: "Wife", sharePercent: 60 });
    expect(first.status).toBe(201);
    expect(
      (
        await request(app)
          .post(base)
          .set(alice)
          .send({ fullName: "Rafi Ahmed", relation: "Son", sharePercent: 50 })
      ).status,
    ).toBe(422);
    const second = await request(app)
      .post(base)
      .set(alice)
      .send({ fullName: "Rafi Ahmed", relation: "Son", sharePercent: 40 });
    expect(second.body.data.nominees.map((n) => n.sharePercent)).toEqual(["60", "40"]);
    const salma = second.body.data.nominees[0];
    expect(
      (await request(app).patch(`${base}/${salma.id}`).set(alice).send({ sharePercent: 70 }))
        .status,
    ).toBe(422);
  });

  it("attaches documents; a photo becomes the profile photo", async () => {
    const customer = (await createCustomer(alice)).body.data;
    const upload = (buffer, name) =>
      request(app).post("/api/v1/files").set(alice).attach("file", buffer, name);
    const photo = (await upload(PNG, "karim.png")).body.data;
    const nid = (await upload(PDF, "nid.pdf")).body.data;
    const base = `/api/v1/customers/${customer.id}/documents`;

    expect(
      (await request(app).post(base).set(alice).send({ fileId: nid.id, category: "PHOTO" })).status,
    ).toBe(422);
    await request(app).post(base).set(alice).send({ fileId: nid.id, category: "NID" });
    const withPhoto = await request(app)
      .post(base)
      .set(alice)
      .send({ fileId: photo.id, category: "PHOTO" });
    expect(withPhoto.body.data.photoUrl).toMatch(new RegExp(`/files/${photo.id}/content`));
    expect(withPhoto.body.data.documents.map((d) => d.category).sort()).toEqual(["NID", "PHOTO"]);

    const removed = await request(app).delete(`${base}/${photo.id}`).set(alice);
    expect(removed.body.data.photoUrl).toBeNull();
    expect(removed.body.data.documents).toHaveLength(1);
  });

  it("links plot holds to the customer and protects held customers from deletion", async () => {
    const customer = (await createCustomer(alice)).body.data;
    const project = await prisma.project.create({ data: { code: "FCITY", name: "Fujisan City" } });
    const block = await prisma.block.create({
      data: { projectId: project.id, code: "A", name: "A" },
    });
    const plot = await prisma.plot.create({
      data: {
        projectId: project.id,
        blockId: block.id,
        plotNumber: "1",
        code: "A-1",
        areaSqft: 1440,
        price: 4800000,
      },
    });

    const hold = await request(app).post(`/api/v1/plots/${plot.id}/hold`).set(admin).send({
      requestedById: staff.alice.id,
      customerId: customer.id,
      reason: "Site visit on Friday",
    });
    expect(hold.status).toBe(200);

    const detail = await request(app).get(`/api/v1/customers/${customer.id}`).set(alice);
    expect(detail.body.data.holds[0]).toMatchObject({ status: "ACTIVE", plot: { code: "A-1" } });
    expect((await request(app).delete(`/api/v1/customers/${customer.id}`).set(admin)).status).toBe(
      409,
    );
  });
});
