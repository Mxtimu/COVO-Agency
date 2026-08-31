import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import BrandOverview  from '../components/brand/BrandOverview'
import BrandCampaigns from '../components/brand/BrandCampaigns'
import BrandCreators  from '../components/brand/BrandCreators'
import BrandPayments  from '../components/brand/BrandPayments'
import BrandProfile   from '../components/brand/BrandProfile'
import Icon           from '../components/ui/Icon'

const PANELS = [
  { id: 'overview',   icon: 'overview',  label: 'Overview'  },
  { id: 'campaigns',  icon: 'campaigns', label: 'Campaigns' },
  { id: 'creators',   icon: 'creators',  label: 'Creators'  },
  { id: 'payments',   icon: 'payments',  label: 'Payments'  },
  { id: 'profile',    icon: 'brands',    label: 'Profile'   },
]

export default function BrandDashboard() {
  const navigate             = useNavigate()
  const { user, profile, logout } = useApp()
  const [active,      setActive]      = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const bp       = Array.isArray(profile?.brand_profiles) ? profile.brand_profiles[0] : profile?.brand_profiles
  const company  = bp?.company_name || user?.first || 'Brand'
  const initials = company.slice(0, 2).toUpperCase()

  function handleLogout() { logout(); navigate('/') }
  function go(id) { setActive(id); setSidebarOpen(false) }

  return (
    <div className="db-layout">
      {sidebarOpen && <div className="db-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* SIDEBAR */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-logo">
          COVO
          <span style={{ marginLeft: '.5rem', fontSize: '.55rem', fontFamily: 'var(--font-sans)', fontWeight: 700, background: 'rgba(195,206,148,.15)', color: 'var(--sage)', padding: '.15rem .45rem', borderRadius: 4, verticalAlign: 'middle', letterSpacing: '.08em', border: '1px solid rgba(195,206,148,.25)' }}>BRAND</span>
        </div>
        <nav className="sidebar-nav">
          {PANELS.map(p => (
            <div key={p.id} className={`nav-item ${active === p.id ? 'active' : ''}`} onClick={() => go(p.id)}>
              <span className="nav-icon"><Icon name={p.icon} /></span>
              {p.label}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-row">
            <div className="user-av" style={{ background: 'var(--gradient)' }}>{initials}</div>
            <div className="user-info">
              <div className="user-name">{company}</div>
              <div className="user-role" style={{ color: 'var(--sage)' }}>Brand Partner</div>
            </div>
            <div className="logout-btn" onClick={handleLogout} title="Log out"><Icon name="logout" size={16} /></div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div className="db-main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
            <button className="db-hamburger" onClick={() => setSidebarOpen(o => !o)} aria-label="Open menu">
              <span /><span /><span />
            </button>
            <div className="topbar-title">{PANELS.find(p => p.id === active)?.label}</div>
          </div>
          <div className="topbar-right">
            <div style={{ padding: '.3rem .75rem', background: 'rgba(195,206,148,.08)', border: '1px solid rgba(195,206,148,.2)', borderRadius: 100, fontSize: '.72rem', fontWeight: 700, color: 'var(--sage)', letterSpacing: '.06em' }}>
              BRAND
            </div>
            <button className="topbar-logout" onClick={handleLogout} title="Log out"><Icon name="logout" size={16} /></button>
          </div>
        </header>

        <div className="db-content">
          {active === 'overview'  && <BrandOverview  showPanel={go} />}
          {active === 'campaigns' && <BrandCampaigns />}
          {active === 'creators'  && <BrandCreators  />}
          {active === 'payments'  && <BrandPayments  />}
          {active === 'profile'   && <BrandProfile   />}
        </div>
      </div>
    </div>
  )
}
