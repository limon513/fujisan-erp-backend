import config from "#config/index.js";
import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";

const companySelect = {
  id: true,
  name: true,
  legalName: true,
  logoFileId: true,
  address: true,
  phone: true,
  email: true,
  website: true,
  tin: true,
  bin: true,
  currency: true,
  timezone: true,
  fiscalYearStartMonth: true,
  updatedAt: true,
};

const getCompany = async () => {
  const company = await prisma.company.findUnique({
    where: { singleton: true },
    select: companySelect,
  });
  if (!company) throw AppError.notFound("Company profile not set up — run the seed");
  return company;
};

const updateCompany = async (actor, data) => {
  await getCompany();
  await prisma.company.update({
    where: { singleton: true },
    data: { ...data, updatedById: actor.userId },
  });
  return getCompany();
};

/** Public branding for the sign-in page (no secrets, no auth). */
const branding = async () => {
  const company = await prisma.company.findUnique({
    where: { singleton: true },
    select: { name: true, logoFileId: true },
  });
  return {
    appName: config.appName,
    companyName: company?.name ?? null,
    logoFileId: company?.logoFileId ?? null,
  };
};

export const SettingService = { getCompany, updateCompany, branding };
