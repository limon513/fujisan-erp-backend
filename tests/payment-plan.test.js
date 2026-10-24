import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;
let h;
let project;
let other;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedAccessControl();
  await createUser({ username: "accounts", roleSlug: "accounts-manager" });
  await createUser({ username: "seller", roleSlug: "sales-executive" });
  h = {
    accounts: await authHeader(request, app, "accounts"),
    seller: await authHeader(request, app, "seller"),
  };
  project = await prisma.project.create({ data: { code: "FC", name: "Fujisan City" } });
  other = await prisma.project.create({ data: { code: "FG", name: "Fujisan Garden" } });
});

const api = (method, path, as, body) =>
  request(app)[method](`/api/v1${path}`).set(h[as]).send(body);

const plan = (extra = {}) => ({
  name: "24 months, 20% down",
  downPaymentValue: 20,
  installmentCount: 24,
  lateFeeValue: 500,
  cancellationChargeValue: 10,
  ...extra,
});

describe("payment plans", () => {
  it("creates plans with sensible defaults and checks the terms", async () => {
    const res = await api("post", "/payment-plans", "accounts", plan());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      downPaymentType: "PERCENT",
      downPaymentValue: "20",
      frequency: "MONTHLY",
      interestRate: "0",
      lateFeeType: "FIXED",
      lateFeeValue: "500",
      cancellationChargeType: "PERCENT",
      project: null,
    });

    const noInstallments = await api(
      "post",
      "/payment-plans",
      "accounts",
      plan({ installmentCount: 0 }),
    );
    expect(noInstallments.status).toBe(400);
    expect(noInstallments.body.errors[0].path).toBe("installmentCount");
    const over = await api(
      "post",
      "/payment-plans",
      "accounts",
      plan({ lateFeeType: "PERCENT", lateFeeValue: 120 }),
    );
    expect(over.body.errors[0].path).toBe("lateFeeValue");
    const full = await api(
      "post",
      "/payment-plans",
      "accounts",
      plan({ name: "Full payment", downPaymentValue: 100, installmentCount: 0 }),
    );
    expect(full.status).toBe(201);

    // An edit is checked against the stored terms too
    const edit = await api("patch", `/payment-plans/${full.body.data.id}`, "accounts", {
      downPaymentValue: 50,
    });
    expect(edit.status).toBe(422);
  });

  it("lists a project's plans plus plans for every project", async () => {
    await api("post", "/payment-plans", "accounts", plan({ name: "All projects" }));
    await api(
      "post",
      "/payment-plans",
      "accounts",
      plan({ name: "City only", projectId: project.id }),
    );
    await api(
      "post",
      "/payment-plans",
      "accounts",
      plan({ name: "Garden only", projectId: other.id }),
    );
    const res = await api(
      "get",
      `/payment-plans?projectId=${project.id}&sortBy=name&sortOrder=asc`,
      "seller",
    );
    expect(res.body.data.map((p) => p.name)).toEqual(["All projects", "City only"]);
  });

  it("shows the schedule for a price and previews unsaved terms", async () => {
    const created = (
      await api(
        "post",
        "/payment-plans",
        "accounts",
        plan({
          frequency: "QUARTERLY",
          installmentCount: 8,
          interestRate: 10,
          downPaymentType: "FIXED",
          downPaymentValue: 1000000,
        }),
      )
    ).body.data;
    const res = await api("post", `/payment-plans/${created.id}/schedule`, "seller", {
      price: 5000000,
      startDate: "2026-10-25",
    });
    expect(res.body.data).toMatchObject({
      interest: "800000.00",
      totalPayable: "5800000.00",
      installmentAmount: "600000.00",
    });
    expect(res.body.data.items[1].dueDate).toBe("2027-01-25T00:00:00.000Z");

    const tooMuch = await api("post", `/payment-plans/${created.id}/schedule`, "seller", {
      price: 500000,
    });
    expect(tooMuch.status).toBe(422);

    const preview = await api("post", "/payment-plans/preview", "accounts", {
      downPaymentValue: 25,
      installmentCount: 12,
      price: 4000000,
    });
    expect(preview.body.data).toMatchObject({
      downPayment: "1000000.00",
      installmentAmount: "250000.00",
    });
    expect(
      (
        await api("post", "/payment-plans/preview", "seller", {
          downPaymentValue: 25,
          installmentCount: 12,
          price: 1,
        })
      ).status,
    ).toBe(403);
  });

  it("lets sales staff see plans but not change them", async () => {
    const created = (await api("post", "/payment-plans", "accounts", plan())).body.data;
    expect((await api("get", "/payment-plans", "seller")).body.data).toHaveLength(1);
    expect((await api("post", "/payment-plans", "seller", plan())).status).toBe(403);
    expect((await api("delete", `/payment-plans/${created.id}`, "accounts")).status).toBe(200);
    expect((await api("get", "/payment-plans", "seller")).body.data).toHaveLength(0);
  });
});
