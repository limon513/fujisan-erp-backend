-- A line is a debit or a credit, never both, never zero
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_one_side" CHECK (
  ("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)
);

ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_dates" CHECK ("endDate" > "startDate");

-- Every entry balances (debits = credits) with at least two lines. Checked at commit, so an
-- entry and its lines can be written in any order inside one transaction.
CREATE OR REPLACE FUNCTION journal_entry_balanced() RETURNS trigger AS $$
DECLARE
  entry uuid := COALESCE(NEW."entryId", OLD."entryId");
  dr numeric;
  cr numeric;
  n integer;
BEGIN
  SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0), COUNT(*)
    INTO dr, cr, n FROM "JournalLine" WHERE "entryId" = entry;
  IF EXISTS (SELECT 1 FROM "JournalEntry" WHERE id = entry) AND (n < 2 OR dr <> cr) THEN
    RAISE EXCEPTION 'Journal entry % is not balanced (debit %, credit %, % lines)', entry, dr, cr, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "JournalLine_balanced"
  AFTER INSERT OR UPDATE OR DELETE ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

-- Posted entries are history: lines can't be changed or removed (only whole-entry reversal)
CREATE OR REPLACE FUNCTION journal_line_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Journal lines cannot be changed; reverse the entry instead'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalLine_immutable"
  BEFORE UPDATE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION journal_line_immutable();
