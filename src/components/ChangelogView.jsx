export default function ChangelogView({ isDark }) {
  const contentClass = isDark
    ? 'bg-slate-800 border-slate-700 text-white'
    : 'bg-white border-gray-200 text-gray-900';

  return (
    <div className={`p-6 sm:p-8 rounded-xl border shadow-sm ${contentClass} max-w-4xl mx-auto`}>
      <h2 className="text-2xl font-bold mb-6">Changelog & Info</h2>
      
      <div className="space-y-4 text-base">
        <p><strong>AGS Workforce</strong> — Employee shift management portal.</p>
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 my-4">
          <p className="font-medium text-amber-800 dark:text-amber-200">Prototype (UI only)</p>
          <p className="text-amber-700 dark:text-amber-300 text-sm mt-1">
            This is a layout prototype. No backend or database is connected; all data is mock and not persisted. Once the UI is approved, backend and database will be built.
          </p>
        </div>
        
        <div className="mt-8 space-y-6">
          <div>
            <h3 className="font-semibold text-lg mb-2 border-b pb-1 dark:border-slate-700">v2.0.15</h3>
            <p className="text-gray-600 dark:text-gray-400">Right panel with brightness, Manage Users, Reset Password, Change Logs, brand green #86bb46, favicon from leftpanel.</p>
          </div>
          <div>
            <h3 className="font-semibold text-lg mb-2 border-b pb-1 dark:border-slate-700">v0.2.0</h3>
            <p className="text-gray-600 dark:text-gray-400">Theme toggle, AI Assistant, Employee view, Changelog, User management, Week filter position, Rotational shift normalization.</p>
          </div>
          <div>
            <h3 className="font-semibold text-lg mb-2 border-b pb-1 dark:border-slate-700">v0.1.0</h3>
            <p className="text-gray-600 dark:text-gray-400">Initial: All clients, Client-wise, Upload schedules, Shift table, Employee modal, Request leave.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
