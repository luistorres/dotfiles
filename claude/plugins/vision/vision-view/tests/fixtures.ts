export const SINGLE = `---
Status: in_progress
Shape: single
Risk: standard
Branch: lt/export-csv
Autonomy: granted 2026-01-05. Waived: plan approval.
---
# Export invoices as CSV

## Acceptance criteria
- [x] The export button downloads every visible invoice.
- [ ] Amounts are written in cents.

## Steps
- [x] frame · [x] build · [ ] review · [ ] fix · [ ] verify · [ ] ship

## Log
- 2026-01-05 framed: standard; design settled
- 2026-01-05 built: 4 files, tests green
`

export const STACK_START = `---
Status: in_progress
Shape: stack
Risk: standard
Current: 0/2
---
# Reporting adapters for the ledger service

Two adapters behind one interface.

## [ ] Task 1: balance queries and limit checks
- [x] build · [ ] review · [ ] fix · [ ] verify · [ ] pr
- **Branch:** lt/ledger-balances
- **Base:** origin/main
- **Risk:** standard
- **PR:**

### Acceptance criteria
- [ ] Balance queries return integer cents.
- [ ] A limit check refuses an unknown account.

## [ ] Task 2: payment reissue
- [ ] build · [ ] review · [ ] fix · [ ] verify · [ ] drift · [ ] pr
- **Branch:** lt/ledger-reissue
- **Base:** lt/ledger-balances

### Acceptance criteria
- [ ] A reissue keeps the original reference.

## Log
- 2026-01-05 framed: 2 tasks, standard risk
- 2026-01-05 task 1 built
`

export const STACK_LATER = `---
Status: in_progress
Shape: stack
Risk: standard
Current: 1/2
---
# Reporting adapters for the ledger service

## [x] Task 1: balance queries and limit checks
- [x] build · [x] review · [x] fix · [x] verify · [x] pr
- **Branch:** lt/ledger-balances
- **PR:** https://github.com/example-org/ledger/pull/62

### Acceptance criteria
- [x] Balance queries return integer cents.
- [x] A limit check refuses an unknown account.

## [ ] Task 2 — payment reissue
- [x] build · [ ] review · [ ] fix · [ ] verify · [ ] drift · [ ] pr
- **Branch:** lt/ledger-reissue

### Acceptance criteria
- [ ] A reissue keeps the original reference.

## Log
- 2026-01-05 framed: 2 tasks, standard risk
- 2026-01-05 task 1 PR opened: https://github.com/example-org/ledger/pull/62
- 2026-01-06 task 2 built
`

export const ISSUES = `---
Status: in_progress
Shape: issues
Tracker: local
---
# Onboarding checklist

## Issues
- [x] 1. Invite flow · #10 · depends on: none
- [ ] 2. Welcome email · #11 · depends on: 1

## Log
- 2026-01-05 filed 2 issues
`
