import prisma from "#core/db/prisma.js";

/**
 * Next number of a document sequence, atomically (INSERT … ON CONFLICT … RETURNING).
 * Pass the transaction client so a rolled-back document doesn't consume a number (gap-free).
 *
 *   const code = await nextCode(tx, { key: "EMPLOYEE", prefix: "EMP-", padding: 4 }); // "EMP-0001"
 *
 * @returns {Promise<number>}
 */
export async function nextValue(client = prisma, { key, prefix = "", padding = 6 }) {
  const [row] = await client.$queryRaw`
    INSERT INTO "Sequence" ("key", "prefix", "nextValue", "padding", "updatedAt")
    VALUES (${key}, ${prefix}, 2, ${padding}, now())
    ON CONFLICT ("key") DO UPDATE
      SET "nextValue" = "Sequence"."nextValue" + 1, "updatedAt" = now()
    RETURNING "nextValue" - 1 AS value`;
  return Number(row.value);
}

export async function nextCode(client, options) {
  const value = await nextValue(client, options);
  return `${options.prefix ?? ""}${String(value).padStart(options.padding ?? 6, "0")}`;
}
