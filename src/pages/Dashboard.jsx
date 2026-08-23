import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import Overview    from '../components/dashboard/Overview'
import Campaigns   from '../components/dashboard/Campaigns'
import Storefront  from '../components/dashboard/Storefront'
import Links       from '../components/dashboard/Links'
import Earnings    from '../components/dashboard/Earnings'
import DashProfile from '../components/dashboard/DashProfile'
import Icon        from '../components/ui/Icon'

const PANELS = [
  { id: 'overview',   icon: 'overview',   label: 'Overview'   },
  { id: 'campaigns',  icon: 'campaigns',  label: 'Campaigns'  },
  { id: 'storefront', icon: 'storefront', label: 'Storefront' },
  { id: 'links',      icon: 'links',      label: 'My Links'   },
  { id: 'earnings',   icon: 'earnings',   label: 'Earnings'   },
]

const TITLES = { overview: 'Overview', campaigns: 'Campaigns', storefront: 'Storefront', links: 'My Links', earnings: 'Earnings', profile: 'Profile' }

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, profile, links, saveLinks, joined, saveJoined, logout } = useApp()

  const [active,      setActive]      = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast,       setToast]       = useState('')
  const [toastVis,    setToastVis]    = useState(false)

  const showToast = useCallback((msg) => {
    setToast(msg)
    setToastVis(true)
    setTimeout(() => setToastVis(false), 3200)
  }, [])

  function handleLogout() {
    logout()
    navigate('/')
  }

  function navigate2(panelId) {
    setActive(panelId)
    setSidebarOpen(false)
  }

  const initials  = ((user?.first?.[0] || '') + (user?.last?.[0] || '')).toUpperCase() || '?'
  const fullName  = `${user?.first || ''} ${user?.last || ''}`.trim() || 'Creator'
  const roleLabel = profile?.role === 'brand' ? 'Brand' : 'Creator'

  const totalEarnings = 531.50

  return (
    <div className="db-layout">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="db-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* SIDEBAR */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-logo">COVO</div>
        <nav className="sidebar-nav">
          {PANELS.map(p => (
            <div
              key={p.id}
              className={`nav-item ${active === p.id ? 'active' : ''}`}
              onClick={() => navigate2(p.id)}
            >
              <span className="nav-icon"><Icon name={p.icon} /></span>
              {p.label}
              {p.id === 'campaigns' && joined.length > 0 && (
                <span className="nav-badge">{joined.length}</span>
              )}
            </div>
          ))}
          <div className="nav-sep">
            <div
              className={`nav-item ${active === 'profile' ? 'active' : ''}`}
              onClick={() => navigate2('profile')}
            >
              <span className="nav-icon"><Icon name="profile" /></span> Profile
            </div>
          </div>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-row">
            <div className="user-av">{initials}</div>
            <div className="user-info">
              <div className="user-name">{fullName}</div>
              <div className="user-role">{roleLabel}</div>
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
              <span />
              <span />
              <span />
            </button>
            <div className="topbar-title">{TITLES[active]}</div>
          </div>
          <div className="topbar-right">
            <div className="wallet-chip"><Icon name="money" size={15} /> R{totalEarnings.toFixed(2)}</div>
            <div className="notif-btn"><Icon name="bell" size={17} /></div>
            <button className="topbar-logout" onClick={handleLogout} title="Log out"><Icon name="logout" size={16} /></button>
          </div>
        </header>

        <div className="db-content">
          {active === 'overview'   && <Overview   user={user} links={links} joined={joined} showPanel={setActive} showToast={showToast} />}
          {active === 'campaigns'  && <Campaigns  showToast={showToast} />}
          {active === 'storefront' && <Storefront user={user} links={links} saveLinks={saveLinks} showToast={showToast} />}
          {active === 'links'      && <Links      showToast={showToast} showPanel={setActive} />}
          {active === 'earnings'   && <Earnings   links={links} showToast={showToast} />}
          {active === 'profile'    && <DashProfile user={user} profile={profile} />}
        </div>
      </div>

      {/* TOAST */}
      <div className={`toast ${toastVis ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
