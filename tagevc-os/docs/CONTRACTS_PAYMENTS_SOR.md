# Contracts & payments — system of record

Three surfaces historically wrote overlapping commercial/payment data. **Ownership:**

| Concern | System of record | Path | Others |
|---------|------------------|------|--------|
| SaaS / vendor commercial terms, seats, renewals, budgets, chargeback | **Vendor Management** | `/shared-services/ops/vendor-management` | A&F + Tech Stack **read** / link |
| Payee, tax (W-9/1099), bills, cash payments | **A&F AP** | `/shared-services/af/accounting/vendors` | VM cross-link suggests counterparts (`VM-{id}`); does not invent tax status |
| Partner integration posture, bindings, adapter readiness | **Technology · Partner stack** | `/shared-services/it/technology-stack` | May record partner contract *metadata* for integrations; **not** the commercial renewal SoR |

## Write rules

1. **Create / edit SaaS renewals & seat economics → Vendor Management only.**
2. **Pay a vendor / collect W-9 / 1099 → A&F AP only.**
3. **Partner stack contract/payment forms** are integration posture + optional mirror of partner commercial terms already owned by VM; prefer write-through to VM when adding new fields.

## Cross-link

`src/lib/af/ap/vm-bridge.ts` builds suggested AP counterparts from active `vm_vendors`. Durable shared IDs and bill-pay merge remain deferred until Josh enables reconciliation.
