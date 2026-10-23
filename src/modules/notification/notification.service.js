import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { paginationMeta } from "#core/utils/listQuery.js";
import logger from "#core/utils/logger.js";

/** Read notifications are kept this long, unread ones twice as long. */
const KEEP_READ_DAYS = 90;

const select = {
  id: true,
  type: true,
  title: true,
  body: true,
  link: true,
  readAt: true,
  createdAt: true,
};

/** Newest first; always only the signed-in user's own notifications. */
const list = async (actor, query) => {
  const where = { userId: actor.userId, ...(query.unread && { readAt: null }) };
  const [data, total, unread] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: actor.userId, readAt: null } }),
  ]);
  return { data, meta: { ...paginationMeta(query, total), unread } };
};

const unreadCount = async (actor) => ({
  count: await prisma.notification.count({ where: { userId: actor.userId, readAt: null } }),
});

const markRead = async (actor, id) => {
  const { count } = await prisma.notification.updateMany({
    where: { id, userId: actor.userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (!count) {
    const exists = await prisma.notification.count({ where: { id, userId: actor.userId } });
    if (!exists) throw AppError.notFound("Notification not found");
  }
  return prisma.notification.findUnique({ where: { id }, select });
};

const markAllRead = async (actor) => {
  const { count } = await prisma.notification.updateMany({
    where: { userId: actor.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { marked: count };
};

/** Background job: drops old notifications so the table stays small. */
const prune = async (now = new Date()) => {
  const day = 86_400_000;
  const { count } = await prisma.notification.deleteMany({
    where: {
      OR: [
        { readAt: { lt: new Date(now.getTime() - KEEP_READ_DAYS * day) } },
        { createdAt: { lt: new Date(now.getTime() - 2 * KEEP_READ_DAYS * day) } },
      ],
    },
  });
  if (count) logger.info({ count }, "Old notifications removed");
  return count;
};

export const NotificationService = { list, unreadCount, markRead, markAllRead, prune };
