import prisma from "#core/db/prisma.js";

const getStatus = async () => {
  let database = "up";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "down";
  }

  return {
    status: database === "up" ? "ok" : "degraded",
    database,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
};

export const HealthService = { getStatus };
