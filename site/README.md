# COVO — the public site

The marketing page on Tumi's Cloudflare domain. Explains what COVO is and
collects waitlist signups. No sign-up, no login, no dashboard.

## How the two deployments fit together

```
                    ┌──────────────────────────────┐
  covo.africa  ───▶ │  Cloudflare Pages            │
  (apex, Tumi's)    │  site/ — this folder         │
                    │  static page + /api/waitlist │
                    └──────────────┬───────────────┘
                                   │  POST, server-side
                                   ▼
                    ┌──────────────────────────────┐
                    │  Supabase (unchanged)        │
                    │  public.waitlist             │
                    └──────────────▲───────────────┘
                                   │
  app.covo.africa ─▶ ┌─────────────┴───────────────┐
  (or the vercel url)│  Vercel — the MVP app       │
                     │  the React app in src/      │
                     └─────────────────────────────┘
```

One database, two front doors. Nothing about the Vercel app changes.

## Why this is a plain HTML file and not a React build

The page is one screen of copy and one form. Bringing in React and
`@supabase/supabase-js` would ship about 400 KB gzipped to render a text input,
and the app's own bundle is already 211 KB of Supabase client alone.

There is also no build step at all, which is the bigger win: Cloudflare serves
the folder as-is, so there is no build config to drift, no `node_modules`, and
no path by which dashboard or admin code could end up on the marketing domain.
It loads immediately on a phone on mobile data, which is what a marketing page
has to do.

## Deploying it

Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
**Connect to Git**, pick this repository, then:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | **None** |
| Build command | *leave empty* |
| Build output directory | *leave empty* |
| **Root directory** (under *Advanced*) | **`site`** |

The empty build command is correct — there is nothing to build.

**Root directory must be `site`.** Cloudflare resolves `functions/` relative to
the root directory, not relative to the build output directory. Point the root
at the repository instead and `site/functions/api/waitlist.js` is never
compiled: the static page deploys fine, `/api/waitlist` returns the 404 page,
and every signup fails with "something went wrong" while the page itself looks
perfectly healthy.

Setting the root to `site` also makes this folder the whole project as far as
Cloudflare is concerned — `index.html`, `_headers` and `functions/` all sit at
its top level, which is the layout Pages expects.

### Verifying the Function actually deployed

After the first deploy, the project's **Functions** tab (or **Deployments** →
the deployment → **Functions**) should list one route: `/api/waitlist`. If that
list is empty, the root directory is wrong — fix it and redeploy rather than
debugging the page.

A faster check from a terminal, which must return `405`, not `404`:

```bash
curl -i -X GET https://<your-pages-subdomain>.pages.dev/api/waitlist
```

`405 Method Not Allowed` means the Function is live and rejecting GET, which it
should. `404` means it was never compiled.

### Environment variables

Settings → **Environment variables** → add to **Production** (and Preview, if
you use preview deployments):

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://nyeulzucksldwlcrbbmo.supabase.co` |
| `SUPABASE_ANON_KEY` | the project's anon / publishable key |

Both are read by `functions/api/waitlist.js` at request time. Nothing is baked
into the page, so the key is never committed to this repository.

**Never put the `service_role` key here.** It is not needed and it would turn a
public endpoint into full database access. The anon key can insert one waitlist
row and nothing else — `public.waitlist` grants `INSERT` to `anon` and
deliberately grants no `SELECT`, so even this endpoint cannot read the list
back.

### DNS

With the domain's nameservers already at Cloudflare:

- **Apex** (`covo.africa`) — Pages adds this for you under the project's
  **Custom domains** tab. Use that tab rather than writing the record by hand.
- **App** (`app.covo.africa` → Vercel) — add a `CNAME` to the value Vercel
  gives you in its own Domains tab, and **turn the orange cloud off** (DNS only).
  Leaving Cloudflare's proxy on in front of Vercel breaks Vercel's certificate
  issuing and gives you a redirect loop. This is the single most common way
  this setup fails.

## Checking that a signup really landed

The waitlist has no public read policy, so you cannot check it from a browser
as a visitor. In the Supabase SQL editor:

```sql
SELECT * FROM public.waitlist_summary();

SELECT email, source, created_at
FROM public.waitlist ORDER BY created_at DESC LIMIT 20;
```

`source` is `site:creator` or `site:brand` depending on which toggle they
chose, and `landing` for anyone who signed up through the old Vercel landing
page. That is what lets you segment the list later without guessing.

A duplicate signup answers **200**, not an error: the unique index on
`LOWER(email)` catches it and the page says "you're already on the list".
Telling someone their second attempt failed would be both unfriendly and untrue.

## Launch day

The page promises "one email when we launch. Nothing else." That is kept by
`supabase/waitlist_launch.sql`:

```sql
-- See who would be mailed, without sending anything
SELECT * FROM public.enqueue_waitlist_launch_emails();

-- Actually queue it
SELECT * FROM public.enqueue_waitlist_launch_emails(false);
```

It queues into `email_outbox` rather than sending directly, so a run that
stops halfway cannot double-mail anyone — the unique index on
`(kind, subject_id)` refuses a second message per waitlist row. The
`process-email-outbox` function drains the queue.

Brands and creators get a different opening line, because they told you which
they were when they signed up.

### This domain finally unblocks email

COVO's email has been stuck: Resend's free tier only delivers to the account's
own address until a sending domain is verified, so every payout notice and
low-balance warning is queuing up unsent.

A domain Tumi controls at Cloudflare fixes that. In Resend → **Domains**, add
`covo.africa`, and Resend gives you the DKIM/SPF records to paste into
Cloudflare DNS. Once it verifies, set `EMAIL_FROM` on the Supabase Edge
Functions to something on that domain (`COVO <hello@covo.africa>`) and the
whole backlog goes out on the next worker run.

Worth doing before launch day rather than on it.

## Editing the copy

It is one file — `index.html` — with the styles and the script inline. The
palette at the top of the `<style>` block is copied from the app's
`src/index.css` so the two look like the same company; if the brand colours
change, change them in both.

The footer's contact address is `hello@covo.africa`. Point that at a real
inbox before the site goes live, or remove it.
