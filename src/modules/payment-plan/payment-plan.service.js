import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { dhakaDay } from "#core/utils/time.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { buildSchedule } from "./payment-plan.schedule.js";
import { termProblems } from "./payment-plan.validation.js";

const select = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  sortOrder: true,
  downPaymentType: true,
  downPaymentValue: true,
  installmentCount: true,
  frequency: true,
  interestRate: true,
  gracePeriodDays: true,
  lateFeeType: true,
  lateFeeValue: true,
  cancellationChargeType: true,
  cancellationChargeValue: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, name: true } },
};

const findPlan = async (id) => {
  const plan = await prisma.paymentPlan.findFirst({ where: { id, deletedAt: null }, select });
  if (!plan) throw AppError.notFound("Payment plan not found");
  return plan;
};

const assertProject = async (projectId) => {
  if (projectId && !(await prisma.project.count({ where: { id: projectId, deletedAt: null } }))) {
    throw AppError.unprocessable("Project not found", [
      { path: "projectId", message: "Not found" },
    ]);
  }
};

/** Today's Dhaka date at UTC midnight (date-only convention). */
const today = () => {
  const { start } = dhakaDay();
  return new Date(start.getTime() + 6 * 3_600_000);
};

/** Schedule, or a 422 explaining why the price doesn't work with these terms. */
function scheduleOrFail(terms, { price, startDate }) {
  try {
    return buildSchedule(terms, { price, startDate: startDate ?? today() });
  } catch (error) {
    if (error instanceof RangeError) {
      throw AppError.unprocessable(error.message, [{ path: "price", message: error.message }]);
    }
    throw error;
  }
}

const list = async (query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, ["name"]);
  const where = {
    deletedAt: null,
    ...searchWhere,
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...(query.projectId && { OR: [{ projectId: query.projectId }, { projectId: null }] }),
  };
  const [data, total] = await prisma.$transaction([
    prisma.paymentPlan.findMany({ where, skip, take, orderBy: [orderBy, { name: "asc" }], select }),
    prisma.paymentPlan.count({ where }),
  ]);
  return { data, meta: paginationMeta(query, total) };
};

const create = async (actor, data) => {
  await assertProject(data.projectId);
  const plan = await prisma.paymentPlan.create({ data: { ...data, createdById: actor.userId } });
  return findPlan(plan.id);
};

const update = async (actor, id, data) => {
  const current = await findPlan(id);
  await assertProject(data.projectId);
  const problems = termProblems({ ...current, ...data });
  if (problems.length) throw AppError.unprocessable(problems[0].message, problems);
  await prisma.paymentPlan.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
  return findPlan(id);
};

/** Soft delete. Bookings keep their own copy of the terms. */
const remove = async (actor, id) => {
  await findPlan(id);
  await prisma.paymentPlan.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: actor.userId },
  });
};

const schedule = async (id, input) => scheduleOrFail(await findPlan(id), input);

/** Schedule for terms that aren't saved yet (live preview while editing a plan). */
const preview = async ({ price, startDate, ...terms }) =>
  scheduleOrFail(terms, { price, startDate });

export const PaymentPlanService = {
  list,
  getById: findPlan,
  create,
  update,
  remove,
  schedule,
  preview,
};
