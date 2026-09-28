# Hard delete of a whole Daily Sheet

A Daily Sheet's `date` is its identity (unique, one sheet per date) and nothing could move or remove one, so a Daily Sheet recorded on the wrong date was permanent. The primary Operator is Katte's mother, recording daily on a phone, where a wrong date is an easy slip. We therefore allow a hard delete of the whole Daily Sheet for a date, via an explicit red button and a confirmation modal showing the saved figures being destroyed. It is guarded by the Month Close lock, and its Cost Lines are removed by the existing `cost_lines.daily_sheet_id` `ON DELETE CASCADE` FK. The delete is bound to the record the Operator confirmed: the client sends the saved sheet's `id` and `updated_at`, and the server refuses with a conflict, deleting nothing, if the stored sheet no longer matches inside the deleting transaction. This is the first hard delete of a whole Daily Sheet in the app; individual Cost Lines (`removeCostLine`) and Operating Expenses (`removeOperatingExpense`) were already hard deleted. The "no hard delete of sheet" comments in `src/services/daily-sheet.ts` refer narrowly to Cost Line mutations keeping their parent Daily Sheet alive, which remains true; they are not a rule against this delete, so do not "restore" it. As a consequence an Operator must re-enter the day on the correct date by hand before deleting the wrong one.

## Considered Options

- A move/change-date feature: rejected for now, it adds more surface and conflict cases (the target date may already have a Daily Sheet or be in a closed Month). Re-entry on the correct date is acceptable.
- Making a save with zero revenue and no Cost Lines implicitly delete the Daily Sheet: rejected, silently destructive and undiscoverable.
- Soft delete: rejected, no consumer needs the history and it would complicate every query.

## `updated_at` token resolution (fixed 2026-09-28)

**Problem.** `updated_at` was written as `new Date().toISOString()`, which has millisecond resolution. Two writes in the same millisecond stored an identical string, and a write after the clock stepped backwards could store an earlier or already-used one. The stale-snapshot check then saw "unchanged" and let a stale delete remove a changed Daily Sheet. It reproduced on the real clock: the "409 sheetChanged" route test failed about 2 runs in 5. The root cause was resolution, not concurrency. Writes were already serialized inside transactions, so locking would not have helped, because the stored value itself did not change. The `id` guard was never affected.

**Fix.** `updated_at` is now strictly monotonic. Every write of `daily_sheets.updated_at` goes through one helper, `nextSheetUpdatedAt()` in `src/services/daily-sheet.ts`, which is used by `setRevenue` and by `touchSheetUpdatedAt` (all four Cost Line operations). The helper stores the later of the current clock and the stored value plus 1 ms. SQLite computes it inside the same `UPDATE` statement from the existing column value, so there is no read-then-write in JS:

```sql
max(:now, coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds'), :now))
```

`:now` is the JS clock (`toISOString()`), and the result has the same `YYYY-MM-DDTHH:MM:SS.mmmZ` shape. The stored value is normalized through `strftime` before the comparison because rows created via the schema default (`CURRENT_TIMESTAMP`, `YYYY-MM-DD HH:MM:SS`) sort before ISO strings of an earlier time as raw text (space < `T`). New Daily Sheets still get that legacy shape on insert and switch to ISO on their first write. An unparseable stored value falls back to the clock. `setRevenue` still returns the updated row, including the new value, via `RETURNING`.

**Accepted trade-off (Katte, 2026-09-28).** The stored value is "clock time, or a millisecond later", so it is no longer strictly the real clock time. This difference is invisible to a person. After a backwards clock step, it stays ahead of the clock, advancing 1 ms per write, until the clock catches up.

**Why not a version column.** An integer version column is the textbook fix. It was not chosen because it needs a schema migration against the live production database, which holds real business records. For a single-Operator app, that risk was judged lopsided against the benefit. If a schema migration happens for another reason later, adding a version column becomes near-free and is the better long-term design.

## Remaining limitations

The guarantee is tested for all five mutation paths (`setRevenue`, `addCostLine`, `updateCostLine`, `removeCostLine`, `replaceCostLines`): same-millisecond writes on a frozen clock, a backwards clock, and a legacy `CURRENT_TIMESTAMP` value. The delete-conflict tests run on the real clock. No test drives truly concurrent writers on separate connections or processes against a delete. That case relies on SQLite serializing writers and on `deleteSheet` comparing and deleting inside one transaction; it is argued, not tested.
