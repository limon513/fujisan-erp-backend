import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { NotificationService } from "#modules/notification/notification.service.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;
let me;
let other;
let h;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedAccessControl();
  me = await createUser({ username: "mine", roleSlug: "viewer" });
  other = await createUser({ username: "other", roleSlug: "viewer" });
  h = { me: await authHeader(request, app, "mine"), other: await authHeader(request, app, "other") };
  const day = 86_400_000;
  await prisma.notification.createMany({
    data: [
      { userId: me.id, type: "A", title: "First", createdAt: new Date(Date.now() - 2000) },
      { userId: me.id, type: "B", title: "Second", link: "/crm/leads/x" },
      { userId: other.id, type: "C", title: "Not mine" },
      {
        userId: me.id,
        type: "OLD",
        title: "Old and read",
        readAt: new Date(Date.now() - 100 * day),
        createdAt: new Date(Date.now() - 100 * day),
      },
    ],
  });
});

const api = (method, path, as = "me") => request(app)[method](`/api/v1${path}`).set(h[as]);

describe("notifications", () => {
  it("lists only my own, newest first, with the unread count", async () => {
    const res = await api("get", "/notifications");
    expect(res.body.data.map((n) => n.title)).toEqual(["Second", "First", "Old and read"]);
    expect(res.body.meta.unread).toBe(2);
    const unread = await api("get", "/notifications?unread=true");
    expect(unread.body.data).toHaveLength(2);
    expect((await api("get", "/notifications/unread-count")).body.data).toEqual({ count: 2 });
  });

  it("marks one or all as read, never someone else's", async () => {
    const theirs = await prisma.notification.findFirst({ where: { userId: other.id } });
    expect((await api("post", `/notifications/${theirs.id}/read`)).status).toBe(404);

    const mine = await prisma.notification.findFirst({ where: { userId: me.id, title: "Second" } });
    const res = await api("post", `/notifications/${mine.id}/read`);
    expect(res.body.data.readAt).not.toBeNull();
    expect((await api("post", `/notifications/${mine.id}/read`)).status).toBe(200);

    expect((await api("post", "/notifications/read-all")).body.data).toEqual({ marked: 1 });
    expect((await api("get", "/notifications/unread-count")).body.data.count).toBe(0);
    expect((await api("get", "/notifications/unread-count", "other")).body.data.count).toBe(1);
  });

  it("prunes notifications read long ago", async () => {
    expect(await NotificationService.prune()).toBe(1);
    expect(await prisma.notification.count({ where: { userId: me.id } })).toBe(2);
  });
});
