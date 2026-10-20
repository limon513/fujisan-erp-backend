import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma, { assertUtcSession } from "#core/db/prisma.js";

let app;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("app", () => {
  it("reports health with database status", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: "ok", database: "up" } });
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("runs database sessions in UTC (the pg adapter depends on it)", async () => {
    await expect(assertUtcSession()).resolves.toBeUndefined();
    const written = await prisma.sequence.create({ data: { key: "TZ_TEST", prefix: "" } });
    const [{ stored }] =
      await prisma.$queryRaw`SELECT "updatedAt" AS stored FROM "Sequence" WHERE key = 'TZ_TEST'`;
    expect(stored.toISOString()).toBe(written.updatedAt.toISOString());
    await prisma.sequence.delete({ where: { key: "TZ_TEST" } });
  });

  it("returns the error envelope for unknown routes", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: "Route not found: GET /api/v1/does-not-exist",
      errors: [],
    });
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await request(app)
      .post("/api/v1/health")
      .set("content-type", "application/json")
      .send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Malformed JSON body");
  });
});
