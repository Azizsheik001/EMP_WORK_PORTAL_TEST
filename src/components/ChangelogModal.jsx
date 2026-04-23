import useModalKeyboard from '../hooks/useModalKeyboard';

export default function ChangelogModal({ onClose, isDark }) {
  const modalRef = useModalKeyboard(true, onClose);
  const contentClass = isDark
    ? 'bg-slate-800 border-slate-600 text-white'
    : 'bg-white border-gray-200 text-gray-900';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Changelog">
      <div
        ref={modalRef}
        className={`${contentClass} border rounded-xl shadow-xl w-full sm:max-w-lg max-h-[90vh] sm:max-h-[80vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-inherit flex justify-between items-center">
          <h2 className="text-lg font-semibold">Changelog & Info</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded hover:bg-black/10 dark:hover:bg-white/10 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <p><strong>AGS Workforce</strong> — Employee shift management portal.</p>
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 my-3">
            <p className="font-medium text-amber-800 dark:text-amber-200">Prototype (UI only)</p>
            <p className="text-amber-700 dark:text-amber-300 text-xs mt-1">
              This is a layout prototype. No backend or database is connected; all data is mock and not persisted. Once the UI is approved, backend and database will be built.
            </p>
          </div>
          <p className="text-gray-600 dark:text-gray-400">v2.0.15 — Right panel with brightness, Manage Users, Reset Password, Change Logs, brand green #86bb46, favicon from leftpanel.</p>
          <p className="text-gray-600 dark:text-gray-400">v0.2.0 — Theme toggle, AI Assistant, Employee view, Changelog, User management, Week filter position, Rotational shift normalization.</p>
          <p className="text-gray-600 dark:text-gray-400">v0.1.0 — Initial: All clients, Client-wise, Upload schedules, Shift table, Employee modal, Request leave.</p>
        </div>
      </div>
    </div>
  );
}
