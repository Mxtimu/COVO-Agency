import { createContext, useContext, useState, useCallback, useRef } from 'react'
import Icon from './Icon'

// Replaces alert() across the admin panels.
//
// alert() blocks the whole page, cannot be styled, looks like a browser
// warning rather than part of COVO, and prefixes everything with
// "localhost says" in development — which is what an admin was reading when
// a payout succeeded.
//
// The variants differ in one way that matters more than colour: whether they
// go away on their own. A success can vanish, because the screen behind it
// already shows the new state. An error or a reference cannot — an admin who
// looks away for four seconds should not lose the Paystack reference for a
// transfer that is now in flight.
const ToastContext = createContext(null)

const AUTO_DISMISS_MS = 4500

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts(list => list.filter(t => t.id !== id))
  }, [])

  const push = useCallback((variant, title, detail) => {
    const id = ++nextId.current
    setToasts(list => [...list, { id, variant, title, detail }])

    // Only success clears itself. Anything the admin may need to read twice,
    // copy, or act on stays until they dismiss it.
    if (variant === 'success') {
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    }
    return id
  }, [dismiss])

  const toast = useRef({
    success: (title, detail) => push('success', title, detail),
    error:   (title, detail) => push('error',   title, detail),
    info:    (title, detail) => push('info',    title, detail),
  }).current

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications">
        {toasts.map(t => (
          <div key={t.id} className={`toast-card toast-${t.variant}`} role={t.variant === 'error' ? 'alert' : 'status'}>
            <span className="toast-mark">
              <Icon name={t.variant === 'success' ? 'verified' : t.variant === 'error' ? 'warning' : 'bell'} size={15} />
            </span>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.detail && <div className="toast-detail">{t.detail}</div>}
            </div>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// Returns a no-op shaped like the real thing when used outside a provider,
// so a panel rendered on its own never crashes on a notification.
const NOOP = { success: () => {}, error: () => {}, info: () => {} }

export function useToast() {
  return useContext(ToastContext) ?? NOOP
}
