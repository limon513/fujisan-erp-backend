import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { recordAudit } from "#core/audit/audit.service.js";
import { fromPaisa, toPaisa } from "#core/money/money.js";
import { paginationMeta } from "#core/utils/listQuery.js";
import { dhakaDate } from "#core/utils/time.js";
import {
  accountByKey,
  postProjectCost,
  postProjectCostReversed,
} from "#modules/journal/journal.posting.js";
import { CATEGORIES } from "./project-cost.constant.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);
const taka = (value) => `৳${Number(value).toLocaleString("en-IN")}`;
const account = { select: { id: true, code: true, name: true } };

const select = {
  id: true,
  date: true,
  category: true,
  description: true,
  amount: true,
  reference: true,
  status: true,
  reversedAt: true,
  reverseReason: true,
  createdAt: true,
  project: { select: { id: true, code: true, name: true } },
  inventoryAccount: account,
  paidFromAccount: account,
};

const list = async (query) => {
  const where = query.projectId ? { projectId: query.projectId } : {};
  const [data, total] = await prisma.$transaction([
    prisma.projectCost.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select,
    }),
    prisma.projectCost.count({ where }),
  ]);
  return { data, meta: paginationMeta(query, total) };
};

/**
 * A project's land cost and how much of it has gone to cost of sales, the area still unsold and
 * its cost per sqft, and the gross profit on the plots registered so far.
 */
const summary = async (projectId) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!project) throw AppError.notFound("Project not found");
  const [byCategory, registered, plots] = await Promise.all([
    prisma.projectCost.groupBy({
      by: ["category"],
      where: { projectId, status: "POSTED" },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.booking.findMany({
      where: { projectId, status: "REGISTERED" },
      select: { id: true, netPrice: true, plot: { select: { areaSqft: true } } },
    }),
    prisma.plot.aggregate({
      where: { projectId, deletedAt: null },
      _sum: { areaSqft: true },
      _count: { _all: true },
    }),
  ]);
  const costOfSalesAccount = await accountByKey(prisma, "COST_OF_SALES");
  const sold = await prisma.journalLine.aggregate({
    where: {
      accountId: costOfSalesAccount.id,
      bookingId: { in: registered.map((b) => b.id) },
    },
    _sum: { debit: true, credit: true },
  });
  const total = byCategory.reduce((sum, c) => sum + toPaisa(c._sum.amount ?? 0), 0n);
  const costOfSales = toPaisa(sold._sum.debit ?? 0) - toPaisa(sold._sum.credit ?? 0);
  const revenue = registered.reduce((sum, b) => sum + toPaisa(b.netPrice), 0n);
  const totalArea = Number(plots._sum.areaSqft ?? 0);
  const soldArea = registered.reduce((sum, b) => sum + Number(b.plot.areaSqft ?? 0), 0);
  const unsoldArea = totalArea - soldArea;
  const left = total - costOfSales;
  const grossProfit = revenue - costOfSales;
  return {
    project,
    totalCost: fromPaisa(total),
    byCategory: Object.entries(CATEGORIES).map(([key, { label }]) => {
      const row = byCategory.find((c) => c.category === key);
      return {
        key,
        label,
        count: row?._count._all ?? 0,
        amount: fromPaisa(toPaisa(row?._sum.amount ?? 0)),
      };
    }),
    costOfSales: fromPaisa(costOfSales),
    inventoryLeft: fromPaisa(left),
    area: { total: totalArea, sold: soldArea, unsold: unsoldArea, plots: plots._count._all },
    costPerSqftUnsold: unsoldArea > 0 ? (Number(fromPaisa(left)) / unsoldArea).toFixed(2) : null,
    registered: {
      plots: registered.length,
      revenue: fromPaisa(revenue),
      grossProfit: fromPaisa(grossProfit),
      margin: revenue > 0n ? Number((grossProfit * 1000n) / revenue) / 10 : null,
    },
  };
};

/** Records a cost and posts it: Dr the category's land inventory account / Cr the paying account. */
const create = async (
  actor,
  { projectId, date, category, description, amount, paidFromAccountId, reference },
) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!project) throw invalid("projectId", "Project not found");
  const paidFrom = await prisma.account.findUnique({ where: { id: paidFromAccountId } });
  if (
    !paidFrom ||
    paidFrom.isGroup ||
    !paidFrom.isActive ||
    !["ASSET", "LIABILITY"].includes(paidFrom.type)
  ) {
    throw invalid("paidFromAccountId", "Choose an active cash, bank or payable account");
  }
  const inventory = await accountByKey(prisma, CATEGORIES[category].account);
  if (paidFrom.id === inventory.id)
    throw invalid("paidFromAccountId", "Choose the account it was paid from");

  const cost = await prisma.$transaction(async (tx) => {
    const row = await tx.projectCost.create({
      data: {
        projectId,
        date: date ?? dhakaDate(),
        category,
        description,
        amount,
        inventoryAccountId: inventory.id,
        paidFromAccountId,
        reference: reference ?? null,
        createdById: actor.userId,
      },
    });
    await postProjectCost(tx, row.id, actor);
    await recordAudit(
      {
        action: "PROJECT_COST_RECORDED",
        entityType: "Project",
        entityId: projectId,
        description: `${CATEGORIES[category].label}: ${description}, ${taka(amount)} from ${paidFrom.code} ${paidFrom.name}`,
      },
      tx,
    );
    return row;
  });
  return prisma.projectCost.findUnique({ where: { id: cost.id }, select });
};

/** Undoes a mistaken cost with a mirror entry; the record stays, marked reversed. */
const reverse = async (actor, id, { reason }) => {
  const cost = await prisma.projectCost.findUnique({ where: { id } });
  if (!cost) throw AppError.notFound("Cost not found");
  if (cost.status !== "POSTED") throw AppError.conflict("This cost was already reversed");
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.projectCost.updateMany({
      where: { id, status: "POSTED" },
      data: {
        status: "REVERSED",
        reversedAt: new Date(),
        reversedById: actor.userId,
        reverseReason: reason,
      },
    });
    if (!count) throw AppError.conflict("Someone else just reversed this cost");
    await postProjectCostReversed(tx, id, actor);
    await recordAudit(
      {
        action: "PROJECT_COST_REVERSED",
        entityType: "Project",
        entityId: cost.projectId,
        description: `Reversed ${cost.description} (${taka(cost.amount)}): ${reason}`,
      },
      tx,
    );
  });
  return prisma.projectCost.findUnique({ where: { id }, select });
};

export const ProjectCostService = { list, summary, create, reverse };
