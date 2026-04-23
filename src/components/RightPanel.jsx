import { useState, useEffect } from 'react';
import useModalKeyboard from '../hooks/useModalKeyboard';

const APP_VERSION = 'v2.0.15';

export default function RightPanel({
  isOpen,
  onClose,
  isDark,
  currentUser,
  onThemeToggle,
  onChangelogClick,
  onUserManagementClick,
  onAddClientClick,
  onLogout,
  onNavigate,
}) {
  const [brightness, setBrightness] = useState(isDark ? 40 : 100);
  const modalRef = useModalKeyboard(isOpen, onClose);

  useEffect(() => {
    if (isOpen) setBrightness(isDark ? 40 : 100);
  }, [isOpen, isDark]);

  const handleBrightnessChange = (e) => {
    const v = Number(e.target.value);
    setBrightness(v);
    if (v < 50) onThemeToggle(true);
    else onThemeToggle(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-label="Settings panel">
      <div
        ref={modalRef}
        className="w-full max-w-sm bg-white dark:bg-slate-800 border-l border-gray-200 dark:border-slate-700 shadow-xl flex flex-col max-h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-gray-400"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 flex flex-col items-center border-b border-gray-200 dark:border-slate-700">
          <div className="w-20 h-20 rounded-full border-2 border-brand overflow-hidden flex items-center justify-center bg-gray-50 dark:bg-slate-700">
            <img src="/rightpanel.png" alt="Logo" className="w-14 h-14 object-contain" />
          </div>
          <p className="mt-3 font-semibold text-gray-900 dark:text-white">{currentUser?.name ?? 'Guest'}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">{currentUser?.email ?? ''}</p>
          <p className="text-sm font-medium mt-1 text-brand">{currentUser?.role ?? ''}</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {currentUser?.type !== 'employee' && (
          <button
            type="button"
            onClick={() => { if (onNavigate) { onNavigate('user-management'); } else { onUserManagementClick(); } onClose(); }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <span>Manage Users</span>
          </button>
          )}
          {onAddClientClick && (
            <button
              type="button"
              onClick={() => { onAddClientClick(); onClose(); }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span>Add client</span>
            </button>
          )}
          {currentUser?.type !== 'employee' && (
          <button
            type="button"
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
            onClick={() => { if (onNavigate) { onNavigate('user-management'); } onClose(); }}
          >
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Reset Password</span>
          </button>
          )}
          <button
            type="button"
            onClick={() => { onChangelogClick(); onClose(); }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Change Logs</span>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-slate-600 px-2 py-0.5 rounded">
              {APP_VERSION}
            </span>
          </button>

          <div className="pt-4 mt-4 border-t border-gray-200 dark:border-slate-700">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Brightness</p>
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              <input
                type="range"
                min="0"
                max="100"
                value={brightness}
                onChange={handleBrightnessChange}
                className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-200 dark:bg-slate-600 accent-brand"
              />
              <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {brightness < 50 ? 'Dark mode' : 'Light mode'}
            </p>
          </div>
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => { onLogout(); onClose(); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
          >
            <span>Logout</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
