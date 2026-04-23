import { useState } from 'react';
import { authenticateUser } from '../data/mockData';
import { hasApi, api, setToken, setStoredUser } from '../api/client';
import { normalizeUser } from '../api/normalize';

// Views: 'login' | 'forgot' | 'reset' | 'force-reset'

export default function LoginPage({ onLogin }) {
  const [view, setView] = useState('login');
  const [pendingToken, setPendingToken] = useState('');
  // For force-reset: we store the JWT + user so we can call change-password then auto-login
  const [forceResetData, setForceResetData] = useState(null);

  const goToReset = (token) => {
    setPendingToken(token || '');
    setView('reset');
  };

  const handleForceReset = (data) => {
    // data = { user, token } from login
    setForceResetData(data);
    setView('force-reset');
  };

  const handleForceResetDone = () => {
    // After password change, auto-login with stored user/token
    if (forceResetData) {
      const normalized = normalizeUser(forceResetData.user);
      setStoredUser(normalized);
      onLogin(normalized);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900 p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <img src="/rightpanel.png" alt="American Green Solutions" className="h-20 w-auto object-contain" />
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border-2 border-gray-300 dark:border-slate-600 p-8">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white text-center mb-1">AGS Workforce Portal</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-3">Workforce Management and Employee Scheduling</p>

          {view === 'login' && <LoginForm onLogin={onLogin} onForgot={() => setView('forgot')} onForceReset={handleForceReset} />}
          {view === 'forgot' && <ForgotPasswordForm onBack={() => setView('login')} onGoToReset={goToReset} />}
          {view === 'reset' && <ResetPasswordForm onBack={() => setView('login')} initialToken={pendingToken} />}
          {view === 'force-reset' && <ForceResetForm onDone={handleForceResetDone} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login Form
// ---------------------------------------------------------------------------
function LoginForm({ onLogin, onForgot, onForceReset }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (hasApi()) {
      setLoading(true);
      try {
        const resp = await api.auth.login(email.trim(), password);
        const { user, token, must_reset_password } = resp;

        // Store the JWT so change-password API can use it
        setToken(token);

        if (must_reset_password) {
          // Show the simple "Set New Password" form
          onForceReset({ user, token });
          return;
        }

        const normalized = normalizeUser(user);
        setStoredUser(normalized);
        onLogin(normalized);
      } catch (err) {
        const isNetworkError = err?.message === 'Failed to fetch' || err?.name === 'TypeError';
        setError(
          isNetworkError
            ? 'Cannot reach server. Make sure the backend is running (e.g. cd backend && npm run dev).'
            : (err.data?.error || err.message || 'Invalid email or password.')
        );
      } finally {
        setLoading(false);
      }
      return;
    }
    const user = authenticateUser(email, password);
    if (user) {
      onLogin(user);
    } else {
      setError('Invalid email or password.');
    }
  };

  return (
    <>
      <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-6">Sign in to continue</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="e.g. admin@libsysinc.com"
            className="w-full rounded-lg border-2 border-gray-400 dark:border-slate-500 bg-gray-50 dark:bg-slate-700 px-3 py-2.5 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-brand focus:border-brand"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            className="w-full rounded-lg border-2 border-gray-400 dark:border-slate-500 bg-gray-50 dark:bg-slate-700 px-3 py-2.5 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-brand focus:border-brand"
          />
        </div>

        {/* Forgot password link */}
        {hasApi() && (
          <div className="text-right">
            <button
              type="button"
              onClick={onForgot}
              className="text-sm text-brand hover:text-brand-hover font-medium hover:underline"
            >
              Forgot password?
            </button>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-lg text-white font-semibold text-base border-2 border-brand-hover shadow-md hover:opacity-90 transition-opacity disabled:opacity-60 bg-brand"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      <p className="mt-6 text-xs text-gray-500 dark:text-gray-400 text-center">
        {hasApi() ? 'Sign in with your account.' : 'Demo: admin@libsysinc.com / admin123 — or any employee email / emp123'}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Force Reset Form — shown after login when must_reset_password is true
// Simple: just new password + confirm. No tokens needed.
// ---------------------------------------------------------------------------
function ForceResetForm({ onDone }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.auth.changePassword(newPassword);
      onDone();
    } catch (err) {
      setError(err.data?.error || err.message || 'Failed to change password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 mb-4">
        <div className="flex items-start gap-2">
          <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Password reset required</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
              Your account has a temporary password. Please set a new password to continue.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="new-pwd" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
            New Password
          </label>
          <input
            id="new-pwd"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="Minimum 6 characters"
            className="w-full rounded-lg border-2 border-gray-400 dark:border-slate-500 bg-gray-50 dark:bg-slate-700 px-3 py-2.5 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-brand focus:border-brand"
          />
        </div>

        <div>
          <label htmlFor="confirm-pwd" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
            Confirm New Password
          </label>
          <input
            id="confirm-pwd"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            className="w-full rounded-lg border-2 border-gray-400 dark:border-slate-500 bg-gray-50 dark:bg-slate-700 px-3 py-2.5 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-brand focus:border-brand"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-lg text-white font-semibold text-base border-2 border-brand-hover shadow-md hover:opacity-90 transition-opacity disabled:opacity-60 bg-brand"
        >
          {loading ? 'Setting password...' : 'Set New Password & Continue'}
        </button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Forgot Password Form
// ---------------------------------------------------------------------------
function ForgotPasswordForm({ onBack, onGoToReset }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResetToken('');
    setLoading(true);
    try {
      const data = await api.auth.forgotPassword(email.trim());
      if (data.reset_token) {
        setResetToken(data.reset_token);
        setExpiresAt(data.expires_at);
      }
    } catch (err) {
      setError(err.data?.error || err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(resetToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.getElementById('reset-token-display');
      if (el) {
        el.select();
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  return (
    <>
      <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-6">
        Enter your email to receive a password reset token
      </p>

      {!resetToken ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="forgot-email" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
              Email address
            </label>
            <input
              id="forgot-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="e.g. admin@libsysinc.com"
              className="w-full rounded-lg border-2 border-gray-400 dark:border-slate-500 bg-gray-50 dark:bg-slate-700 px-3 py-2.5 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-brand focus:border-brand"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg text-white font-semibold text-base border-2 border-brand-hover shadow-md hover:opacity-90 transition-opacity disabled:opacity-60 bg-brand"
          >
            {loading ? 'Sending...' : 'Send Reset Token'}
          </button>

          <button
            type="button"
            onClick={onBack}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Back to login
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="min-w-0">
                <p className="text-sm font-medium text-green-800 dark:text-green-300">Reset token generated</p>
                <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                  Expires at {new Date(expiresAt).toLocaleTimeString()}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              <span className="font-semibold">Development mode:</span> In production, this token would be sent via email. Copy it below to reset your password.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
              Your reset token
            </label>
            <div className="flex gap-2">
              <input
                id="reset-token-display"
                type="text"
                readOnly
                value={resetToken}
                className="flex-1 rounded-lg border-2 border-gray-400 dark:border-slate-500 bg-gray-100 dark:bg-slate-700 px-3 py-2.5 text-gray-900 dark:text-white text-xs font-mono select-all"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-2.5 rounded-lg border-2 border-gray-400 dark:border-slate-500 bg-gray-50 dark:bg-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-500 transition-colors text-sm font-medium flex-shrink-0"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onGoToReset(resetToken)}
            className="w-full py-3 rounded-lg text-white font-semibold text-base border-2 border-brand-hover shadow-md hover:opacity-90 transition-opacity bg-brand"
          >
            Reset Password
          </button>

          <button
            type="button"
            onClick={onBack}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Back to login
          </button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reset Password Form (via token — for Forgot Password flow)
// ---------------------------------------------------------------------------
function ResetPasswordForm({ onBack, initialToken = '' }) {
  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const validate = () => {
    if (!token.trim()) return 'Please enter the reset token.';
    if (newPassword.length < 6) return 'Password must be at least 6 characters.';
    if (newPassword !== confirmPassword) return 'Passwords do not match.';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api.auth.resetPassword(token.trim(), newPassword);
      setSuccess(true);
    } catch (err) {
      setError(err.data?.error || err.message || 'Failed to reset password. The token may be invalid or expired.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <>
        <div className="space-y-4 mt-4">
          <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-300">Password reset successful</p>
                <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                  Your password has been updated. You can now sign in with your new password.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="w-full py-3 rounded-lg text-white font-semibold text-base border-2 border-brand-hover shadow-md hover:opacity-90 transition-opacity bg-brand"
          >
            Back to login
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-6">
        Enter your reset token and choose a new password
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="reset-token" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
            Reset token
          </label>
          <input
            id="reset-token"
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            placeholder="Paste your reset token here"
            autoComplete="off"
            className="w-full rounded-lg border-2 border-gray-400 dark:border-slate-500 bg-gray-50 dark:bg-slate-700 px-3 py-2.5 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-brand focus:border-brand text-xs font-mono"
          />
        </div>

        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="Minimum 6 characters"
            className="w-full rounded-lg border-2 border-gray-400 dark:border-slate-500 bg-gray-50 dark:bg-slate-700 px-3 py-2.5 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-brand focus:border-brand"
          />
        </div>

        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
            Confirm new password
          </label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            className="w-full rounded-lg border-2 border-gray-400 dark:border-slate-500 bg-gray-50 dark:bg-slate-700 px-3 py-2.5 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-brand focus:border-brand"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-lg text-white font-semibold text-base border-2 border-brand-hover shadow-md hover:opacity-90 transition-opacity disabled:opacity-60 bg-brand"
        >
          {loading ? 'Resetting...' : 'Reset Password'}
        </button>

        <button
          type="button"
          onClick={onBack}
          className="w-full py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          Back to login
        </button>
      </form>
    </>
  );
}
