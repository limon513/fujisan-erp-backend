import { z } from "zod";

export const MAX_PAGE_SIZE = 100;

/**
 * Zod schema for list endpoints: ?page&limit&search&sortBy&sortOrder (+ module filters).
 *
 * @param {object} options
 * @param {string[]} options.sortable  fields allowed in sortBy (first one is the default)
 * @param {object} [options.filters]   extra zod fields for module-specific filters
 */
export function listQuerySchema({ sortable, filters = {} }) {
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
    search: z.string().trim().min(1).optional(),
    sortBy: z.enum(sortable).default(sortable[0]),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    ...filters,
  });
}

/**
 * Turns a parsed list query into Prisma findMany args.
 *
 * @param {object} query           output of listQuerySchema
 * @param {string[]} searchable    string fields searched case-insensitively with `search`
 * @returns {{ skip, take, orderBy, searchWhere }}
 */
export function buildListArgs(query, searchable = []) {
  const { page, limit, search, sortBy, sortOrder } = query;
  const searchWhere =
    search && searchable.length
      ? { OR: searchable.map((field) => ({ [field]: { contains: search, mode: "insensitive" } })) }
      : {};

  return {
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { [sortBy]: sortOrder },
    searchWhere,
  };
}

export const paginationMeta = ({ page, limit }, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});
