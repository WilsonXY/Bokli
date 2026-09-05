# Bokli

Web-based bookkeeping for a family food stall to replace the paper book and show business health.

## Language

**Daily Sheet**:
Record for one business day holding that day's revenues and daily costs.
_Avoid_: daily entry, day book, transaction

**Cash Revenue**:
Total cash received on a Daily Sheet date.
_Avoid_: cash sales, cash income

**TnG Revenue**:
Total Touch n Go e-wallet received on a Daily Sheet date.
_Avoid_: TNG, e-wallet revenue, online revenue

**Daily Cost**:
Cost consumed to operate that day, e.g. restocking, cooking gas.
_Avoid_: daily expense, variable cost

**Cost Line**:
One item inside a Daily Cost with amount, category and optional note.
_Avoid_: cost entry, expense line

**Operating Expense**:
Fixed cost for a whole month, e.g. rental, utilities, wages.
_Avoid_: monthly cost, overhead, fixed cost

**Gross Profit**:
Total revenue minus total Daily Costs for a month.
_Avoid_: operating profit

**Net Profit**:
Gross Profit minus Operating Expenses for a month.
_Avoid_: bottom line, final profit

**Reconciliation**:
Check that cash on hand plus TnG on hand equals Net Profit, warn-only on mismatch.
_Avoid_: balancing, closing check

**Month Close**:
Explicit lock of a month's snapshot after review, blocking further edits until reopened.
_Avoid_: month end, closing, freeze

**Cost Category**:
Fixed label for a Cost Line, e.g. restock, gas, transport, other.
_Avoid_: expense type, cost tag

**Operator**:
Family member who records daily, primarily mom.
_Avoid_: user, bookkeeper
