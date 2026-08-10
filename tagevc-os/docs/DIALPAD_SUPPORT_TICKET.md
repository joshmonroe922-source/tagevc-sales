# Dialpad Support — allowlist subsidiary login domains

**Status: filed 2026-08-10** by Josh, via Admin → *Contact us* → *Submit a
request* → category *Account changes* → issue type **Adding a secondary
domain**, priority *Non-Critical business impact*. Reply goes to
`joshmonroe@tagevc.com`. Awaiting Dialpad.

This file keeps the full ask in one place for the follow-up — live chat or
(855) 735-2644 are the faster channels if the ticket stalls — and as the
template for the identical request we will need for Signent HR and Instant NDA.
Background: `docs/DIALPAD_MULTI_ENTITY.md`.

**Not automatable.** Dialpad's public API has no support/ticketing endpoint
(verified 2026-08-10 — `GET /api/v2/support`, `/support/tickets`, `/tickets`,
`/cases`, `/help` all return **404**; `/company/support` returns **403 "This API
is for internal use only."`). Re-check with
`node scripts/dialpad-golive/09-leftovers-probe.mjs`.

**When Dialpad confirms:** change each user's Dialpad email to their real
subsidiary address, drop the `@tagevc.com` alias workaround, and re-test "Sign in
with Microsoft" — it needs the Dialpad email to equal the Entra UPN.

---

## The ask

```text
Subject: Add recruit619.com, signenthr.com and instantnda.us as verified login domains

Company: Tage Venture Capital
Company ID: 5390437239431168
Plan: Dialpad Sell Premium
Requester: Josh Monroe (Super Admin) — joshmonroe@tagevc.com

WHAT I NEED
Please allowlist these three domains as accepted login/user-email domains on our
company, alongside our existing verified domain tagevc.com:

  - recruit619.com   (urgent — blocking a live agent today)
  - signenthr.com
  - instantnda.us

WHY
We run one Dialpad company with each subsidiary as its own Dialpad office:

  Tage Venture Capital  office 5312888585003008  +16193590371
  Recruit 619           office 5109894981558272  +12094545611
  Signent HR            office 4968987070242816  +12095090641
  Instant NDA           office 5633477826781184  +12073475325

Each subsidiary has its own Microsoft 365 domain, and every employee's real work
address and Entra ID UPN is on that subsidiary domain, not on tagevc.com.

WHAT IS BLOCKED TODAY
Creating or updating a Dialpad user with a subsidiary address is rejected:

  - POST /api/v2/users with emails ["dennismccall@recruit619.com"]
      -> "User domain does not match" / blacklisted domains
  - PATCH /api/v2/users/5690823254417408 with emails ["dennismccall@recruit619.com"]
      -> "Cannot set primary_email ... if it does not match the user's domain
          (tagevc.com)"

There is no self-serve way to add a second verified domain in Admin Settings.

CURRENT WORKAROUND (what I want to retire)
Our Recruit 619 VP of Recruiting, Dennis McCall, has Dialpad user id
5690823254417408 in the Recruit 619 office on +16194784390. His real mailbox is
dennismccall@recruit619.com. To get him a Dialpad login at all, we had to add
dennismccall@tagevc.com as an alias on his Microsoft 365 mailbox and use that
alias as his Dialpad email.

That alias is mail-routing only — it is not a Microsoft sign-in identity — so
"Sign in with Microsoft" cannot work for him in either direction:

  - as dennismccall@recruit619.com: Microsoft authenticates, but no Dialpad user
    carries that address
  - as dennismccall@tagevc.com: Microsoft rejects it, because it is only a
    proxyAddresses entry and not a UPN

So he is stuck on Dialpad email + password while every other tool in our stack is
Microsoft SSO. This repeats for every Signent HR and Instant NDA agent we onboard.

QUESTIONS
1. Can you allowlist the three domains above on company 5390437239431168?
2. Is domain verification required (DNS TXT, etc.)? We control DNS for all three
   and can add whatever record you need.
3. Once allowlisted, can we set each user's primary email to their subsidiary
   address via PATCH /api/v2/users/{id}, or does that also need to be done by
   Support?
4. Will Microsoft SSO then work for those users, given every subsidiary domain
   lives in the same Entra tenant?

Thanks,
Josh Monroe
```
