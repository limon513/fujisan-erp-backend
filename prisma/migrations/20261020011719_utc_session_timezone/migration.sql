-- The Prisma pg driver adapter formats and parses timestamps as if the session time zone were
-- UTC. A server running in another zone (e.g. Asia/Dhaka) would silently shift every stored
-- instant, so pin the database default to UTC (applies to every new connection, pooled or not).
-- Display in Asia/Dhaka is done by the applications, never by the database session.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END
$$;
