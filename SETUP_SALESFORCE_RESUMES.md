# Salesforce resume sync (Recruit 619)

**Status: scaffold (not live).** Portal vault + parse heuristics ship now. Salesforce upserts stay `not_wired` until a Connected App and env secrets are in place.

## Goal

Keep **Company Shared → Resumes** as the source of truth for recruiting resumes. When a file lands there (Mail “Save to company Resumes” or Files upload), Recruit 619 can sync candidates into Salesforce without depending on a user’s personal OneDrive.

Entity gate: ops entity slug **`recruit-619`** (`ops_entities` / `ops_entity_assignments`). Admins bypass the assignment check.

## Folder layout (Microsoft)

```
Personal OneDrive (each portal user)
└── Tage Portal/
    └── Downloads/              ← Mail/Files “download” destination (not local disk)

Company shared (SharePoint site drive or shared “Company Files”)
└── Company Files/              ← or drive root when MS_COMPANY_* is set
    └── Resumes/                ← recruiting vault (survives offboarding)
```

## Azure / Graph scopes (least privilege)

| Scope | Required for | Notes |
|-------|----------------|-------|
| `Files.ReadWrite` | Personal Downloads | Already in portal defaults |
| `Sites.ReadWrite.All` | Prefer for SharePoint company library create/list/upload | **Admin consent** + user **Reconnect** |
| `Sites.Selected` | Prefer over `Sites.ReadWrite.All` when available | Grant only the Company Files site — request this if your tenant supports it |
| `Sites.Read.All` | Read-only browse of site libs | Not enough to ensure/create Resumes |

Alternative without Sites scopes: share a OneDrive/SharePoint folder named **Company Files** with every portal user (`sharedWithMe` discovery). Then `Files.ReadWrite` can write under that shared folder.

### Edge secrets (optional company vault)

```bash
# Prefer SharePoint site path (needs Sites.ReadWrite.All on the token).
# Tage tenant root site (no vanity SharePoint domain yet):
MS_COMPANY_SITE_PATH="netorgft15674001.sharepoint.com"
# Or a dedicated sub-site once created:
# MS_COMPANY_SITE_PATH="netorgft15674001.sharepoint.com:/sites/CompanyFiles"
# Optional: nest a "Company Files" folder under the site drive root
MS_COMPANY_CREATE_NESTED=1

# Or pin drive + root item ids (no site lookup):
# MS_COMPANY_DRIVE_ID="b!..."
# MS_COMPANY_ROOT_ITEM_ID="01..."
```

Also add `Sites.ReadWrite.All` to `MS_GRAPH_SCOPES` (keep every existing scope) and **Reconnect**.

## Salesforce Connected App (to go live)

1. In Salesforce Setup → App Manager → **New Connected App** (Enable OAuth).
2. Callback URL: use CLI / JWT or refresh-token flow (document your choice).
3. Scopes: `api`, `refresh_token`, `offline_access` (classic Connected App OAuth scopes).
4. Prefer **JWT bearer** (certificate) or **refresh token** for headless edge sync — avoid storing end-user passwords in production.

### Edge secrets (not wired until API client lands)

```bash
SF_CLIENT_ID=
SF_CLIENT_SECRET=
SF_REFRESH_TOKEN=          # preferred
# or username-password (dev only):
# SF_USERNAME=
# SF_PASSWORD=             # include security token if required
SF_LOGIN_URL=https://login.salesforce.com   # or test.salesforce.com
SF_CANDIDATE_OBJECT=Contact                 # or custom Candidate__c
SF_EMAIL_FIELD=Email
SF_PHONE_FIELD=Phone
SF_NAME_FIELD=Name
```

Duplicate key heuristic (planned live upsert order): **email → phone → name**. Configurable via field env vars above.

Object assumption: default **`Contact`**. For Recruit 619 you may use a custom Candidate object — set `SF_CANDIDATE_OBJECT`.

## Resume parsing honesty

v1 extractors only:

- **PDF:** weak string-literal scrape (no full PDF text stack)
- **DOCX:** contact-like tokens from raw bytes (no ZIP/XML full parse yet)
- **Scanned / image PDFs:** **`needs_ocr: true`** — needs OCR or AI later; do not trust as complete profiles

When OCR/AI is added, store derived text in `sf_resume_sync_items` and re-run sync.

## Edge function

`salesforce-resume-sync` (JWT required):

| Action | Behavior |
|--------|----------|
| `status` | `live: false`, whether SF secrets exist, Recruit 619 gate |
| `parse` | Dry extract for one drive item |
| `sync` | List Company Resumes (≤25), extract contacts, stub SF upsert, write `sf_resume_sync_items` |

Frontend Files has a **Salesforce** button → `microsoft-files` action `salesforce_copy_stub` (documents not wired).

Deploy:

```bash
supabase functions deploy salesforce-resume-sync
supabase db push   # or apply migration 0018_sf_resume_sync.sql
```

## Portal UX

- Mail attachment → **Save to Downloads** / **Save to company Resumes** (resume-like names default to company when company vault is available)
- Files → tabs: **Downloads**, **Company Shared**, My files, Shared with me
- No normal local browser download path

## Checklist to go live

1. [ ] SharePoint Company Files site (or shared folder) + scopes consented + Reconnect
2. [ ] Confirm Resumes folder appears for Recruit 619 users
3. [ ] Create Salesforce Connected App + set SF_* secrets
4. [ ] Implement REST/jsforce upsert in `salesforce-resume-sync` (replace `not_wired` branch)
5. [ ] Decide Contact vs custom object + field mapping
6. [ ] Optional: OCR/AI for scanned resumes
7. [ ] Schedule cron or manual Sync from admin UI
