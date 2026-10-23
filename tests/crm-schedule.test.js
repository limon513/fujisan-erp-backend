import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { dhakaDay } from "#core/utils/time.js";
import { FollowUpService } from "#modules/follow-up/follow-up.service.js";
import { SiteVisitService } from "#modules/site-visit/site-visit.service.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;
let h;
let org;
let source;
let project;

const MIN = 60_000;
const at = (ms) => new Date(Date.now() + ms).toISOString();

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
  let n = 0;
  const employee = (fullName) =>
    prisma.employee.create({
      data: {
        employeeCode: `E${++n}`,
        fullName,
        mobile: `88017110000${String(n).padStart(2, "0")}`,
        joiningDate: new Date("2026-01-01"),
        branchId: branch.id,
        departmentId: sales.id,
        designationId: designation.id,
      },
    });
  const sellerEmp = await employee("Rahim Seller");
  const otherEmp = await employee("Other Seller");
  const managerEmp = await employee("Selim Manager");
  org = { sellerEmp, otherEmp };
  org.users = {
    seller: await createUser({
      username: "seller",
      roleSlug: "sales-executive",
      employee: sellerEmp,
    }),
    other: await createUser({ username: "other", roleSlug: "sales-executive", employee: otherEmp }),
    manager: await createUser({
      username: "manager",
      roleSlug: "sales-manager",
      employee: managerEmp,
    }),
    root: await createUser({ username: "root", roleSlug: "super-admin" }),
  };
  h = {};
  for (const name of Object.keys(org.users)) h[name] = await authHeader(request, app, name);

  source = await prisma.leadSource.create({ data: { code: "WALK_IN", name: "Walk-in" } });
  project = await prisma.project.create({ data: { code: "FC", name: "Fujisan City" } });
});

const api = (method, path, as, body) =>
  request(app)[method](`/api/v1${path}`).set(h[as]).send(body);

const newLead = async (as = "seller", extra = {}) =>
  (
    await api("post", "/leads", as, {
      fullName: "Nasima Akter",
      mobile: "01911000001",
      sourceId: source.id,
      ...extra,
    })
  ).body.data;

const lead = (id, as = "seller") => api("get", `/leads/${id}`, as).then((r) => r.body.data);

describe("follow-ups", () => {
  it("schedules a first follow-up from the lead form", async () => {
    const created = await newLead("seller", { nextFollowUpAt: at(60 * MIN) });
    expect(created.followUps).toHaveLength(1);
    expect(created.followUps[0]).toMatchObject({ type: "CALL", purpose: "First follow-up" });
    expect(created.nextFollowUpAt).toBe(created.followUps[0].dueAt);
  });

  it("keeps the lead's next follow-up on the earliest pending one", async () => {
    const l = await newLead();
    const later = await api("post", "/follow-ups", "seller", {
      leadId: l.id,
      type: "WHATSAPP",
      dueAt: at(3 * 24 * 60 * MIN),
      purpose: "Send brochure",
    });
    expect(later.status).toBe(201);
    expect(later.body.data).toMatchObject({
      owner: { fullName: "Rahim Seller" },
      status: "PENDING",
    });
    const sooner = (
      await api("post", "/follow-ups", "seller", {
        leadId: l.id,
        type: "CALL",
        dueAt: at(30 * MIN),
      })
    ).body.data;
    expect((await lead(l.id)).nextFollowUpAt).toBe(sooner.dueAt);

    await api("post", `/follow-ups/${sooner.id}/cancel`, "seller", { reason: "Called already" });
    const after = await lead(l.id);
    expect(after.nextFollowUpAt).toBe(later.body.data.dueAt);
    expect(after.activities.filter((a) => a.type === "FOLLOW_UP_SCHEDULED")).toHaveLength(2);
  });

  it("logs the outcome on the lead and schedules the next one", async () => {
    const l = await newLead();
    const f = (
      await api("post", "/follow-ups", "seller", {
        leadId: l.id,
        type: "CALL",
        dueAt: at(-5 * MIN),
      })
    ).body.data;
    expect((await api("post", `/follow-ups/${f.id}/complete`, "seller", {})).status).toBe(400);
    const res = await api("post", `/follow-ups/${f.id}/complete`, "seller", {
      outcome: "Interested in A block, call back after Friday",
      next: { type: "CALL", dueAt: at(2 * 24 * 60 * MIN), purpose: "Confirm visit" },
    });
    expect(res.body.data).toMatchObject({ status: "DONE", doneBy: { name: "Rahim Seller" } });
    expect(
      (await api("post", `/follow-ups/${f.id}/complete`, "seller", { outcome: "again" })).status,
    ).toBe(409);

    const after = await lead(l.id);
    expect(after.status).toBe("CONTACTED");
    expect(after.followUps).toHaveLength(1);
    expect(after.followUps[0].purpose).toBe("Confirm visit");
    expect(after.activities.map((a) => a.type)).toEqual(
      expect.arrayContaining(["CALL", "STATUS_CHANGE", "FOLLOW_UP_SCHEDULED"]),
    );
  });

  it("sorts follow-ups into overdue, today and upcoming, within scope", async () => {
    const l = await newLead();
    const { end } = dhakaDay();
    const todayDue = Math.min(Date.now() + 10 * MIN, end.getTime() - MIN);
    for (const dueAt of [at(-60 * MIN), new Date(todayDue).toISOString(), at(3 * 24 * 60 * MIN)]) {
      await api("post", "/follow-ups", "seller", { leadId: l.id, type: "CALL", dueAt });
    }
    const counts = await api("get", "/follow-ups/counts?mine=true", "seller");
    expect(counts.body.data).toEqual({
      overdue: 1,
      today: todayDue > Date.now() ? 1 : 0,
      upcoming: 1,
    });
    const overdue = await api("get", "/follow-ups?when=overdue", "seller");
    expect(overdue.body.data).toHaveLength(1);
    expect(overdue.body.data[0].lead).toMatchObject({ leadCode: "LD-000001" });

    expect((await api("get", "/follow-ups?when=open", "other")).body.data).toEqual([]);
    expect((await api("get", "/follow-ups?when=open", "manager")).body.data).toHaveLength(3);
    const res = await api("post", "/follow-ups", "other", {
      leadId: l.id,
      type: "CALL",
      dueAt: at(MIN),
    });
    expect(res.status).toBe(422);
  });

  it("reminds the employee once, shortly before it is due", async () => {
    const l = await newLead();
    await api("post", "/follow-ups", "seller", { leadId: l.id, type: "CALL", dueAt: at(10 * MIN) });
    await api("post", "/follow-ups", "seller", { leadId: l.id, type: "CALL", dueAt: at(60 * MIN) });
    expect(await FollowUpService.sendReminders()).toBe(1);
    expect(await FollowUpService.sendReminders()).toBe(0);
    const notes = await prisma.notification.findMany({
      where: { userId: org.users.seller.id, type: "FOLLOW_UP_DUE" },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ link: `/crm/leads/${l.id}` });
    expect(notes[0].title).toBe("Due soon: Call Nasima Akter");
  });

  it("moves open work with the lead and drops it when the lead is lost", async () => {
    const l = await newLead("seller", { nextFollowUpAt: at(60 * MIN) });
    await api("post", "/site-visits", "seller", {
      leadId: l.id,
      projectId: project.id,
      scheduledAt: at(24 * 60 * MIN),
    });
    await api("post", `/leads/${l.id}/assign`, "manager", { ownerId: org.otherEmp.id });
    const theirs = await api("get", "/follow-ups?mine=true", "other");
    expect(theirs.body.data).toHaveLength(1);
    expect((await api("get", "/site-visits?mine=true", "other")).body.data).toHaveLength(1);

    await api("post", `/leads/${l.id}/status`, "manager", {
      status: "LOST",
      lostReason: "No budget",
    });
    const after = await lead(l.id, "manager");
    expect(after).toMatchObject({ nextFollowUpAt: null, followUps: [], siteVisits: [] });
    const res = await api("post", "/follow-ups", "manager", {
      leadId: l.id,
      type: "CALL",
      dueAt: at(MIN),
    });
    expect(res.status).toBe(409);
  });
});

describe("site visits", () => {
  it("moves the lead to Site visit and records the outcome", async () => {
    const l = await newLead();
    const res = await api("post", "/site-visits", "seller", {
      leadId: l.id,
      projectId: project.id,
      scheduledAt: at(3 * 60 * MIN),
      pickupPoint: "Uttara Sector 7",
      visitors: 3,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      transport: "OFFICE_CAR",
      visitors: 3,
      status: "SCHEDULED",
    });
    expect((await lead(l.id)).status).toBe("SITE_VISIT");

    const visit = res.body.data;
    expect(
      (await api("post", `/site-visits/${visit.id}/complete`, "seller", { status: "VISITED" }))
        .status,
    ).toBe(400);
    const done = await api("post", `/site-visits/${visit.id}/complete`, "seller", {
      status: "VISITED",
      interest: "HOT",
      plotsShown: "A-5, A-7",
      feedback: "Liked A-7, wants a price for the corner",
    });
    expect(done.body.data).toMatchObject({ status: "VISITED", interest: "HOT" });
    expect(done.body.data.visitedAt).not.toBeNull();
    const timeline = (await lead(l.id)).activities;
    expect(timeline[0]).toMatchObject({ type: "SITE_VISIT" });
    expect(timeline[0].body).toBe(
      "Visited Fujisan City, interest hot, shown A-5, A-7. Liked A-7, wants a price for the corner",
    );
    expect((await api("post", `/site-visits/${visit.id}/cancel`, "seller", {})).status).toBe(409);
  });

  it("never moves a lead backwards and reminds two hours ahead", async () => {
    const l = await newLead();
    await api("post", `/leads/${l.id}/status`, "seller", { status: "NEGOTIATION" });
    await api("post", "/site-visits", "seller", {
      leadId: l.id,
      projectId: project.id,
      scheduledAt: at(90 * MIN),
    });
    expect((await lead(l.id)).status).toBe("NEGOTIATION");
    expect(await SiteVisitService.sendReminders()).toBe(1);
    expect(await SiteVisitService.sendReminders()).toBe(0);
    const counts = await api("get", "/site-visits/counts?mine=true", "seller");
    expect(counts.body.data.today + counts.body.data.upcoming).toBe(1);
  });
});
