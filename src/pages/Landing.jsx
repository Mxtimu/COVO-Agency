import { useState, useEffect, createContext, useContext } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ── Waitlist-only mode ────────────────────────────────────────────────
//
// joincovo.app serves this exact page, minus every way in. The product is
// not open yet, so a "Get Started" button that lands on a signup form is a
// promise COVO cannot keep — and a login screen on the public domain invites
// people to hunt for an account they do not have.
//
// It is a build-time flag rather than a second copy of the page, because the
// alternative is two landing pages drifting apart: a change to the hero copy
// would have to be made twice and would eventually be made once.
//
//   npm run build          → the MVP on Vercel, every CTA goes to /auth
//   npm run build:landing  → joincovo.app, every CTA goes to the waitlist
const WAITLIST_ONLY = import.meta.env.VITE_WAITLIST_ONLY === 'true'

// Which side the visitor said they were, shared between the join buttons and
// the waitlist form. A context rather than props because the buttons sit
// inside four different section components and the form is their sibling —
// threading a setter down through all of them would be noise.
const PickSideContext = createContext(() => {})

// Every call to action on the page goes through this. In normal mode it is a
// router link to /auth; in waitlist-only mode it scrolls to the waitlist
// instead, keeping the same button, the same copy and the same layout.
//
// `side` is what the button claims about the visitor. In waitlist mode it
// preselects brand or creator on the form below, so somebody who clicked
// "Join as a Brand" is not asked the same question again two seconds later.
// `waitlistLabel` is the honest version of the same button. "Join as a Brand"
// promises an account that does not exist yet, so on the public site the label
// says what actually happens. The MVP keeps `children` unchanged.
function CTA({ to, side, waitlistLabel, className, style, onClick, children }) {
  const pickSide = useContext(PickSideContext)

  if (WAITLIST_ONLY) {
    return (
      <a
        href="#waitlist"
        className={className}
        style={style}
        onClick={(e) => { if (side) pickSide(side); onClick?.(e) }}
      >
        {waitlistLabel ?? children}
      </a>
    )
  }
  return (
    <Link to={to} className={className} style={style} onClick={onClick}>
      {children}
    </Link>
  )
}

/* ── NAV ── */
function CovNav({ isLoggedIn, navigate }) {
  const [scrolled,  setScrolled]  = useState(false)
  const [menuOpen,  setMenuOpen]  = useState(false)

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 50)
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [])

  function closeMenu() { setMenuOpen(false) }

  return (
    <>
      <nav className={`cov-nav${scrolled ? ' cov-nav--scrolled' : ''}`}>
        <span className="cov-nav__logo">COVO</span>
        <ul className="cov-nav__links">
          <li><a href="#brands">For Brands</a></li>
          <li><a href="#creators">For Creators</a></li>
          <li><a href="#how">How It Works</a></li>
        </ul>
        <div className="cov-nav__cta">
          {WAITLIST_ONLY ? (
            // No "Log in": there is nothing to log in to yet on this domain.
            <a href="#waitlist" className="cov-btn cov-btn--sage">Join the waitlist</a>
          ) : isLoggedIn ? (
            <button className="cov-btn cov-btn--sage" onClick={() => navigate('/dashboard')}>
              Dashboard
            </button>
          ) : (
            <>
              <Link to="/auth?mode=login" className="cov-nav__login">Log in</Link>
              <Link to="/auth" className="cov-btn cov-btn--sage">Get Started</Link>
            </>
          )}
        </div>
        <button
          className={`cov-nav__burger${menuOpen ? ' cov-nav__burger--open' : ''}`}
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Toggle navigation"
        >
          <span /><span /><span />
        </button>
      </nav>

      {/* Mobile overlay */}
      <div className={`cov-mobile-menu${menuOpen ? ' cov-mobile-menu--open' : ''}`}>
        <ul>
          <li><a href="#brands"   onClick={closeMenu}>For Brands</a></li>
          <li><a href="#creators" onClick={closeMenu}>For Creators</a></li>
          <li><a href="#how"      onClick={closeMenu}>How It Works</a></li>
        </ul>
        <div className="cov-mobile-menu__cta">
          {WAITLIST_ONLY ? (
            <a href="#waitlist" className="cov-btn cov-btn--sage cov-btn--lg"
              style={{ width: '100%', justifyContent: 'center' }} onClick={closeMenu}>
              Join the waitlist
            </a>
          ) : isLoggedIn ? (
            <button className="cov-btn cov-btn--sage cov-btn--lg" style={{ width: '100%' }}
              onClick={() => { navigate('/dashboard'); closeMenu() }}>
              Dashboard
            </button>
          ) : (
            <>
              <Link to="/auth?mode=login" className="cov-btn cov-btn--ghost cov-btn--lg"
                style={{ width: '100%', justifyContent: 'center' }} onClick={closeMenu}>
                Log in
              </Link>
              <Link to="/auth" className="cov-btn cov-btn--sage cov-btn--lg"
                style={{ width: '100%', justifyContent: 'center' }} onClick={closeMenu}>
                Get Started
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/* ── HERO ── */
function HeroSection() {
  return (
    <section className="cov-hero">
      <div className="cov-hero__eyebrow">
        <div className="cov-hero__rule-line" />
        <span className="cov-hero__eyebrow-text">✦ Influencer Marketing, Reimagined ✦</span>
        <div className="cov-hero__rule-line" />
      </div>

      <div className="cov-hero__split">
        <div className="cov-hero__left">
          <h1 className="cov-hero__heading">
            Where<br />
            Influence<br />
            Meets Its<br />
            Match<span className="cov-dot">.</span>
          </h1>
          <div className="cov-hero__actions">
            <CTA to="/auth?type=brand" side="brand" waitlistLabel="Join waitlist as a Brand" className="cov-btn cov-btn--sage cov-btn--lg">
              Join as a Brand
            </CTA>
            <CTA to="/auth?type=creator" side="creator" waitlistLabel="Join waitlist as a Creator" className="cov-btn cov-btn--ghost cov-btn--lg">
              Join as a Creator ↗
            </CTA>
          </div>
        </div>

        <div className="cov-hero__vr" />

        <div className="cov-hero__right">
          <p className="cov-hero__script">Built for the bold.</p>
          <p className="cov-hero__body">
            COVO connects South Africa's most ambitious brands with creators who
            move culture — not just content. Seamless partnerships, measurable
            ROI, real results.
          </p>
          <div className="cov-hero__stats">
            <div className="cov-hero__stat">
              <span className="cov-hero__stat-n">10K+</span>
              <span className="cov-hero__stat-l">Vetted Creators</span>
            </div>
            <span className="cov-hero__stat-sep">◆</span>
            <div className="cov-hero__stat">
              <span className="cov-hero__stat-n">500+</span>
              <span className="cov-hero__stat-l">Brand Partners</span>
            </div>
            <span className="cov-hero__stat-sep">◆</span>
            <div className="cov-hero__stat">
              <span className="cov-hero__stat-n">3.2×</span>
              <span className="cov-hero__stat-l">Average ROI</span>
            </div>
          </div>
        </div>
      </div>

      <div className="cov-hero__footer-bar">
        <div className="cov-hero__rule-line" />
        <span className="cov-hero__location">South Africa & Beyond</span>
        <div className="cov-hero__rule-line" />
      </div>
    </section>
  )
}

/* ── TICKER ── */
function TickerSection() {
  const items = [
    'Fashion', 'Wellness', 'Fitness & Sport', 'Beauty', 'Food & Beverage',
    'Technology', 'Home Living', 'Lifestyle', 'Personal Care', 'Entertainment',
  ]
  const track = [...items, ...items]
  return (
    <div className="cov-ticker" aria-hidden="true">
      <div className="cov-ticker__track">
        {track.map((item, i) => (
          <span key={i} className="cov-ticker__item">
            {item}
            <span className="cov-ticker__div"> ✦ </span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ── PHILOSOPHY ── */
function PhilosophySection() {
  const pillars = [
    {
      mark: '◆',
      title: 'The Match',
      body: 'Our algorithm goes beyond follower count — surfacing creators who share your brand\'s values, audience, and aesthetic. Every match is intentional.',
    },
    {
      mark: '✦',
      title: 'The Platform',
      body: 'End-to-end campaign management: from brief to affiliate link to payout. Everything your team needs is in one dashboard built for performance.',
    },
    {
      mark: '❋',
      title: 'The Results',
      body: 'Transparent, real-time analytics hold everyone accountable and keep ROI at the centre — so you know exactly what\'s working and why.',
    },
  ]
  return (
    <section className="cov-philosophy">
      <div className="cov-philosophy__header">
        <span className="cov-label">The COVO Way</span>
        <h2 className="cov-h2">Three pillars.<br />One platform.</h2>
      </div>
      <div className="cov-philosophy__grid">
        {pillars.map(p => (
          <div className="cov-pillar" key={p.title}>
            <span className="cov-pillar__mark">{p.mark}</span>
            <h3 className="cov-pillar__title">{p.title}</h3>
            <p className="cov-pillar__body">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── FOR BRANDS ── */
function ForBrandsSection() {
  const features = [
    { mark: '◆', title: 'Precision Matching', body: 'Creators surfaced by audience demographics, engagement quality, and content style — not just niche tags.' },
    { mark: '◆', title: 'Campaign Command', body: 'Set budgets, define deliverables, track milestones, and approve content from a single dashboard built for brand managers.' },
    { mark: '◆', title: 'ROI Clarity', body: 'Every affiliate link, every click, every conversion tracked and attributed so you know exactly what moved the needle.' },
  ]
  return (
    <section className="cov-split cov-split--single" id="brands">
      <div className="cov-split__text">
        <span className="cov-label">For Brands</span>
        <h2 className="cov-h2">Stop guessing.<br />Start converting.</h2>
        <p className="cov-body-l">
          You didn't build your brand on vanity metrics. Neither did we. COVO gives
          your marketing team the tools to find the right creators, run campaigns
          with precision, and measure every rand spent.
        </p>
        <div className="cov-feature-list">
          {features.map(f => (
            <div className="cov-feature-row" key={f.title}>
              <span className="cov-feature-mark">{f.mark}</span>
              <div>
                <strong className="cov-feature-title">{f.title}</strong>
                <p className="cov-feature-body">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
        <CTA to="/auth?type=brand" side="brand" waitlistLabel="Join waitlist as a Brand" className="cov-btn cov-btn--sage cov-btn--lg">
          Join as a Brand
        </CTA>
      </div>
    </section>
  )
}

/* ── FOR CREATORS ── */
function ForCreatorsSection() {
  const perks = [
    { mark: '✦', title: 'Affiliate Links That Pay', body: 'Generate a unique tracked link for every product you promote. Every sale earns you commission — automatically, with no chasing.' },
    { mark: '✦', title: 'Your Personal Storefront', body: 'Curate the products you genuinely love into a personalised page your audience can shop directly from one link.' },
    { mark: '✦', title: 'Get Discovered', body: 'Your vetted profile is visible to hundreds of brands actively seeking creators in your niche. Opportunities come to you.' },
  ]
  return (
    <section className="cov-split cov-split--forest cov-split--flip" id="creators">
      <div className="cov-split__visual">
        <div className="cov-creator-card">
          <div className="cov-creator-card__header">
            <div className="cov-creator-card__av">SK</div>
            <div>
              <strong className="cov-creator-card__name">Sipho K.</strong>
              <span className="cov-creator-card__role">Fitness & Wellness</span>
            </div>
          </div>
          <div className="cov-creator-card__stats">
            <div className="cov-creator-card__stat">
              <span className="cov-creator-card__stat-n">24K</span>
              <span className="cov-creator-card__stat-l">Followers</span>
            </div>
            <div className="cov-creator-card__stat">
              <span className="cov-creator-card__stat-n">6.4%</span>
              <span className="cov-creator-card__stat-l">Engagement</span>
            </div>
            <div className="cov-creator-card__stat">
              <span className="cov-creator-card__stat-n">R4,200</span>
              <span className="cov-creator-card__stat-l">This month</span>
            </div>
          </div>
          <div className="cov-creator-card__tags">
            <span className="cov-creator-card__tag">Sport</span>
            <span className="cov-creator-card__tag">Wellness</span>
            <span className="cov-creator-card__tag">Lifestyle</span>
          </div>
        </div>
      </div>
      <div className="cov-split__text">
        <span className="cov-label">For Creators</span>
        <h2 className="cov-h2">Your influence.<br />Your income.</h2>
        <p className="cov-body-l">
          You built your following through authentic storytelling. COVO helps you
          turn that trust into a sustainable income — by connecting you with brands
          that actually fit your world.
        </p>
        <div className="cov-feature-list">
          {perks.map(p => (
            <div className="cov-feature-row" key={p.title}>
              <span className="cov-feature-mark">{p.mark}</span>
              <div>
                <strong className="cov-feature-title">{p.title}</strong>
                <p className="cov-feature-body">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
        <CTA to="/auth?type=creator" side="creator" waitlistLabel="Join waitlist as a Creator" className="cov-btn cov-btn--brown cov-btn--lg">
          Join as a Creator
        </CTA>
      </div>
    </section>
  )
}

/* ── HOW IT WORKS ── */
function HowItWorksSection() {
  const steps = [
    { n: '01', title: 'Create Your Profile', body: 'Register as a brand or creator. Tell us your niche, goals, and what you stand for. Takes under 10 minutes.' },
    { n: '02', title: 'Get Matched', body: 'Our platform surfaces the right fit — brands find creators; creators find campaigns aligned with their audience.' },
    { n: '03', title: 'Collaborate', body: 'Set terms, share briefs, approve content, and go live — all managed through your COVO dashboard.' },
    { n: '04', title: 'Track & Earn', body: 'Every click, every sale, every conversion tracked in real time. Creators earn; brands measure their ROI.' },
  ]
  return (
    <section className="cov-steps" id="how">
      <div className="cov-steps__header">
        <span className="cov-label">How It Works</span>
        <h2 className="cov-h2">From sign-up to<br />first campaign in 48 hours.</h2>
      </div>
      <div className="cov-steps__grid">
        {steps.map(s => (
          <div className="cov-step" key={s.n}>
            <span className="cov-step__num">{s.n}</span>
            <h3 className="cov-step__title">{s.title}</h3>
            <p className="cov-step__body">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── WAITLIST ── */
function WaitlistSection({ side, setSide }) {
  const [email, setEmail] = useState('')
  const [done, setDone]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    const address = email.trim()
    if (!address || !address.includes('@')) return setError('Please enter a valid email address.')

    // Asked rather than guessed. Knowing which side somebody is on decides
    // what they are invited to on launch day, and a wrong guess means a
    // creator being told how to fund a campaign.
    if (WAITLIST_ONLY && !side) {
      return setError('Please choose whether you are joining as a brand or a creator.')
    }

    setBusy(true); setError('')
    const { error: err } = await supabase.from('waitlist').insert({
      email:      address,
      // enqueue_waitlist_launch_emails() branches on exactly these two
      // values (supabase/waitlist_launch.sql). 'landing' stays the value for
      // the MVP's own form, where the question is not asked.
      source:     side ? `site:${side}` : 'landing',
      user_agent: navigator.userAgent,
    })
    setBusy(false)

    if (err) {
      // 23505 = already on the list. Nothing has gone wrong from their side,
      // so show the same confirmation rather than an error.
      if (err.code === '23505') return setDone(true)
      return setError('Something went wrong. Please try again.')
    }
    setDone(true)
  }

  return (
    <section className="cov-waitlist" id="waitlist">
      <span className="cov-waitlist__mark">✦</span>
      <h2 className="cov-h2">
        South Africa's most ambitious<br />brands are already waiting.
      </h2>
      <p className="cov-body-l">
        Join our early access list. Be first to launch a campaign when we go live.
      </p>
      {done ? (
        <p className="cov-waitlist__success">
          You're on the list{side ? ` as ${side === 'brand' ? 'a brand' : 'a creator'}` : ''} — we'll
          email you when we launch. ◆
        </p>
      ) : (
        <>
          {/* Only on the public site. The MVP's form sits behind a page where
              signing up tells us the side already, so asking there would be a
              question with no purpose. */}
          {WAITLIST_ONLY && (
            <div
              role="group"
              aria-label="Joining as"
              style={{
                display: 'flex', gap: '.5rem', justifyContent: 'center',
                flexWrap: 'wrap', margin: '0 auto 1rem', maxWidth: '26rem',
              }}
            >
              {[['brand', 'A brand'], ['creator', 'A creator']].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={side === id}
                  onClick={() => { setSide(id); setError('') }}
                  className={`cov-btn cov-btn--lg ${side === id ? 'cov-btn--sage' : 'cov-btn--ghost'}`}
                  style={{ flex: '1 1 10rem', justifyContent: 'center' }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <form className="cov-waitlist__form" onSubmit={submit}>
            <input
              type="email"
              placeholder="Your email address"
              value={email}
              onChange={e => { setError(''); setEmail(e.target.value) }}
              className="cov-waitlist__input"
              required
            />
            <button type="submit" className="cov-btn cov-btn--sage cov-btn--lg" disabled={busy}>
              {busy ? 'Adding you…' : WAITLIST_ONLY ? 'Join the waitlist' : 'Request Early Access'}
            </button>
          </form>
          {error && (
            <p className="cov-body-l" style={{ color: '#FCA5A5', marginTop: '.75rem', fontSize: '.9rem' }}>
              {error}
            </p>
          )}
        </>
      )}
    </section>
  )
}

/* ── FOOTER ── */
function CovFooter() {
  return (
    <footer className="cov-footer">
      <div className="cov-footer__top">
        <div>
          <span className="cov-footer__logo">COVO</span>
          <p className="cov-footer__tagline">
            Connecting South Africa's most ambitious brands<br />
            with creators who move culture.
          </p>
        </div>
        <div className="cov-footer__links-col">
          <span className="cov-footer__col-head">Platform</span>
          <a href="#brands">For Brands</a>
          <a href="#creators">For Creators</a>
          <a href="#how">How It Works</a>
          <CTA to="/auth" waitlistLabel="Join the waitlist">Get Started</CTA>
        </div>
        <div className="cov-footer__links-col">
          <span className="cov-footer__col-head">Company</span>
          <a href="#">About</a>
          <a href="#">Blog</a>
          <a href="#">Contact</a>
          <a href="#">Careers</a>
        </div>
      </div>
      <div className="cov-footer__bottom">
        <span>© 2025 COVO. All rights reserved.</span>
        <div className="cov-footer__legal">
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Service</a>
        </div>
      </div>
    </footer>
  )
}

/* ── LANDING PAGE ── */
export default function Landing() {
  const navigate   = useNavigate()
  const isLoggedIn = localStorage.getItem('covo_auth') === 'true'

  // Which side the visitor said they were. Set by any "Join waitlist as a…"
  // button and read by the form, so clicking one up the page preselects the
  // answer instead of asking the same question again on arrival.
  const [side, setSide] = useState(null)

  return (
    <PickSideContext.Provider value={setSide}>
      <CovNav isLoggedIn={isLoggedIn} navigate={navigate} />
      <HeroSection />
      <TickerSection />
      <PhilosophySection />
      <ForBrandsSection />
      <ForCreatorsSection />
      <HowItWorksSection />
      <WaitlistSection side={side} setSide={setSide} />
      <CovFooter />
    </PickSideContext.Provider>
  )
}
