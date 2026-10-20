-- A plot can have at most one ACTIVE hold (concurrency guard; Prisma can't express partial indexes)
CREATE UNIQUE INDEX "PlotHold_one_active_per_plot" ON "PlotHold"("plotId") WHERE "status" = 'ACTIVE';

-- Money and area can't be negative
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_price_non_negative" CHECK ("price" >= 0);
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_area_positive" CHECK ("areaSqft" > 0);
ALTER TABLE "PlotHold" ADD CONSTRAINT "PlotHold_days_positive" CHECK ("days" > 0);
