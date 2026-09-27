# Hard delete of a whole Daily Sheet

A Daily Sheet's `date` is its identity (unique, one sheet per date) and nothing could move or remove one, so a Daily Sheet recorded on the wrong date was permanent. The primary Operator is Katte's mother, recording daily on a phone, where a wrong date is an easy slip. We therefore allow a hard delete of the whole Daily Sheet for a date, via an explicit red button and a confirmation modal showing the saved figures being destroyed. It is guarded by the Month Close lock, and its Cost Lines are removed by the existing `cost_lines.daily_sheet_id` `ON DELETE CASCADE` FK. The delete is bound to the record the Operator confirmed: the client sends the saved sheet's `id` and `updated_at`, and the server refuses with a conflict, deleting nothing, if the stored sheet no longer matches inside the deleting transaction. This is the first hard delete of a whole Daily Sheet in the app; individual Cost Lines (`removeCostLine`) and Operating Expenses (`removeOperatingExpense`) were already hard deleted. The "no hard delete of sheet" comments in `src/services/daily-sheet.ts` refer narrowly to Cost Line mutations keeping their parent Daily Sheet alive, which remains true; they are not a rule against this delete, so do not "restore" it. As a consequence an Operator must re-enter the day on the correct date by hand before deleting the wrong one.

## Considered Options

- A move/change-date feature: rejected for now, it adds more surface and conflict cases (the target date may already have a Daily Sheet or be in a closed Month). Re-entry on the correct date is acceptable.
- Making a save with zero revenue and no Cost Lines implicitly delete the Daily Sheet: rejected, silently destructive and undiscoverable.
- Soft delete: rejected, no consumer needs the history and it would complicate every query.

## Known limitation / deferred work

The `updated_at` concurrency token comes from wall-clock milliseconds. Same-millisecond writes, or writes after the clock moves backwards and reuses an earlier timestamp, can reuse `updatedAt`, so a stale delete can slip through and remove a changed Daily Sheet. The `id` guard still catches replacement of the Daily Sheet with a different record.

The controlled-clock conflict test covers ordinary distinct-version rejection, NOT collision safety. Katte explicitly deferred the production fix on 2026-09-28 to a separate reviewed change; this risk remains unfixed. Future acceptance must cover all five mutation paths (`setRevenue`, `addCostLine`, `replaceCostLines`, `updateCostLine`, and `removeCostLine`) with frozen and backwards clocks and concurrent mutations/deletes, proving that stale deletes cannot remove a changed Daily Sheet.
