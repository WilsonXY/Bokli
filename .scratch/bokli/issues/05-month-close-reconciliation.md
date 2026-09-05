# 05: Month Close plus Reconciliation

**What to build:** Explicit Month Close that snapshots and locks the month with Admin-only reopen, plus warn-only Reconciliation of cash on hand plus TnG on hand against Net Profit with history.

**Blocked by:** 04-operating-expense-live-preview.

**Status:** ready-for-agent

- [ ] Operator taps Close to snapshot revenue, costs, gross, operating, net and lock edits until Admin reopens with reason
- [ ] Close screen accepts cash on hand plus TnG on hand, warns only on mismatch versus Net Profit and requires a note
- [ ] Past close snapshots with diff and note remain viewable per month
