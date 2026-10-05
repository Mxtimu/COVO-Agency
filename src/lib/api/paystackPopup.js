// Paystack's inline checkout modal.
//
// The script is fetched on demand rather than sitting in index.html: only a
// brand funding a campaign needs it, and every other visitor was otherwise
// paying for it on first load.
//
// Nothing here credits anything. The modal closing is a UI event — the
// escrow balance moves only when Paystack's signed webhook arrives, which is
// what makes a brand pressing Escape, losing their connection, or editing the
// page all equivalent and all harmless.

const SCRIPT_SRC = 'https://js.paystack.co/v2/inline.js'

let loadPromise = null

function loadPaystack() {
  if (window.PaystackPop) return Promise.resolve(window.PaystackPop)
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`)
    const script = existing ?? document.createElement('script')

    script.addEventListener('load', () => {
      window.PaystackPop
        ? resolve(window.PaystackPop)
        : reject(new Error('Paystack loaded but exposed no PaystackPop'))
    })
    script.addEventListener('error', () => {
      // Let the next attempt retry rather than caching the failure forever.
      loadPromise = null
      reject(new Error('Could not load the payment window'))
    })

    if (!existing) {
      script.src = SCRIPT_SRC
      script.async = true
      document.head.appendChild(script)
    }
  })

  return loadPromise
}

/**
 * Opens the Paystack modal for a transaction already initialised server-side.
 *
 * Resolves with 'success' or 'cancelled'. Rejects only if the modal itself
 * could not be opened, so the caller can fall back to the hosted page.
 */
export async function openPaystackModal(accessCode) {
  const PaystackPop = await loadPaystack()

  return new Promise((resolve, reject) => {
    try {
      const popup = new PaystackPop()
      popup.resumeTransaction(accessCode, {
        // Paystack has taken the payment at this point. It has not yet told
        // our webhook, so the caller reports "received" and waits rather than
        // claiming the balance has moved.
        onSuccess: () => resolve('success'),
        onCancel:  () => resolve('cancelled'),
        onError:   (e) => reject(new Error(e?.message ?? 'The payment window failed')),
      })
    } catch (e) {
      reject(e instanceof Error ? e : new Error('Could not open the payment window'))
    }
  })
}
