import React, { useState, useEffect, useCallback } from 'react';

const STATUS_CONFIG = {
  pending_user: { label: 'Pending Employee', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400', dot: 'bg-amber-500' },
  pending_admin: { label: 'Awaiting Admin', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', dot: 'bg-blue-500 animate-pulse' },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400', dot: 'bg-emerald-500' },
};

export default function HRDocumentHub({ isDark, allUsers }) {
  const [entries, setEntries] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [previewNDA, setPreviewNDA] = useState(null);

  const loadEntries = useCallback(() => {
    // Build entries from the allUsers list or localStorage keys
    const userEntries = [];
    const seenIds = new Set();

    // If we have real users from the API, use them
    if (allUsers && allUsers.length > 0) {
      allUsers.forEach(u => {
        const status = localStorage.getItem(`ags_nda_status_${u.id}`) || 'pending_user';
        const userSig = localStorage.getItem(`ags_nda_user_sig_${u.id}`);
        const adminSig = localStorage.getItem(`ags_nda_admin_sig_${u.id}`);
        const signedAt = localStorage.getItem(`ags_nda_signed_at_${u.id}`);
        const adminSignedAt = localStorage.getItem(`ags_nda_admin_signed_at_${u.id}`);
        userEntries.push({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          department: u.department_name || '--',
          nda_status: status,
          userSignature: userSig,
          adminSignature: adminSig,
          signedAt,
          adminSignedAt,
        });
        seenIds.add(u.id);
      });
    }

    // Also pick up any extra entries from localStorage that might not be in allUsers
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('ags_nda_status_')) {
        const userId = key.replace('ags_nda_status_', '');
        if (!seenIds.has(userId)) {
          const status = localStorage.getItem(key);
          const userSig = localStorage.getItem(`ags_nda_user_sig_${userId}`);
          const adminSig = localStorage.getItem(`ags_nda_admin_sig_${userId}`);
          const signedAt = localStorage.getItem(`ags_nda_signed_at_${userId}`);
          const adminSignedAt = localStorage.getItem(`ags_nda_admin_signed_at_${userId}`);
          userEntries.push({
            id: userId,
            name: `User ${userId.slice(0, 8)}`,
            email: '--',
            role: '--',
            department: '--',
            nda_status: status,
            userSignature: userSig,
            adminSignature: adminSig,
            signedAt,
            adminSignedAt,
          });
        }
      }
    }

    setEntries(userEntries);
  }, [allUsers]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const filtered = filterStatus === 'all' ? entries : entries.filter(e => e.nda_status === filterStatus);

  const stats = {
    total: entries.length,
    completed: entries.filter(e => e.nda_status === 'completed').length,
    pending_admin: entries.filter(e => e.nda_status === 'pending_admin').length,
    pending_user: entries.filter(e => e.nda_status === 'pending_user').length,
  };

  const fmtDate = (d) => {
    if (!d) return '--';
    try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return '--'; }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>HR Document Hub</h2>
        <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Track and manage employee NDA status and signed documents.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Employees', value: stats.total, color: 'text-gray-900 dark:text-white', bg: isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200' },
          { label: 'NDAs Completed', value: stats.completed, color: 'text-emerald-600 dark:text-emerald-400', bg: isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200' },
          { label: 'Awaiting Admin', value: stats.pending_admin, color: 'text-blue-600 dark:text-blue-400', bg: isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200' },
          { label: 'Awaiting Employee', value: stats.pending_user, color: 'text-amber-600 dark:text-amber-400', bg: isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200' },
        ].map(stat => (
          <div key={stat.label} className={`rounded-xl border p-4 shadow-sm ${stat.bg}`}>
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[['all', 'All'], ['completed', 'Completed'], ['pending_admin', 'Awaiting Admin'], ['pending_user', 'Awaiting Employee']].map(([val, lbl]) => (
          <button
            key={val}
            onClick={() => setFilterStatus(val)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filterStatus === val
                ? 'bg-brand text-white shadow'
                : isDark
                  ? 'bg-slate-800 border border-slate-700 text-gray-400 hover:bg-slate-700'
                  : 'bg-gray-100 border border-gray-200 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className={`rounded-xl border overflow-hidden shadow-sm ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>No records found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className={`border-b text-xs uppercase font-semibold tracking-wider ${isDark ? 'bg-slate-700/50 text-slate-400 border-slate-700' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                  <th className="px-5 py-3">Employee</th>
                  <th className="px-5 py-3">Department</th>
                  <th className="px-5 py-3">Employee Signed</th>
                  <th className="px-5 py-3">Admin Signed</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-slate-700' : 'divide-gray-100'}`}>
                {filtered.map(entry => {
                  const statusCfg = STATUS_CONFIG[entry.nda_status] || STATUS_CONFIG['pending_user'];
                  return (
                    <tr key={entry.id} className={`transition-colors ${isDark ? 'hover:bg-slate-700/30' : 'hover:bg-gray-50'}`}>
                      <td className="px-5 py-3.5">
                        <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{entry.name}</p>
                        <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{entry.email}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{entry.department}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{fmtDate(entry.signedAt)}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{fmtDate(entry.adminSignedAt)}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusCfg.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                          {statusCfg.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {entry.nda_status === 'completed' && (
                          <button
                            onClick={() => setPreviewNDA(entry)}
                            className="px-3 py-1.5 text-xs font-medium text-brand border border-brand/30 rounded-lg hover:bg-brand/10 transition-colors"
                          >
                            View Signatures
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Preview modal */}
      {previewNDA && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`w-full max-w-xl rounded-2xl shadow-2xl flex flex-col ${isDark ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-gray-200'}`}>
            <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
              <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>NDA Signatures — {previewNDA.name}</h3>
              <button onClick={() => setPreviewNDA(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Employee Signature</p>
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-gray-50 border-gray-200'}`}>
                  {previewNDA.userSignature
                    ? <img src={previewNDA.userSignature} alt="Employee signature" className="h-24 object-contain mx-auto" />
                    : <p className="text-center text-gray-400 text-sm">Not found</p>}
                </div>
              </div>
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Admin Counter-Signature</p>
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-gray-50 border-gray-200'}`}>
                  {previewNDA.adminSignature
                    ? <img src={previewNDA.adminSignature} alt="Admin signature" className="h-24 object-contain mx-auto" />
                    : <p className="text-center text-gray-400 text-sm">Not found</p>}
                </div>
              </div>
            </div>
            <div className={`px-6 py-4 border-t flex justify-end ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
              <button onClick={() => setPreviewNDA(null)} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${isDark ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-200'}`}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
