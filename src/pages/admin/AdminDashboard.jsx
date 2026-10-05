import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import AdminOverview  from './panels/AdminOverview'
import AdminCreators  from './panels/AdminCreators'
import AdminBrands    from './panels/AdminBrands'
import AdminCampaigns    from './panels/AdminCampaigns'
import AdminApplications from './panels/AdminApplications'
import AdminPayouts      from './panels/AdminPayouts'
import AdminDisputes     from './panels/AdminDisputes'
import Icon              from '../../components/ui/Icon'
import { ToastProvider } from '../../components/ui/Toast'

const PANELS = [
  { id: 'overview',     icon: 'overview',     label: 'Overview'     },
  { id: 'creators',     icon: 'creators',     label: 'Creators'     },
  { id: 'brands',       icon: 'brands',       label: 'Brands'       },
  { id: 'campaigns',    icon: 'campaigns',    label: 'Campaigns'    },
  { id: 'applications', icon: 'applications', label: 'Applications' },
  { id: 'payouts',      icon: 'payouts',      label: 'Payouts'      },
  { id: 'disputes',     icon: 'disputes',     label: 'Disputes'     },
]

export default function AdminDashboard() {
  const navigate               = useNavigate()
  const { user, logout }       = useApp()
  const [active, setActive]    = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  function handleLogout() { logout(); navigate('/') }
  function go(id) { setActive(id); setSidebarOpen(false) }

  const initials = ((user?.first?.[0] || '') + (user?.last?.[0] || '')).toUpperCase() || 'A'

  return (
    // Wraps the whole shell so any panel can raise a notification without
    // the state being threaded down through seven of them.
    <ToastProvider>
    <div className="db-layout">
      {sidebarOpen && <div className="db-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* SIDEBAR */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-logo">
          COVO
          <span style={{ marginLeft: '.5rem', fontSize: '.55rem', fontFamily: 'var(--font-sans)', fontWeight: 700, background: '#EF4444', color: 'white', padding: '.15rem .45rem', borderRadius: 4, verticalAlign: 'middle', letterSpacing: '.08em' }}>ADMIN</span>
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
            <div className="user-av">{initials}</div>
            <div className="user-info">
              <div className="user-name">{user?.first || 'Admin'}</div>
              <div className="user-role" style={{ color: '#FCA5A5' }}>Administrator</div>
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
            <div style={{ padding: '.35rem .85rem', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 100, fontSize: '.72rem', fontWeight: 700, color: '#FCA5A5', letterSpacing: '.06em' }}>
              ADMIN MODE
            </div>
            <button className="topbar-logout" onClick={handleLogout} title="Log out"><Icon name="logout" size={16} /></button>
          </div>
        </header>

        <div className="db-content">
          {active === 'overview'  && <AdminOverview  />}
          {active === 'creators'  && <AdminCreators  />}
          {active === 'brands'    && <AdminBrands    />}
          {active === 'campaigns' && <AdminCampaigns />}
          {active === 'applications' && <AdminApplications />}
          {active === 'payouts'   && <AdminPayouts   />}
          {active === 'disputes'  && <AdminDisputes  />}
        </div>
      </div>
    </div>
    </ToastProvider>
  )
}
