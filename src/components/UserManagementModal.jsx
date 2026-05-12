import { useState, useEffect } from 'react';
import RoleBadge from './RoleBadge';
import EditUserModal from './EditUserModal';
import { hasApi, api } from '../api/client';

export default function UserManagementModal({ onClose, isDark, currentUser, onAddMember, clients = [], refreshTrigger = 0 }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkPwdOpen, setBulkPwdOpen] = useState(false);
  const [bulkPwd, setBulkPwd] = useState('Welcome@123');
  const [bulkPwdLoading, setBulkPwdLoading] = useState(false);
  const [bulkPwdResult, setBulkPwdResult] = useState(null);
  const [viewingPwd, setViewingPwd] = useState(null); // { userId, password, loading }


  const fetchUsers = () => {
    if (!hasApi() || !api.users) return;
    setLoading(true);
    api.users().then((data) => setUsers(data.users || [])).catch(() => setUsers([])).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchUsers();
  }, [refreshTrigger]);

  const getClientName = (clientId) => clients.find((c) => c.id === clientId)?.name || '—';
  const getUserName = (userId) => users.find((u) => u.id === userId)?.name || '—';
  const getTeamLeadName = (id) => (id ? getUserName(id) : null);
  const getManagerName = (id) => (id ? getUserName(id) : null);

  const handleDelete = async (u) => {
    if (deleteConfirm !== u.id) {
      setDeleteConfirm(u.id);
      return;
    }
    setDeleting(true);
    try {
      await api.deleteUser(u.id);
      setDeleteConfirm(null);
      fetchUsers();
    } catch (e) {
      setDeleteConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleViewPassword = async (userId) => {
    if (viewingPwd?.userId === userId && viewingPwd?.password) {
      setViewingPwd(null); // Toggle off
      return;
    }
    setViewingPwd({ userId, password: null, loading: true });
    try {
      const data = await api.auth.viewPassword(userId);
      setViewingPwd({ userId, password: data.password || '(not set)', loading: false });
    } catch {
      setViewingPwd({ userId, password: '(error)', loading: false });
    }
  };

  const contentClass = isDark
    ? 'bg-slate-800 border-slate-600 text-white'
    : 'bg-white border-gray-200 text-gray-900';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={`${contentClass} border rounded-xl shadow-xl w-full sm:max-w-lg max-h-[90vh] sm:max-h-[85vh] overflow-hidden flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-inherit flex justify-between items-center flex-shrink-0">
          <h2 className="text-lg font-semibold">User management</h2>
          <div className="flex items-center gap-2">
            {hasApi() && currentUser?.type === 'admin' && (
              <button
                type="button"
                onClick={() => setBulkPwdOpen(true)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700"
              >
                Set Temp Passwords
              </button>
            )}
            {hasApi() && (currentUser?.type === 'admin' || currentUser?.type === 'manager') && onAddMember && (
              <button
                type="button"
                onClick={onAddMember}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-brand hover:bg-brand-hover"
              >
                Add member
              </button>
            )}
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
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading users…</p>}
          {!loading && hasApi() && users.length > 0 && (
            <ul className="space-y-2 text-sm">
              {users.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-inherit p-2">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{u.name}</span>
                    <span className="text-gray-500 dark:text-gray-400 text-xs block mt-0.5">{u.email}</span>
                    <span className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <RoleBadge user={{ name: u.name, role: u.role }} />
                      <span className="text-gray-500 dark:text-gray-400 text-xs">{u.role}</span>
                      <span className="text-gray-500 dark:text-gray-400 text-xs">· {getClientName(u.client_id)}</span>
                      {u.team_lead_id && <span className="text-gray-500 dark:text-gray-400 text-xs">· TL: {u.team_lead_name || getTeamLeadName(u.team_lead_id)}</span>}
                      {u.manager_id && <span className="text-gray-500 dark:text-gray-400 text-xs">· Mgr: {u.manager_name || getManagerName(u.manager_id)}</span>}
                      {u.employee_id && <span className="text-gray-500 dark:text-gray-400 text-xs">· ID: {u.employee_id}</span>}
                      {u.employee_no && !u.employee_id && <span className="text-gray-500 dark:text-gray-400 text-xs">· {u.employee_no}</span>}
                      {u.employment_type && u.employment_type !== 'full_time' && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{u.employment_type.replace('_', ' ')}</span>}
                      {u.designation && <span className="text-gray-500 dark:text-gray-400 text-xs">· {u.designation}</span>}
                      {u.phone && <span className="text-gray-500 dark:text-gray-400 text-xs">· {u.phone}</span>}
                      {u.date_of_birth && <span className="text-gray-500 dark:text-gray-400 text-xs">· DOB: {new Date(String(u.date_of_birth).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                    </span>
                    {/* Password visibility for admin */}
                    {currentUser?.type === 'admin' && u.role !== 'admin' && (
                      <span className="flex items-center gap-1.5 mt-1">
                        <span className="text-gray-500 dark:text-gray-400 text-xs font-medium">Pwd:</span>
                        {viewingPwd?.userId === u.id ? (
                          viewingPwd.loading
                            ? <span className="text-xs text-gray-400">loading...</span>
                            : <span className="text-xs font-mono text-brand">{viewingPwd.password}</span>
                        ) : (
                          <span className="text-xs text-gray-400">••••••••</span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleViewPassword(u.id)}
                          className="text-xs text-brand hover:text-brand-hover font-medium"
                        >
                          {viewingPwd?.userId === u.id && !viewingPwd.loading ? 'Hide' : 'View'}
                        </button>
                      </span>
                    )}
                  </div>
                  {(currentUser?.type === 'admin' || currentUser?.type === 'manager') && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditingUser(u)}
                        className="px-2 py-1 rounded text-xs font-medium border border-inherit hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(u)}
                        disabled={deleting || u.id === currentUser?.id}
                        className={`px-2 py-1 rounded text-xs font-medium ${deleteConfirm === u.id ? 'bg-red-600 text-white' : 'border border-red-400 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'}`}
                      >
                        {deleteConfirm === u.id ? 'Confirm delete?' : 'Delete'}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!loading && (!hasApi() || users.length === 0) && (
            <div className="space-y-4 text-sm">
              <p className="text-gray-600 dark:text-gray-400">
                {hasApi() ? 'No users yet. Add members from the button above.' : 'Connect the API to manage users.'}
              </p>
              {currentUser && (
                <div className="rounded-lg border border-inherit p-3">
                  <p className="font-medium">{currentUser.name}</p>
                  <p className="text-gray-600 dark:text-gray-400">{currentUser.email}</p>
                  <RoleBadge user={currentUser} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={() => { fetchUsers(); setEditingUser(null); }}
          isDark={isDark}
          clients={clients}
        />
      )}
      {/* Bulk Set Temporary Passwords Modal */}
      {bulkPwdOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setBulkPwdOpen(false)}>
          <div className={`${contentClass} border rounded-xl shadow-xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6`} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-3">Set Temporary Passwords</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              This sets a temporary password for <strong>all non-admin employees</strong>. They will be forced to reset their password on first login.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Temporary Password</label>
                <input
                  type="text"
                  value={bulkPwd}
                  onChange={(e) => setBulkPwd(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                  placeholder="e.g. Welcome@123"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Minimum 6 characters. All employees will use this to log in initially.</p>
              </div>
              {bulkPwdResult && (
                <div className={`p-3 rounded-lg text-sm ${bulkPwdResult.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
                  {bulkPwdResult.ok
                    ? `Done! ${bulkPwdResult.updated_count} employee passwords set. They will be prompted to change their password on first login.`
                    : bulkPwdResult.error}
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setBulkPwdOpen(false); setBulkPwdResult(null); }}
                  className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-sm text-gray-700 dark:text-gray-300">
                  {bulkPwdResult?.ok ? 'Close' : 'Cancel'}
                </button>
                {!bulkPwdResult?.ok && (
                  <button type="button" disabled={bulkPwdLoading || bulkPwd.length < 6}
                    onClick={async () => {
                      setBulkPwdLoading(true);
                      setBulkPwdResult(null);
                      try {
                        const result = await api.bulkSetPassword(bulkPwd);
                        setBulkPwdResult(result);
                      } catch (e) {
                        setBulkPwdResult({ ok: false, error: e.message || 'Failed to set passwords' });
                      } finally {
                        setBulkPwdLoading(false);
                      }
                    }}
                    className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium disabled:opacity-50">
                    {bulkPwdLoading ? 'Setting...' : 'Set for All Employees'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
