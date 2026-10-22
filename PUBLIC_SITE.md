# joincovo.app — the public site

The same landing page the MVP serves, with every way in removed. Visitors read
what COVO does and join the waitlist. No sign up, no log in, no dashboard.

**Live now:** https://joincovo.covodeveloper.workers.dev
**Deploy an update:** `npm run deploy:site`

## Two builds, one codebase

```
npm run build          →  dist/           →  Vercel      →  the MVP app
npm run deploy:site    →  dist-landing/   →  Cloudflare  →  joincovo.app
```

Both render `src/pages/Landing.jsx`. The difference is one flag,
`VITE_WAITLIST_ONLY`, set inside `vite.landing.config.js` via `define`. With it
on, every call to action becomes a jump to the waitlist and the nav's
**Log in** / **Get Started** pair becomes a single **Join the waitlist** button.

**A flag, not a second landing page.** Two copies would drift — a change to the
hero copy would have to be made twice and would eventually be made once. The
public site inherits every improvement to the real landing page.

**The flag lives in the config, not an environment variable.** This config
exists only to build the public site, so it is not a choice a caller should be
able to get wrong, and getting it wrong is quiet: the build would succeed and
produce working Log in buttons pointing at `/auth`, a route this bundle does not
contain. Every button would bounce the visitor back to the home page.

### What the public bundle does not contain

`src/landing.jsx` imports the landing page and the three legal pages, nothing
else. The dashboards and admin panels are not merely unreachable — no chunk for
them is emitted, so there is no file on the public domain to find.

Checked after every build:

```bash
npm run build:landing
grep -roc "cov-nav__login\|AdminDashboard\|dashboard/brand" dist-landing/assets/*.js
```

All zero. `signInWithPassword` does appear — that is the Supabase SDK exporting
its own auth methods, the same library the app ships, not COVO code.

## Why Workers and not Cloudflare Pages

Pages has been folded into Workers. `wrangler pages project create` now
delegates to the Workers path and fails outright, offering a `--force` flag to
reach the old Pages API instead. Building on an API that announces itself as
the previous version is borrowing a problem, so this deploys as a Workers
static-assets site — `wrangler.jsonc` at the repository root.

Two things this changed:

- **SPA routing** is `"not_found_handling": "single-page-application"` in
  `wrangler.jsonc`, not a `_redirects` file. Workers static assets *does* read
  Pages-style `_redirects`, and combining the two is rejected by the API:
  *"Infinite loop detected in this rule."* The config setting is the whole fix.
- **`public/_headers` still works.** Workers static assets reads it, so the
  security headers apply. Verified against the live deployment.

There is no Worker script — `wrangler.jsonc` has no `main`, so every request is
served from the asset directory. Adding one later (for a CSP, or an API route)
means pointing `main` at it and adding a `binding` under `assets`.

## The old `covo-agency` project

Connecting the repo to Cloudflare via the dashboard auto-detected Vite at the
repository root, ran `vite build`, and deployed **the entire MVP app** —
dashboards, admin and login screens — to `covo-agency.pages.dev`.

Nothing leaked: it is the same anon key the Vercel app ships and RLS protects
the data identically. But it is not what the public domain should serve, and it
is a second copy of the app to keep in mind. **Delete that project.**

## Attaching joincovo.app

Not done yet, because it points a domain Tumi owns at this deployment and that
should be a deliberate step.

If the zone is on **this** Cloudflare account (`covodeveloper@gmail.com`), add
to `wrangler.jsonc` and run `npm run deploy:site`:

```jsonc
"routes": [
  { "pattern": "joincovo.app", "custom_domain": true }
]
```

If Tumi bought it on **her own** account, the zone is not visible here. Either
move the domain to this account, or add the custom domain from her dashboard:
**Workers & Pages → joincovo → Settings → Domains & Routes → Add custom domain**.

For the app later: `app.joincovo.app` as a `CNAME` to the value Vercel gives
you, with the **orange cloud off** (DNS only). Proxying Cloudflare in front of
Vercel breaks Vercel's certificate issuing and produces a redirect loop — the
most common way this setup fails.

## Checking a signup really landed

```sql
SELECT email, source, created_at
FROM public.waitlist ORDER BY created_at DESC LIMIT 5;
```

`source` is `landing` for signups through this page, since it is the MVP's own
waitlist form. A duplicate address is treated as success, not an error — the
unique index on `LOWER(email)` catches it and the form shows the same
confirmation. Telling someone their second attempt failed would be both
unfriendly and untrue.

The waitlist table grants `INSERT` to `anon` and deliberately grants no
`SELECT`, so a visitor can add their address and nobody can download the list.

## Launch day

The waitlist was promised one email. `supabase/waitlist_launch.sql` keeps it:

```sql
-- Who would be mailed, sending nothing
SELECT * FROM public.enqueue_waitlist_launch_emails();

-- Queue it for real
SELECT * FROM public.enqueue_waitlist_launch_emails(false);
```

It queues into `email_outbox` rather than sending inline, so a run that stops
halfway cannot double-mail anyone. Update the signup URL inside that function to
`https://app.joincovo.app/auth` once that subdomain is live.

### This domain unblocks all of COVO's email

Resend only delivers to the account's own address until a sending domain is
verified, which is why every payout notice and low-balance warning is queuing
up unsent. Add `joincovo.app` under Resend → **Domains**, paste the DKIM/SPF
records into Cloudflare DNS, then set `EMAIL_FROM` on the Supabase Edge
Functions to an address on it. The backlog goes out on the next worker run.

The Resend account is registered to `covodeveloper@gmail.com` — the same
account Cloudflare is authenticated as, which is convenient.

Do this before launch day, not on it.

## Known gaps

- **No bot protection on the waitlist.** The form inserts straight from the
  browser, exactly as the MVP does. If spam becomes a problem, add a Cloudflare
  Turnstile widget — the authenticated token already has
  `challenge-widgets.write` scope.
- **No Content-Security-Policy.** `public/_headers` sets the other security
  headers but leaves CSP out: an untested CSP against a real bundle is a
  reliable way to ship a blank page.
- **Deploys are manual.** `npm run deploy:site` builds and uploads. This is a
  direct-upload Worker, so a push to `main` does not redeploy it. Connecting it
  to Git would need the build command `npm run build:landing` and output
  `dist-landing` configured on the Cloudflare side.
