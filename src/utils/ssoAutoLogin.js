/**
 * SSO Auto-Login for AGS Suite integration.
 *
 * When a user clicks through from the AGS Suite dashboard, the URL contains:
 *   ?suite_token=<JWT>&login_hint=<email>&user_name=<name>&user_role=<role>
 *
 * This module verifies the token against the Suite backend and returns user info
 * so the app can auto-login without showing the login page.
 */

const getSuiteApiUrl = () => {
  if (import.meta.env.VITE_SUITE_API_URL) {
    return import.meta.env.VITE_SUITE_API_URL.trim().replace(/\/$/, '');
  }
  return import.meta.env.DEV
    ? 'http://localhost:3001'
    : 'https://ags-suite-api.vercel.app';
};

const SSO_SESSION_KEY = 'ags_sso_session';

export function getSsoSession() {
  try {
    const raw = localStorage.getItem(SSO_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSsoSession() {
  localStorage.removeItem(SSO_SESSION_KEY);
}

// Capture SSO params ONCE at module load (survives React StrictMode double-mount).
// After first consumption, _pending becomes a resolved/rejected promise that subsequent calls reuse.
let _pending = null;
const _initialParams = new URLSearchParams(window.location.search);
const _initialToken = _initialParams.get('suite_token');

/** True when the module captured a suite_token at load time (before URL cleanup). */
export const hasPendingSso = Boolean(_initialToken);

if (_initialToken) {
  // Clean URL immediately at module level — before React even mounts
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('suite_token');
  cleanUrl.searchParams.delete('login_hint');
  cleanUrl.searchParams.delete('user_name');
  cleanUrl.searchParams.delete('user_role');
  window.history.replaceState({}, '', cleanUrl.pathname + (cleanUrl.search || '') + (cleanUrl.hash || ''));

  // Start verification immediately — cache the promise
  const loginHint = _initialParams.get('login_hint') || '';
  const userName = _initialParams.get('user_name') || '';
  const userRole = _initialParams.get('user_role') || '';

  localStorage.removeItem(SSO_SESSION_KEY);
  try { localStorage.removeItem('ags_user'); localStorage.removeItem('ags_token'); } catch {}

  _pending = (async () => {
    try {
      // Call the Workforce backend's SSO login endpoint.
      // It verifies the Suite token, finds the local user, and issues a local JWT.
      const ssoLoginUrl = (import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')) + '/api/auth/sso-login';
      console.log('[SSO] Calling sso-login at:', ssoLoginUrl);
      let res;
      try {
        res = await fetch(ssoLoginUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suite_token: _initialToken }),
        });
        console.log('[SSO] sso-login response status:', res.status);
      } catch (fetchErr) {
        console.error('[SSO] FETCH NETWORK ERROR:', fetchErr);
        document.title = 'SSO NETWORK ERROR: ' + fetchErr.message;
        return null;
      }

      if (!res.ok) {
        const text = await res.text();
        console.error('[SSO] sso-login failed:', res.status, text);
        document.title = 'SSO FAILED: ' + res.status;
        return null;
      }

      const data = await res.json();
      const v = data.user;
      const token = data.token;

      const user = {
        id: v.id,
        email: v.email || loginHint,
        name: v.name || userName,
        type: v.role || userRole,
        role: v.role || userRole,
        client_id: v.client_id ?? null,
        manager_id: v.manager_id ?? null,
        team_lead_id: v.team_lead_id ?? null,
        date_of_birth: v.date_of_birth ?? null,
        phone: v.phone ?? null,
        designation: v.designation ?? null,
        department_id: v.department_id ?? null,
        department_name: v.department_name ?? null,
        work_timezone: v.work_timezone ?? null,
        work_hours: v.work_hours ?? null,
        _sso: true,
      };

      // Store user and local JWT so the app's API client works
      localStorage.setItem(SSO_SESSION_KEY, JSON.stringify(user));
      localStorage.setItem('ags_user', JSON.stringify(user));
      if (token) localStorage.setItem('ags_token', token);
      return user;
    } catch (err) {
      console.error('[SSO] Auto-login failed:', err.message);
      document.title = 'SSO ERROR: ' + err.message;
      return null;
    }
  })();
}

/**
 * Attempt SSO auto-login. Safe to call multiple times (StrictMode).
 * Returns the same promise if verification is in-flight.
 */
export async function attemptSsoAutoLogin() {
  // If we have a pending verification, always return that (handles StrictMode double-mount)
  if (_pending) {
    return _pending;
  }
  // No SSO params — check for persisted session (page refresh)
  return getSsoSession();
}
