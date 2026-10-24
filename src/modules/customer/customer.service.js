import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { nextCode } from "#core/numbering/sequence.js";
import { assertInScope, buildScopeWhere, ownershipFields } from "#core/rbac/scope.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { contentUrl, toFileDto } from "#modules/file/file.service.js";
import {
  CUSTOMER_SEQUENCE,
  customerDetailSelect,
  customerListSelect,
  searchableFields,
} from "./customer.constant.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

const scopeWhere = (access) => buildScopeWhere(access.actor, access.scope);

const findCustomer = async (access, id, select = customerDetailSelect) => {
  const customer = await prisma.customer.findFirst({
    where: { id, deletedAt: null, AND: [scopeWhere(access)] },
    select,
  });
  if (!customer) throw AppError.notFound("Customer not found");
  return customer;
};

/**
 * Data-scope stamp for a customer. Default owner = the signed-in employee; assigning someone else
 * needs customer access wider than OWN, and the new owner must be inside the assigner's scope.
 */
async function resolveOwnership(access, ownerId) {
  const { actor, scope } = access;
  if (!ownerId || ownerId === actor.employeeId) {
    return actor.employeeId
      ? ownershipFields(actor)
      : { ownerId: null, teamId: null, departmentId: null, branchId: null };
  }
  if (scope === "OWN" && !actor.isSuperAdmin) {
    throw AppError.forbidden("You can only add customers for yourself");
  }
  const owner = await prisma.employee.findFirst({
    where: { id: ownerId, deletedAt: null, employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } },
    select: { id: true, teamId: true, departmentId: true, branchId: true },
  });
  if (!owner) throw invalid("ownerId", "Choose an active employee");
  const stamp = {
    ownerId: owner.id,
    teamId: owner.teamId,
    departmentId: owner.departmentId,
    branchId: owner.branchId,
  };
  assertInScope(actor, scope, stamp);
  return stamp;
}

/**
 * Customers sharing this mobile (main or alternative) or NID, across all scopes — so nobody
 * creates a second record for someone a colleague already serves. Returns minimal details.
 */
async function findDuplicates({ mobile, nidNumber, excludeId }) {
  const or = [
    ...(mobile ? [{ mobile }, { altMobile: mobile }] : []),
    ...(nidNumber ? [{ nidNumber }] : []),
  ];
  if (!or.length) return [];
  const rows = await prisma.customer.findMany({
    where: { deletedAt: null, OR: or, ...(excludeId && { id: { not: excludeId } }) },
    take: 10,
    select: {
      id: true,
      customerCode: true,
      fullName: true,
      mobile: true,
      altMobile: true,
      nidNumber: true,
      owner: { select: { fullName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    customerCode: row.customerCode,
    fullName: row.fullName,
    ownerName: row.owner?.fullName ?? null,
    matchedOn: [
      ...(nidNumber && row.nidNumber === nidNumber ? ["nidNumber"] : []),
      ...(mobile && (row.mobile === mobile || row.altMobile === mobile) ? ["mobile"] : []),
    ],
  }));
}

const describe = (match) =>
  `${match.customerCode} ${match.fullName}${match.ownerName ? ` (handled by ${match.ownerName})` : ""}`;

/** Same NID → always refused. Same mobile → refused unless confirmed (families share numbers). */
async function assertNotDuplicate({ mobile, nidNumber, excludeId, confirmDuplicateMobile }) {
  const matches = await findDuplicates({ mobile, nidNumber, excludeId });
  const byNid = matches.find((m) => m.matchedOn.includes("nidNumber"));
  if (byNid) {
    throw AppError.conflict(`A customer with this NID already exists: ${describe(byNid)}`, [
      { path: "nidNumber", message: `Already registered: ${describe(byNid)}` },
    ]);
  }
  const byMobile = matches.find((m) => m.matchedOn.includes("mobile"));
  if (byMobile && !confirmDuplicateMobile) {
    throw AppError.conflict(`This mobile already belongs to ${describe(byMobile)}`, [
      { path: "mobile", message: `Also used by ${describe(byMobile)}. Confirm to save anyway.` },
    ]);
  }
}

// ---------------------------------------------------------------------------------------------

const list = async (access, query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const where = {
    ...searchWhere,
    deletedAt: null,
    AND: [scopeWhere(access)],
    ...(query.ownerId && { ownerId: query.ownerId }),
  };
  const [data, total] = await prisma.$transaction([
    prisma.customer.findMany({ where, skip, take, orderBy, select: customerListSelect }),
    prisma.customer.count({ where }),
  ]);
  return { data, meta: paginationMeta(query, total) };
};

const getById = async (access, id) => {
  const customer = await findCustomer(access, id);
  const [documents, holds] = await Promise.all([
    prisma.file.findMany({
      where: { entityType: "Customer", entityId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        size: true,
        width: true,
        height: true,
        category: true,
        entityType: true,
        entityId: true,
        version: true,
        uploadedById: true,
        createdAt: true,
      },
    }),
    prisma.plotHold.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        days: true,
        reason: true,
        expiresAt: true,
        createdAt: true,
        plot: { select: { id: true, code: true, project: { select: { id: true, name: true } } } },
      },
    }),
  ]);
  return {
    ...customer,
    photoUrl: customer.photoFileId ? contentUrl(customer.photoFileId) : null,
    documents: documents.map(toFileDto),
    holds,
  };
};

const checkDuplicates = (query) => findDuplicates(query);

const create = async (access, { confirmDuplicateMobile, ownerId, ...data }) => {
  await assertNotDuplicate({ ...data, confirmDuplicateMobile });
  const ownership = await resolveOwnership(access, ownerId);
  const customer = await prisma.$transaction(async (tx) =>
    tx.customer.create({
      data: {
        ...data,
        ...ownership,
        customerCode: await nextCode(tx, CUSTOMER_SEQUENCE),
        createdById: access.actor.userId,
      },
    }),
  );
  return getById(access, customer.id);
};

const update = async (access, id, { confirmDuplicateMobile, ownerId, ...data }) => {
  const current = await findCustomer(access, id, {
    id: true,
    mobile: true,
    nidNumber: true,
    ownerId: true,
  });
  const mobileChanged = data.mobile && data.mobile !== current.mobile;
  const nidChanged = data.nidNumber && data.nidNumber !== current.nidNumber;
  if (mobileChanged || nidChanged) {
    await assertNotDuplicate({
      mobile: mobileChanged ? data.mobile : null,
      nidNumber: nidChanged ? data.nidNumber : null,
      excludeId: id,
      confirmDuplicateMobile,
    });
  }
  const ownership =
    ownerId !== undefined && ownerId !== current.ownerId
      ? await resolveOwnership(access, ownerId)
      : {};
  await prisma.customer.update({
    where: { id },
    data: { ...data, ...ownership, updatedById: access.actor.userId },
  });
  return getById(access, id);
};

const remove = async (access, id) => {
  await findCustomer(access, id, { id: true });
  if (await prisma.plotHold.count({ where: { customerId: id, status: "ACTIVE" } })) {
    throw AppError.conflict("This customer has a plot on hold. Release it first.");
  }
  const live = await prisma.booking.count({
    where: { customerId: id, status: { in: ["PENDING_APPROVAL", "CONFIRMED", "REGISTERED"] } },
  });
  if (live) throw AppError.conflict("This customer has a booking. It can't be deleted.");
  await prisma.customer.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: access.actor.userId },
  });
};

// --- nominees ---------------------------------------------------------------------------------

/** Nominee shares of a customer may not add up to more than 100 %. */
async function assertShares(customerId, sharePercent, exceptId) {
  const others = await prisma.customerNominee.aggregate({
    where: { customerId, ...(exceptId && { id: { not: exceptId } }) },
    _sum: { sharePercent: true },
  });
  const total = Number(others._sum.sharePercent ?? 0) + Number(sharePercent);
  if (total > 100.0001) {
    throw invalid("sharePercent", `Shares would total ${total}% — nominees can share at most 100%`);
  }
}

const findNominee = async (customerId, nomineeId) => {
  const nominee = await prisma.customerNominee.findFirst({ where: { id: nomineeId, customerId } });
  if (!nominee) throw AppError.notFound("Nominee not found");
  return nominee;
};

const addNominee = async (access, id, data) => {
  await findCustomer(access, id, { id: true });
  await assertShares(id, data.sharePercent);
  await prisma.customerNominee.create({ data: { ...data, customerId: id } });
  return getById(access, id);
};

const updateNominee = async (access, id, nomineeId, data) => {
  await findCustomer(access, id, { id: true });
  const nominee = await findNominee(id, nomineeId);
  await assertShares(id, data.sharePercent ?? nominee.sharePercent, nomineeId);
  await prisma.customerNominee.update({ where: { id: nomineeId }, data });
  return getById(access, id);
};

const removeNominee = async (access, id, nomineeId) => {
  await findCustomer(access, id, { id: true });
  await findNominee(id, nomineeId);
  await prisma.customerNominee.delete({ where: { id: nomineeId } });
  return getById(access, id);
};

// --- documents --------------------------------------------------------------------------------

/** Attaches an uploaded file. A PHOTO image also becomes the customer's profile photo. */
const addDocument = async (access, id, { fileId, category }) => {
  await findCustomer(access, id, { id: true });
  const file = await prisma.file.findFirst({ where: { id: fileId, deletedAt: null } });
  if (!file) throw invalid("fileId", "File not found");
  if (file.entityType && !(file.entityType === "Customer" && file.entityId === id)) {
    throw invalid("fileId", "This file belongs to another record");
  }
  if (category === "PHOTO" && !file.mimeType.startsWith("image/")) {
    throw invalid("fileId", "The photo must be an image");
  }
  await prisma.$transaction([
    prisma.file.update({
      where: { id: fileId },
      data: { entityType: "Customer", entityId: id, category },
    }),
    ...(category === "PHOTO"
      ? [
          prisma.customer.update({
            where: { id },
            data: { photoFileId: fileId, updatedById: access.actor.userId },
          }),
        ]
      : []),
  ]);
  return getById(access, id);
};

const removeDocument = async (access, id, fileId) => {
  const customer = await findCustomer(access, id, { id: true, photoFileId: true });
  const file = await prisma.file.findFirst({
    where: { id: fileId, entityType: "Customer", entityId: id, deletedAt: null },
  });
  if (!file) throw AppError.notFound("Document not found");
  await prisma.$transaction([
    prisma.file.update({ where: { id: fileId }, data: { deletedAt: new Date() } }),
    ...(customer.photoFileId === fileId
      ? [prisma.customer.update({ where: { id }, data: { photoFileId: null } })]
      : []),
  ]);
  return getById(access, id);
};

export const CustomerService = {
  list,
  getById,
  checkDuplicates,
  create,
  update,
  remove,
  addNominee,
  updateNominee,
  removeNominee,
  addDocument,
  removeDocument,
};
