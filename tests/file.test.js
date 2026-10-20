import { rm } from "node:fs/promises";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { authHeader, createUser, resetDatabase } from "./helpers/db.js";

// 2×3 px PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGP4z8DAwMDAxMDAAAAeLwIEXYCmfwAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

let app;
let alice;
let bob;

beforeAll(async () => {
  app = await createApp();
});

beforeEach(async () => {
  await resetDatabase();
  await createUser({ username: "alice" });
  await createUser({ username: "bobby" });
  alice = await authHeader(request, app, "alice");
  bob = await authHeader(request, app, "bobby");
});

afterAll(async () => {
  await rm(".test-storage", { recursive: true, force: true });
  await prisma.$disconnect();
});

const upload = (auth, buffer, name, fields = {}) => {
  const req = request(app).post("/api/v1/files").set(auth).attach("file", buffer, name);
  for (const [key, value] of Object.entries(fields)) req.field(key, value);
  return req;
};

describe("files", () => {
  it("uploads an image, detects type and dimensions, and serves it via a signed URL", async () => {
    const res = await upload(alice, PNG, "layout.png", {
      category: "LAYOUT",
      entityType: "Project",
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      mimeType: "image/png",
      width: 2,
      height: 3,
      category: "LAYOUT",
      originalName: "layout.png",
    });

    const content = await request(app).get(res.body.data.url).buffer(true);
    expect(content.status).toBe(200);
    expect(content.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(content.body, PNG)).toBe(0);
  });

  it("detects the real type from the content, not the name", async () => {
    const fake = await upload(alice, Buffer.from("<script>alert(1)</script>"), "photo.png");
    expect(fake.status).toBe(422);

    const pdf = await upload(alice, PDF, "agreement.bin", { category: "AGREEMENT" });
    expect(pdf.status).toBe(201);
    expect(pdf.body.data).toMatchObject({ mimeType: "application/pdf", width: null });
  });

  it("rejects missing, oversized and unauthenticated uploads", async () => {
    expect(
      (await request(app).post("/api/v1/files").set(alice).field("category", "OTHER")).status,
    ).toBe(400);
    expect((await upload(alice, Buffer.alloc(1024 * 1024 + 1, 0x89), "big.png")).status).toBe(413);
    expect((await request(app).post("/api/v1/files").attach("file", PNG, "x.png")).status).toBe(
      401,
    );
  });

  it("needs a valid token or sign-in to read content", async () => {
    const { body } = await upload(alice, PNG, "a.png");
    const id = body.data.id;
    expect((await request(app).get(`/api/v1/files/${id}/content`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/files/${id}/content?token=forged`)).status).toBe(401);

    const other = await upload(alice, PNG, "b.png");
    const otherToken = new URL(other.body.data.url, "http://x").searchParams.get("token");
    expect((await request(app).get(`/api/v1/files/${id}/content?token=${otherToken}`)).status).toBe(
      401,
    );

    expect((await request(app).get(`/api/v1/files/${id}/content`).set(bob)).status).toBe(200);
  });

  it("only lets the uploader delete", async () => {
    const { body } = await upload(alice, PNG, "a.png");
    expect((await request(app).delete(`/api/v1/files/${body.data.id}`).set(bob)).status).toBe(403);
    expect((await request(app).delete(`/api/v1/files/${body.data.id}`).set(alice)).status).toBe(
      200,
    );
    expect((await request(app).get(`/api/v1/files/${body.data.id}`).set(alice)).status).toBe(404);
  });
});
