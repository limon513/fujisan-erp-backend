import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { clearOutbox, getOutbox } from "#core/mail/mailer.js";
import { createUser, resetDatabase, TEST_PASSWORD } from "./helpers/db.js";

let app;

beforeAll(async () => {
  app = await createApp();
});

beforeEach(async () => {
  await resetDatabase();
  clearOutbox();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const login = (agent, identifier = "tester", password = TEST_PASSWORD) =>
  agent.post("/api/v1/auth/login").send({ identifier, password });

const refreshCookie = (res) =>
  (res.headers["set-cookie"] ?? []).find((cookie) => cookie.startsWith("erp_rt="));

const cookieValue = (setCookie) => setCookie.split(";")[0];

describe("login", () => {
  it("signs in by username, email or mobile and sets a refresh cookie", async () => {
    await createUser({ mobile: "8801711000000" });

    for (const identifier of ["tester", "TESTER@example.com", "01711-000000"]) {
      const res = await login(request(app), identifier);
      expect(res.status, identifier).toBe(200);
      expect(res.body.data).toMatchObject({ expiresIn: 900, user: { username: "tester" } });
      expect(res.body.data.accessToken).toBeTypeOf("string");
      expect(res.body.data.refreshToken).toBeUndefined();
      expect(refreshCookie(res)).toMatch(/HttpOnly/);
      expect(refreshCookie(res)).toMatch(/Path=\/api\/v1\/auth/);
    }

    expect(await prisma.loginHistory.count({ where: { success: true } })).toBe(3);
  });

  it("rejects bad credentials with the same message for unknown users", async () => {
    await createUser();
    const wrong = await login(request(app), "tester", "Wrong1234");
    const unknown = await login(request(app), "nobody", "Wrong1234");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
    expect(await prisma.loginHistory.count({ where: { success: false } })).toBe(2);
  });

  it("locks the account after repeated failures", async () => {
    await createUser();
    for (let i = 0; i < 4; i++)
      expect((await login(request(app), "tester", "Wrong1234")).status).toBe(401);

    const fifth = await login(request(app), "tester", "Wrong1234");
    expect(fifth.status).toBe(423);

    // even the correct password is refused while locked
    expect((await login(request(app))).status).toBe(423);
    expect(await prisma.auditLog.count({ where: { action: "ACCOUNT_LOCKED" } })).toBe(1);
  });

  it("refuses disabled accounts", async () => {
    await createUser({ status: "INACTIVE" });
    expect((await login(request(app))).status).toBe(403);
  });
});

describe("access token", () => {
  it("returns the current user with permissions", async () => {
    await createUser();
    const { body } = await login(request(app));
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("authorization", `Bearer ${body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      username: "tester",
      isSuperAdmin: false,
      permissions: {},
    });
  });

  it("is required and must be valid", async () => {
    expect((await request(app).get("/api/v1/auth/me")).status).toBe(401);
    const res = await request(app).get("/api/v1/auth/me").set("authorization", "Bearer nope");
    expect(res.status).toBe(401);
  });

  it("stops working once the session is revoked", async () => {
    await createUser();
    const agent = request.agent(app);
    const { body } = await login(agent);
    await agent.post("/api/v1/auth/logout");
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("authorization", `Bearer ${body.data.accessToken}`);
    expect(res.status).toBe(401);
  });
});

describe("refresh token", () => {
  it("rotates on every refresh", async () => {
    await createUser();
    const first = await login(request(app));
    const cookie1 = cookieValue(refreshCookie(first));

    const second = await request(app).post("/api/v1/auth/refresh").set("cookie", cookie1);
    expect(second.status).toBe(200);
    expect(second.body.data.accessToken).toBeTypeOf("string");
    const cookie2 = cookieValue(refreshCookie(second));
    expect(cookie2).not.toBe(cookie1);

    expect((await request(app).post("/api/v1/auth/refresh").set("cookie", cookie2)).status).toBe(
      200,
    );
  });

  it("accepts the previous token briefly (parallel tabs)", async () => {
    await createUser();
    const cookie1 = cookieValue(refreshCookie(await login(request(app))));
    await request(app).post("/api/v1/auth/refresh").set("cookie", cookie1);
    const again = await request(app).post("/api/v1/auth/refresh").set("cookie", cookie1);
    expect(again.status).toBe(200);
  });

  it("revokes the session when an old token is reused", async () => {
    await createUser();
    const cookie1 = cookieValue(refreshCookie(await login(request(app))));
    const rotated = await request(app).post("/api/v1/auth/refresh").set("cookie", cookie1);
    const cookie2 = cookieValue(refreshCookie(rotated));

    // move the rotation outside the grace window, then replay the stolen first token
    await prisma.session.updateMany({ data: { rotatedAt: new Date(Date.now() - 60_000) } });
    const replay = await request(app).post("/api/v1/auth/refresh").set("cookie", cookie1);
    expect(replay.status).toBe(401);

    // the legitimate holder is signed out too
    expect((await request(app).post("/api/v1/auth/refresh").set("cookie", cookie2)).status).toBe(
      401,
    );
    const session = await prisma.session.findFirst();
    expect(session.revokeReason).toBe("TOKEN_REUSE");
  });

  it("fails without a cookie or after logout", async () => {
    await createUser();
    expect((await request(app).post("/api/v1/auth/refresh")).status).toBe(401);

    const agent = request.agent(app);
    await login(agent);
    expect((await agent.post("/api/v1/auth/logout")).status).toBe(200);
    expect((await agent.post("/api/v1/auth/refresh")).status).toBe(401);
  });
});

describe("password", () => {
  it("forces a password change before anything else", async () => {
    await createUser({ mustChangePassword: true });
    const { body } = await login(request(app));
    const auth = { authorization: `Bearer ${body.data.accessToken}` };

    expect((await request(app).get("/api/v1/auth/sessions").set(auth)).status).toBe(403);
    expect((await request(app).get("/api/v1/auth/me").set(auth)).status).toBe(200);

    const change = await request(app)
      .post("/api/v1/auth/change-password")
      .set(auth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: "NewPassw0rd" });
    expect(change.status).toBe(200);
    expect((await request(app).get("/api/v1/auth/sessions").set(auth)).status).toBe(200);
  });

  it("validates the new password and signs out other devices on change", async () => {
    await createUser();
    const phone = await login(request(app));
    const laptop = await login(request(app));
    const auth = { authorization: `Bearer ${laptop.body.data.accessToken}` };

    const weak = await request(app)
      .post("/api/v1/auth/change-password")
      .set(auth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: "short" });
    expect(weak.status).toBe(400);

    const ok = await request(app)
      .post("/api/v1/auth/change-password")
      .set(auth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: "NewPassw0rd" });
    expect(ok.status).toBe(200);

    const phoneMe = await request(app)
      .get("/api/v1/auth/me")
      .set("authorization", `Bearer ${phone.body.data.accessToken}`);
    expect(phoneMe.status).toBe(401);
    expect((await request(app).get("/api/v1/auth/me").set(auth)).status).toBe(200);
    expect((await login(request(app), "tester", "NewPassw0rd")).status).toBe(200);
  });

  it("resets a forgotten password with an emailed code", async () => {
    await createUser();
    const before = await login(request(app));

    const forgot = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ identifier: "tester" });
    expect(forgot.status).toBe(200);
    const code = getOutbox()[0].text.match(/\b(\d{6})\b/)[1];

    const wrong = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({
        identifier: "tester",
        code: code === "000000" ? "111111" : "000000",
        newPassword: "Reset1234",
      });
    expect(wrong.status).toBe(400);

    const reset = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ identifier: "tester", code, newPassword: "Reset1234" });
    expect(reset.status).toBe(200);

    // code is single-use, old sessions are gone, new password works
    const reuse = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ identifier: "tester", code, newPassword: "Another1234" });
    expect(reuse.status).toBe(400);
    const oldMe = await request(app)
      .get("/api/v1/auth/me")
      .set("authorization", `Bearer ${before.body.data.accessToken}`);
    expect(oldMe.status).toBe(401);
    expect((await login(request(app), "tester", "Reset1234")).status).toBe(200);
  });

  it("does not reveal whether an account exists", async () => {
    const res = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ identifier: "ghost" });
    expect(res.status).toBe(200);
    expect(getOutbox()).toHaveLength(0);
  });
});

describe("sessions", () => {
  it("lists my devices and lets me sign one out", async () => {
    await createUser();
    const phone = await login(request(app));
    const laptop = await login(request(app));
    const auth = { authorization: `Bearer ${laptop.body.data.accessToken}` };

    const list = await request(app).get("/api/v1/auth/sessions").set(auth);
    expect(list.body.data).toHaveLength(2);
    const other = list.body.data.find((session) => !session.current);

    expect((await request(app).delete(`/api/v1/auth/sessions/${other.id}`).set(auth)).status).toBe(
      200,
    );
    const phoneMe = await request(app)
      .get("/api/v1/auth/me")
      .set("authorization", `Bearer ${phone.body.data.accessToken}`);
    expect(phoneMe.status).toBe(401);

    const logoutAll = await request(app).post("/api/v1/auth/logout-all").set(auth);
    expect(logoutAll.body.data.revokedSessions).toBe(1);
    expect((await request(app).get("/api/v1/auth/me").set(auth)).status).toBe(401);
  });

  it("shows my login history", async () => {
    await createUser();
    await login(request(app), "tester", "Wrong1234");
    const { body } = await login(request(app));
    const res = await request(app)
      .get("/api/v1/auth/login-history")
      .set("authorization", `Bearer ${body.data.accessToken}`);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.data[0].success).toBe(true);
  });
});
