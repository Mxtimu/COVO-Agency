# COVO — database

Every file here is idempotent: safe to run repeatedly, and safe to run
against the live project. There are no migration timestamps, so **order is
carried by this file** — run them top to bottom in the SQL Editor.

`schema_part2.sql` used to sit alongside `schema_full.sql`, declaring the same
six tables with `CREATE TABLE IF NOT EXISTS`. Whichever ran first silently won
and the other became a no-op, which is how `commissions` ended up without the
`external_order_id` constraint on some runs. It contained nothing
`schema_full.sql` does not, so it was deleted — recover it with
`git show 9d5d6e5:supabase/schema_part2.sql` if you ever need to look.

## Run order

| # | File | What it does |
|---|---|---|
| 1 | `schema_full.sql` | Tables, the signup trigger, base RLS |
| 2 | `creator_profile_columns.sql` | Columns onboarding writes; verifies none are missing |
| 3 | `admin_access.sql` | `is_admin()` and the admin read policies |
| 4 | `campaign_applications.sql` | Creator→campaign applications |
| 5 | `escrow_functions.sql` | Escrow balance RPCs; renames `short_code`→`slug` |
| 6 | `conversion_tracking.sql` | Order reference + the replay constraint |
| 7 | `covo_score.sql` | Score calculation, trigger, nightly job |
| 7b | `covo_score_breakdown.sql` | Splits the score into its components; must follow 7 |
| 8 | `creator_payouts.sql` | `request_creator_payout()` |
| 9 | `waitlist.sql` | Landing-page waitlist |
| 10 | **`security_hardening.sql`** | **Privilege guards — see below** |
| 11 | `escrow_release.sql` | Held-commission release, solvent confirmation, cron |
| 12 | `shopify_integration.sql` | Shop registry, conversion write, refunds |
| 13 | `product_lifecycle.sql` | Product archiving; refuses deletes that would orphan links |
| 14 | `click_deduplication.sql` | Counts a click once per visitor; drops the dead `clicks` column |
| 15 | `paystack_atomic.sql` | Deposit and payout settlement as one transaction each |
| 16 | `paystack_test_mode.sql` | Tracks test-mode money; adds the pre-go-live purge |
| 17 | `paystack_payouts.sql` | Payout recipients and transfer claiming; drops `bank_account_number` |
| — | `verify_checks.sql` | **Run this after any change.** Every check as one result set. |
| — | `verify_hardening.sql` | Runtime proof the guards reject a browser write. Rolls itself back. |
| — | `test_money_paths.sql` | 44 assertions over the plpgsql that moves money. Rolls itself back. |

Steps 10–12 depend on 1–9. Within 1–9 the order matters only where a file
references a function another creates (`is_admin`, `handle_updated_at`).

## Why `security_hardening.sql` exists

RLS is row-level only. A policy of `USING (auth.uid() = id)` says *which rows*
you may write, never *which columns* — and Supabase grants `UPDATE` on public
tables to the `authenticated` role by default. So every "update your own row"
policy in `schema_full.sql` handed the owner write access to every column of
that row, including the ones deciding what they were allowed to do:

```js
// this worked, from any signed-in creator's browser console
await supabase.from('profiles').update({ role: 'admin' }).eq('id', myUserId)
```

`profiles_role_check` permits `'admin'`, so the row saved and every
`"admins manage X" FOR ALL` policy opened at once. The same shape let a creator
write their own `covo_score` and a brand publish its own campaign without
review or escrow.

The fix is a `BEFORE UPDATE` guard per table rejecting changes to the
privileged columns unless `is_admin()`.

**The guards must stay `SECURITY INVOKER`.** A `SECURITY DEFINER` trigger runs
as its own owner, so `current_user` reads `postgres` on *every* write including
a browser's, `is_direct_client_write()` returns false, and every guard waves
everything through while still looking correct in the schema. That is a
silent, total failure — which is what `verify_hardening.sql` is for. Run it
after any change to these files.

## Scheduled jobs

Two `pg_cron` jobs, both installed by the files above:

| Job | Schedule | Function |
|---|---|---|
| `covo-confirm-commissions` | `0 2 * * *` (04:00 SAST) | `run_commission_cycle()` — release held, then confirm due |
| `covo-refresh-scores` | `0 3 * * *` (05:00 SAST) | `refresh_all_covo_scores()` |

```sql
SELECT jobname, schedule, active FROM cron.job;                    -- what is scheduled
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;  -- did it run
```

## Edge Functions

Deployed separately. The CLI is not installed globally on the dev machine —
use `npx`, and pass `--project-ref` so no `config.toml` is needed:

```bash
npx supabase functions deploy <name> --no-verify-jwt --project-ref nyeulzucksldwlcrbbmo
```

| Function | Who may call it | Enforced by |
|---|---|---|
| `shopify-order-webhook` | Shopify only | HMAC-SHA256 over the raw body |
| `paystack-webhook` | Paystack only | HMAC-SHA512 over the raw body |
| `affiliate-redirect` | anyone | public by design; validates the slug and URL scheme |
| `generate-affiliate-assets` | admins | reads `profiles.role` with the service role |
| `commission-confirmation` | admins | reads `profiles.role` with the service role |
| `paystack-create-recipient` | the creator themselves | their own JWT; registers only their own account |
| `paystack-initiate-transfer` | admins | reads `profiles.role` with the service role |
| `record-conversion` | nobody | **retired**, returns 410. Delete once no storefront calls it |

Every one is deployed with `verify_jwt` off, and that is deliberate rather
than an oversight: **the platform's JWT gate accepts the anon key**, which is
published in the client bundle. It proves the caller holds *a* token, not that
they are anyone in particular, so it was never meaningful protection for any of
these — and for the two third-party webhooks it actively breaks them, since
neither Shopify nor Paystack can present a Supabase JWT.

Authorisation therefore lives inside each function, where it can be specific.
`commission-confirmation` shipped with none at all and `verify_jwt` off, which
made it a public endpoint that drew down brand escrow; it now checks for an
admin.

## Testing

`test_money_paths.sql` runs 44 assertions against the money functions, using
fixtures it creates and a transaction it rolls back — safe to run on
production, and it reads none of the live data.

```
commission arithmetic · duplicate-order idempotency · escrow solvency in
aggregate · held→pending release · return-window confirmation · escrow
never negative · payout batching · refund proportionality · click dedupe ·
Paystack deposit atomicity · payout settlement and reversal
```

Types are the other half. `npm run typecheck` checks every `.ts` file
against the generated schema; `src/lib/database.types.test.ts` uses
`@ts-expect-error` as its assertion, so the build fails if a query that
should be rejected starts compiling.

```bash
npm run typecheck
npx supabase gen types typescript --project-id nyeulzucksldwlcrbbmo > src/lib/database.types.ts
```

Regenerate the types after every migration. Adoption is file-by-file:
`tsconfig.json` sets `allowJs` with `checkJs: false`, so `.jsx` files compile
untouched and only `.ts` files are checked. `lib/supabase.ts` and
`lib/api/creator.ts` are converted — the two that touch commissions.

## Paystack: test mode, and going live

Paystack test mode is not a sandbox in the way that matters here. It sends
**genuine webhooks with genuine signatures** to the same endpoint — the only
difference is that no money moved. A test payment is therefore
indistinguishable from a real one by signature alone, and would credit a real
campaign's escrow with money nobody paid. That balance decides whether a
creator's commission is payable or held, so fake funding means promising
creators earnings against nothing.

Two things prevent it:

- Every event carries `data.domain` (`test` / `live`), and every key carries
  its own mode in its prefix (`sk_test_` / `sk_live_`). The webhook derives
  the expected mode from the key and **refuses any event that disagrees** —
  400, not 500, because retrying will not fix a key pointing at the wrong
  environment.
- Tranches and payouts record `livemode`, so test money stays identifiable
  rather than blending into the books.

### Set the key

```bash
npx supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx --project-ref nyeulzucksldwlcrbbmo
```

Nothing else changes between modes. Deriving the mode from the key's prefix
means there is no second setting to remember at go-live, and no way for the
two to disagree.

### Going live

```sql
SELECT * FROM public.paystack_test_money();   -- what fake money is in the books
SELECT * FROM public.purge_test_paystack_data();
```

1. `paystack_test_money()` — review what test deposits exist and against which
   campaigns.
2. `purge_test_paystack_data()` — deletes test tranches and payouts, then
   **recomputes** every escrow balance from the surviving live deposits minus
   what has actually been paid out. Recomputed rather than decremented, so the
   result does not depend on the earlier arithmetic having been right.
3. Swap the secret to `sk_live_…`. The webhook flips mode on its own.
4. Point Paystack's live webhook URL at the same function.

Run the purge **before** the key swap. Afterwards the endpoint rejects test
events, so any test webhook still in flight would be refused rather than
cleaned up.

## Money invariants

Worth keeping in mind when changing anything above:

- **A commission is never worth more than the escrow behind it.**
  `record_shopify_conversion` checks the balance against *all* outstanding
  liability, not just the sale in hand, under `FOR UPDATE` on the escrow row.
- **`held` means recorded but unfunded.** The creator did the work; the brand
  has not paid. `release_held_commissions()` pays them the moment it is funded,
  oldest first.
- **Payout amounts are never accepted from a client.**
  `request_creator_payout()` computes the figure in the database. The browser
  may only ask.
- **Escrow cannot go negative.** `confirm_due_commissions()` confirms only the
  prefix each balance covers and returns the rest to `held`.
- **A money step is never half-done.** `apply_paystack_deposit()` claims the
  tranche, credits the escrow, releases held commissions and resumes the
  campaign in one transaction; `mark_payout_settled()` sets the payout status
  and its commissions together. If any part raises, all of it rolls back and
  the webhook returns non-200 so Paystack redelivers.
- **A failed write is never reported as success.** No `await supabase.…`
  in this codebase discards its error. The webhooks answer 500 so the sender
  retries; the UI says what failed instead of optimistically showing the
  change it did not make.
