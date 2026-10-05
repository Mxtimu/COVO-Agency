import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { useToast } from '../../../components/ui/Toast'

export default function AdminBrands() {
  const toast = useToast()
  const [brands,  setBrands]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, status, created_at, brand_profiles(company_name)')
      .eq('role', 'brand')
      .order('created_at', { ascending: false })
    setBrands(data ?? [])
    setLoading(false)
  }

  function bp(b) {
    const raw = b.brand_profiles
    return Array.isArray(raw) ? raw[0] : raw
  }

  // Only reflect the change locally once the database has accepted it —
  // otherwise a failed write leaves the admin looking at an approved brand
  // that is still pending, and it survives until the next reload.
  async function setStatus(id, status) {
    const { error } = await supabase.from('profiles').update({ status }).eq('id', id)
    if (error) return toast.error(`Could not set status to ${status}`, error.message)
    setBrands(prev => prev.map(b => b.id === id ? { ...b, status } : b))
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Loading brands…</p>

  return (
    <>
      <div className="page-header">
        <h2>Brands <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '.85rem' }}>({brands.length})</span></h2>
      </div>

      <div className="panel-section" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
            <thead>
              <tr style={{ background: 'var(--dark3)', textAlign: 'left' }}>
                {['Company','Contact','Email','Status','Joined','Actions'].map(h => (
                  <th key={h} style={{ padding: '.75rem 1rem', color: 'var(--muted)', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {brands.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No brands yet.</td></tr>
              )}
              {brands.map(b => (
                <tr key={b.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '.75rem 1rem', fontWeight: 600 }}>{bp(b)?.company_name || '—'}</td>
                  <td style={{ padding: '.75rem 1rem' }}>{b.full_name || '—'}</td>
                  <td style={{ padding: '.75rem 1rem', color: 'var(--muted)' }}>{b.email}</td>
                  <td style={{ padding: '.75rem 1rem' }}>
                    <span style={{
                      padding: '.2rem .6rem', borderRadius: 100, fontSize: '.72rem', fontWeight: 600,
                      background: b.status === 'approved' ? 'rgba(16,185,129,.12)' : b.status === 'suspended' ? 'rgba(239,68,68,.12)' : 'rgba(245,158,11,.12)',
                      color: b.status === 'approved' ? 'var(--success)' : b.status === 'suspended' ? '#FCA5A5' : 'var(--warning)',
                    }}>{b.status}</span>
                  </td>
                  <td style={{ padding: '.75rem 1rem', color: 'var(--muted)', fontSize: '.78rem' }}>
                    {new Date(b.created_at).toLocaleDateString('en-ZA')}
                  </td>
                  <td style={{ padding: '.75rem 1rem' }}>
                    <div style={{ display: 'flex', gap: '.4rem' }}>
                      {b.status !== 'approved' && (
                        <button onClick={() => setStatus(b.id, 'approved')}
                          style={{ background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.25)', color: 'var(--success)', padding: '.25rem .6rem', borderRadius: 6, cursor: 'pointer', fontSize: '.72rem', fontWeight: 600 }}>
                          Approve
                        </button>
                      )}
                      {b.status !== 'suspended' && (
                        <button onClick={() => setStatus(b.id, 'suspended')}
                          style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', color: '#FCA5A5', padding: '.25rem .6rem', borderRadius: 6, cursor: 'pointer', fontSize: '.72rem' }}>
                          Suspend
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
