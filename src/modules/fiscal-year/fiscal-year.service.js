import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { recordAudit } from "#core/audit/audit.service.js";

const select = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  status: true,
  closedAt: true,
  _count: { select: { entries: true } },
};
const toDto = ({ _count, ...fy }) => ({ ...fy, entryCount: _count.entries });

const list = async () =>
  (await prisma.fiscalYear.findMany({ orderBy: { startDate: "desc" }, select })).map(toDto);

/** A closed year takes no more postings (reopen it to correct something). */
const setStatus = async (actor, id, status) => {
  const year = await prisma.fiscalYear.findUnique({ where: { id } });
  if (!year) throw AppError.notFound("Fiscal year not found");
  if (year.status === status)
    throw AppError.conflict(`${year.name} is already ${status.toLowerCase()}`);
  await prisma.fiscalYear.update({
    where: { id },
    data: {
      status,
      closedAt: status === "CLOSED" ? new Date() : null,
      closedById: status === "CLOSED" ? actor.userId : null,
    },
  });
  await recordAudit({
    action: status === "CLOSED" ? "FISCAL_YEAR_CLOSED" : "FISCAL_YEAR_REOPENED",
    entityType: "FiscalYear",
    entityId: id,
    description: `${status === "CLOSED" ? "Closed" : "Reopened"} ${year.name}`,
  });
  return toDto(await prisma.fiscalYear.findUnique({ where: { id }, select }));
};

export const FiscalYearService = { list, setStatus };
