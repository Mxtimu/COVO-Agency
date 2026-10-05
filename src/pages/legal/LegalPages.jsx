import { Link } from 'react-router-dom'

// Privacy, Terms and Data Deletion.
//
// Meta checks that all three load before an app can go Live, so they are real
// routes rather than anchors. The content describes what the platform actually
// does — what is collected, what is deliberately not collected, who can see
// it, and how long it is kept — because a policy that does not match the
// system is worse than none: it is a commitment nobody can keep.
//
// The facts here are drawn from the schema and the payout code. The wording
// commits Tumi's company and should be reviewed by her, and ideally a lawyer,
// before real creators sign up.

const UPDATED = '28 September 2026'
const CONTACT = 'support@covo.africa'

function LegalLayout({ title, children }) {
  return (
    <div style={{ background: 'var(--ink-deep)', minHeight: '100vh', color: 'var(--warm-white)' }}>
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem clamp(1rem, 5vw, 3rem)', borderBottom: '1px solid var(--border)' }}>
        <Link to="/" className="logo" style={{ fontSize: '1.4rem', textDecoration: 'none' }}>COVO</Link>
        <Link to="/auth" style={{ color: 'var(--sage)', fontSize: '.85rem', textDecoration: 'none', fontWeight: 600 }}>
          Sign in
        </Link>
      </nav>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: 'clamp(2rem, 6vw, 4rem) clamp(1rem, 5vw, 2rem) 5rem' }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 'clamp(1.9rem, 5vw, 2.6rem)', lineHeight: 1.15, margin: '0 0 .5rem', textWrap: 'balance' }}>
          {title}
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '.82rem', margin: '0 0 2.5rem' }}>
          Last updated {UPDATED}
        </p>

        <div className="legal-body">{children}</div>

        <p style={{ marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)', fontSize: '.82rem', color: 'var(--muted)' }}>
          Questions about any of this? Email{' '}
          <a href={`mailto:${CONTACT}`} style={{ color: 'var(--sage)' }}>{CONTACT}</a>.
          {' · '}
          <Link to="/privacy" style={{ color: 'var(--muted)' }}>Privacy</Link>
          {' · '}
          <Link to="/terms" style={{ color: 'var(--muted)' }}>Terms</Link>
          {' · '}
          <Link to="/data-deletion" style={{ color: 'var(--muted)' }}>Delete your data</Link>
        </p>
      </main>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
export function Privacy() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>
        COVO connects South African brands with creators who promote their
        products, and pays those creators commission on sales they generate.
        This explains what we collect, why, and what you can do about it. It is
        written to comply with the Protection of Personal Information Act
        (POPIA).
      </p>

      <h2>What we collect</h2>

      <h3>When you sign up</h3>
      <p>
        Your email address and the name you give us. If you sign in with Google
        or Facebook, we receive your name and email address from them — nothing
        else, and we do not post anything to your accounts.
      </p>

      <h3>If you are a creator</h3>
      <ul>
        <li>The social media handles you choose to add (TikTok, Instagram, YouTube). These are as you enter them; we do not currently connect to those platforms or read your data from them.</li>
        <li>Your niches, and optionally a bio, location and gender.</li>
        <li>To pay you: your legal name, phone number, and bank details.</li>
      </ul>
      <p>
        <strong>We do not store your bank account number.</strong> It is sent
        once to Paystack, our payment provider, which returns a reference we use
        for transfers. We keep only that reference, your bank's name and the
        last four digits, so you can recognise which account you registered.
      </p>
      <p>
        We do not collect ID numbers, dates of birth, residential addresses or
        identity documents.
      </p>

      <h3>If you are a brand</h3>
      <p>
        Your company name, and optionally a website, industry and logo, along
        with the campaigns and products you create.
      </p>

      <h3>What the platform records as you use it</h3>
      <ul>
        <li>Clicks on affiliate links: the time, the browser type and the referring page. The visitor's IP address is <strong>hashed before it is stored</strong> — we keep a one-way fingerprint used to avoid counting one person twice, and never the address itself.</li>
        <li>Sales attributed to a creator's link, reported to us by the brand's Shopify store: the order reference and the order value.</li>
        <li>Commissions, payouts, and the COVO Score calculated from a creator's clicks, sales, average order value and dispute history.</li>
      </ul>

      <h2>Who can see it</h2>
      <ul>
        <li><strong>Brands</strong> can see the profile, COVO Score and social handles of creators who have been approved onto one of their campaigns, and the commissions earned on it. They cannot see creators who have not been approved onto their campaigns, and they never see bank details or phone numbers.</li>
        <li><strong>Creators</strong> can see their own data, and the campaigns available to them.</li>
        <li><strong>COVO administrators</strong> can see accounts, applications, commissions, payouts and disputes in order to run the platform.</li>
      </ul>

      <h2>Who we share it with</h2>
      <ul>
        <li><strong>Paystack</strong> — payments and payouts. They receive the information needed to process a payment, including bank details for creators being paid.</li>
        <li><strong>Supabase</strong> — hosting and database.</li>
        <li><strong>Shopify</strong> — a brand's store tells us when a sale came through a creator's link.</li>
      </ul>
      <p>We do not sell personal information, and we do not share it for advertising.</p>

      <h2>How long we keep it</h2>
      <p>
        You can close your account at any time from your profile. When you do,
        your name, email, phone number, bank details and social handles are
        permanently removed.
      </p>
      <p>
        <strong>Records of completed sales and payments are kept.</strong> Those
        records are also the brand's financial records and ours, and we are
        required to retain them — but after your account is closed they no
        longer identify you.
      </p>
      <p>
        An account cannot be closed while money is still owed to or by it. That
        is deliberate: closing an account does not settle a debt, it only
        removes the person it is owed to.
      </p>

      <h2>Your rights under POPIA</h2>
      <p>
        You may ask us what personal information we hold about you, ask us to
        correct it, or ask us to delete it. Most of this you can do yourself
        from your profile. For anything else, email{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we will respond within 30
        days.
      </p>
      <p>
        If you believe we have handled your information improperly, you may
        complain to the Information Regulator of South Africa.
      </p>

      <h2>Security</h2>
      <p>
        Data is held in an access-controlled database where each account can
        reach only its own records. Passwords are hashed by our authentication
        provider and are never visible to us. Payment credentials are held by
        Paystack, not by COVO.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy we will update the date above, and tell you
        directly if the change materially affects you.
      </p>
    </LegalLayout>
  )
}

// ════════════════════════════════════════════════════════════════════
export function Terms() {
  return (
    <LegalLayout title="Terms of Service">
      <p>
        These terms cover your use of COVO. By creating an account you agree to
        them.
      </p>

      <h2>What COVO does</h2>
      <p>
        COVO is a marketplace. Brands run campaigns and fund them in advance;
        creators apply, and those approved receive a unique affiliate link.
        When someone buys through that link, the creator earns commission at the
        rate the brand set.
      </p>

      <h2>Accounts</h2>
      <p>
        You need to be 18 or older. Give us accurate information and keep it up
        to date — in particular, the legal name on your COVO account must match
        the name on your bank account, or payments to you will be rejected by
        the bank.
      </p>
      <p>
        You are responsible for what happens under your account. Tell us at once
        if you think someone else has access to it.
      </p>

      <h2>For creators</h2>
      <ul>
        <li>Promote honestly. Do not claim a product does something it does not, and disclose that your links are paid where the law or the platform you post on requires it.</li>
        <li>Do not generate clicks or sales artificially. Commissions from traffic that is not genuine will be denied.</li>
        <li>Your COVO Score is calculated from your actual performance. It cannot be set or bought.</li>
      </ul>

      <h2>For brands</h2>
      <ul>
        <li>Campaigns must be funded before they go live. A campaign whose balance falls below R500 is paused automatically until it is topped up.</li>
        <li>Commission rates you set are binding on sales already made. Changing a rate affects future sales only.</li>
        <li>Your product links must go to the product advertised.</li>
      </ul>

      <h2>Money</h2>
      <p>
        Brands deposit funds against a specific campaign. When a sale is
        recorded, the commission is calculated at the campaign's rate and COVO
        retains a <strong>platform fee of 8% of that commission</strong>.
      </p>
      <p>
        Commissions are not paid immediately. Each is held for the campaign's
        return window — <strong>14 days from the sale by default</strong> — so
        that returns and refunds can be accounted for. When the window closes
        with the sale intact, the commission clears automatically. Nobody
        approves this by hand.
      </p>
      <p>
        If a sale is refunded or cancelled during that window, the commission is
        reduced or removed accordingly.
      </p>
      <p>
        Creators may withdraw cleared earnings once they total at least
        <strong> R250</strong>. Payments are made to the bank account you
        registered, through Paystack.
      </p>
      <p>
        A commission is never worth more than the funds behind it. If a campaign
        cannot cover a commission, it is recorded and held until the brand funds
        it — the creator's work is not lost, but nor is it promised against
        money that is not there.
      </p>

      <h2>Disputes</h2>
      <p>
        If you disagree with a commission, a denial or a payment, email{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We will look at the click and
        sale records and tell you what we find. COVO decides disputes between a
        brand and a creator, and we will explain our reasoning.
      </p>

      <h2>Ending things</h2>
      <p>
        You can close your account whenever you like, provided no money is
        outstanding. We may suspend an account for fraud, artificial traffic, or
        repeated disputes decided against it. Commissions already cleared remain
        payable.
      </p>

      <h2>Limits</h2>
      <p>
        COVO is provided as it is. We do not guarantee a creator will earn, or
        that a campaign will perform. We are not responsible for the products
        brands sell, or for what happens on the platforms creators post to.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the law of the Republic of South Africa.</p>
    </LegalLayout>
  )
}

// ════════════════════════════════════════════════════════════════════
export function DataDeletion() {
  return (
    <LegalLayout title="Deleting your data">
      <p>
        You can delete your COVO account and personal information yourself. It
        takes about a minute and does not require emailing anyone.
      </p>

      <h2>How to do it</h2>
      <ol>
        <li>Sign in at <Link to="/auth">covo.africa</Link>.</li>
        <li>Go to <strong>Profile</strong>.</li>
        <li>Scroll to <strong>Close your account</strong> at the bottom.</li>
        <li>Type <strong>DELETE</strong> to confirm.</li>
      </ol>

      <h2>What is removed</h2>
      <p>
        Immediately and permanently: your name, email address, phone number,
        bank details, social media handles, bio, location and profile picture.
        You will not be able to sign in again.
      </p>

      <h2>What is kept, and why</h2>
      <p>
        Records of sales and payments that already happened are retained. They
        are also the financial records of the brands you worked with, and both
        they and we are required to keep them. Once your account is closed
        those records no longer identify you.
      </p>

      <h2>If the option is unavailable</h2>
      <p>
        An account cannot be closed while money is owed to or by it — unpaid
        earnings, a payment in progress, or funds still held in a campaign. The
        page will tell you exactly what is outstanding. Once it clears, the
        option becomes available.
      </p>
      <p>
        We do this because closing an account does not settle a debt. It only
        removes the person the debt is owed to.
      </p>

      <h2>How long it takes</h2>
      <p>
        Your personal information is removed <strong>immediately</strong>. Copies
        held in encrypted backups are overwritten within 30 days.
      </p>

      <h2>If you would rather we did it</h2>
      <p>
        Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> with the subject{' '}
        <strong>Delete my account</strong>, from the address you signed up with.
        We will confirm within 30 days.
      </p>
    </LegalLayout>
  )
}
