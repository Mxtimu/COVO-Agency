import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

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
          {isLoggedIn ? (
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
          {isLoggedIn ? (
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
            <Link to="/auth?type=brand" className="cov-btn cov-btn--sage cov-btn--lg">
              Join as a Brand
            </Link>
            <Link to="/auth?type=creator" className="cov-btn cov-btn--ghost cov-btn--lg">
              Join as a Creator ↗
            </Link>
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
    <section className="cov-split" id="brands">
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
        <Link to="/auth?type=brand" className="cov-btn cov-btn--sage cov-btn--lg">
          Start as a Brand
        </Link>
      </div>
      <div className="cov-split__visual">
        <div className="cov-stat-card">
          <span className="cov-stat-card__mark">◆</span>
          <p className="cov-stat-card__num">3.2×</p>
          <p className="cov-stat-card__label">Average ROI<br />across brand campaigns</p>
          <div className="cov-stat-card__divider" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="cov-stat-card__row">
              <span className="cov-stat-card__row-num">48h</span>
              <span className="cov-stat-card__row-label">Time to first creator match</span>
            </div>
            <div className="cov-stat-card__row">
              <span className="cov-stat-card__row-num">95%</span>
              <span className="cov-stat-card__row-label">Brand satisfaction rating</span>
            </div>
            <div className="cov-stat-card__row">
              <span className="cov-stat-card__row-num">8–25%</span>
              <span className="cov-stat-card__row-label">Commission range per campaign</span>
            </div>
          </div>
        </div>
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
        <Link to="/auth?type=creator" className="cov-btn cov-btn--brown cov-btn--lg">
          Start Earning
        </Link>
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
function WaitlistSection() {
  const [email, setEmail] = useState('')
  const [done, setDone]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    const address = email.trim()
    if (!address || !address.includes('@')) return setError('Please enter a valid email address.')

    setBusy(true); setError('')
    const { error: err } = await supabase.from('waitlist').insert({
      email:      address,
      source:     'landing',
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
    <section className="cov-waitlist">
      <span className="cov-waitlist__mark">✦</span>
      <h2 className="cov-h2">
        South Africa's most ambitious<br />brands are already waiting.
      </h2>
      <p className="cov-body-l">
        Join our early access list. Be first to launch a campaign when we go live.
      </p>
      {done ? (
        <p className="cov-waitlist__success">
          You're on the list — we'll be in touch soon. ◆
        </p>
      ) : (
        <>
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
              {busy ? 'Adding you…' : 'Request Early Access'}
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
          <Link to="/auth">Get Started</Link>
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

  return (
    <>
      <CovNav isLoggedIn={isLoggedIn} navigate={navigate} />
      <HeroSection />
      <TickerSection />
      <PhilosophySection />
      <ForBrandsSection />
      <ForCreatorsSection />
      <HowItWorksSection />
      <WaitlistSection />
      <CovFooter />
    </>
  )
}
