# Client decisions

Answers from Fujisan to the open questions, with what each one means for the build. Newest first.

## 2026-10-26: commission, accounting, transfers, refunds, channels

| Topic | Decision | Effect on the ERP |
|---|---|---|
| Sales commission | None for now. | 3.9 set aside. Records already keep who did what (booking owner, collector, verifier), so it can be added later. |
| Installment interest (B2) | Recognise interest **as each installment is paid**. | Change postings: the interest share of each verified payment goes to Interest income; registration recognises only the net price. |
| Land cost (B3) | Track land cost **per project**. | Project cost (land, development, registration …) → cost of sales per plot at registration (by area share), so gross profit shows. |
| Fiscal year (B4) | Any start month (e.g. July–June or January–December). | Already a company setting (fiscal year start month). |
| Bank accounts (B5) | Real bank accounts with their details; bKash / Nagad etc. as they are. | Bank details (bank, branch, account name / number, routing) on bank-type accounts. |
| Opening balances (B6) | Decide after go-live. | Nothing now. |
| VAT / tax (B7) | Out of scope for now. | No VAT / TDS handling. |
| Transfer fee payer (C1) | The new owner. | As built. |
| Transfer with overdue dues (C2) | Allowed, as built. | Overdue moves with the booking. |
| Transfer fee (C3) | Dynamic. | As built: plan fee (fixed or %) and the approver may change it. |
| Transfer documents (C4) | A transfer agreement document for now; more later. | Upload the transfer agreement on the request; required before approval. |
| Transfer limits (C5) | No limit. | As built. |
| Refund schedule (D1) | Yes. | Approved refunds can be paid in several parts on a schedule. |
| Late fees on cancellation (D2) | Late fees already paid are not refunded. | As built. |
| Refund holding period (D3) | Undecided. | Later. |
| 2FA (E2) | In the plan, later. | Roadmap 1.11 stays open. |
| SMS (E3) | BulkSMS BD planned; no account yet. | Build the SMS channel with a pluggable provider; switch on when they have the account. |
