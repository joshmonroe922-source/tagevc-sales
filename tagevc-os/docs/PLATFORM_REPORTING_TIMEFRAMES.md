# Platform reporting timeframes

General tool from My Recruiting Desk (day / week / month chips, timezone-aware) — now a platform primitive for Tage + all subsidiaries.

## Module

`src/lib/platform/reporting-timeframes.ts`

```ts
import {
  reportingWindow,
  parseReportingPeriodParam,
  DEFAULT_REPORTING_PERIODS,
} from '@/lib/platform/reporting-timeframes';

const period = parseReportingPeriodParam(searchParams.get('period'));
const win = reportingWindow(period, viewerTz);
// filter metrics with isIsoInReportingWindow(iso, win)
```

## Defaults

| Period | Label | Start |
|--------|-------|-------|
| day | Today | Local midnight |
| week | This week | Local Monday 00:00 |
| month | This month | 1st of month local |
| quarter | This quarter | Quarter start local |
| ytd | YTD | Jan 1 local |

Default timezone: `America/New_York` (desk historically used `America/Los_Angeles` for recruiter KPIs — pass user/mailbox TZ when available).

## Scaffold checklist (Instant NDA / Signent / future)

1. Copy `src/lib/platform/reporting-timeframes.ts` (+ tests)
2. Add `ReportingPeriodChips` (or link `?period=`) on reports / dashboard / scoreboards
3. Never hard-code rolling “last 30 days” without also offering period chips

## This pass

- Module + vitest in tagevc-os
- Wired on R619 `/reports` and `/me/performance`
- Period chips component under `src/components/platform/`
