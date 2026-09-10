# MYR-only minor-unit money with Money value object

All amounts are food-stall MYR with no FX need, so we will store `amountSen INTEGER NOT NULL` (sen minor units, 64-bit int, no floats) with app-wide MYR and a TypeScript Money wrapper formatting only at display, instead of per-row currency codes and exponent tables.
