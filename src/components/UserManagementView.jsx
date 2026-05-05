import { useState, useEffect, useMemo, useCallback } from 'react';
import { hasApi, api } from '../api/client';
import RoleBadge from './RoleBadge';

const ROLES = ['admin', 'manager', 'team_lead', 'employee'];
const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', team_lead: 'Team Lead', employee: 'Employee' };
const ITEMS_PER_PAGE = 20;

function StatCard({ label, value, color, isDark }) {
  return (
    <div className={`rounded-xl border p-4 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className={`text-xs font-medium mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{label}</p>
    </div>
  );
}

function SortIcon({ active, direction }) {
  if (!active) return (
    <svg className="w-3.5 h-3.5 text-gray-400 ml-1 opacity-0 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  );
  return (
    <svg className={`w-3.5 h-3.5 ml-1 text-brand transition-transform ${direction === 'desc' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  );
}

export default function UserManagementView({ isDark, currentUser, clients = [], departments = [], showToast, onRefreshUsers, allUsers: externalAllUsers }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);

  // Side panel state
  const [panelMode, setPanelMode] = useState(null); // 'add' | 'edit' | null
  const [editUser, setEditUser] = useState(null);

  // Dept management
  const [deptSectionOpen, setDeptSectionOpen] = useState(false);
  const [localDepts, setLocalDepts] = useState(departments);
  const [newDeptName, setNewDeptName] = useState('');
  const [editingDeptId, setEditingDeptId] = useState(null);
  const [editingDeptName, setEditingDeptName] = useState('');
  const [deptError, setDeptError] = useState('');

  // Client management
  const [clientSectionOpen, setClientSectionOpen] = useState(false);
  const [localClients, setLocalClients] = useState(clients);
  const [newClientName, setNewClientName] = useState('');
  const [editingClientId, setEditingClientId] = useState(null);
  const [editingClientName, setEditingClientName] = useState('');
  const [clientError, setClientError] = useState('');

  // Right slide-out for dept/client management
  const [manageOpen, setManageOpen] = useState(false);

  // Password reset
  const [resetResult, setResetResult] = useState(null);

  // Deactivation confirm
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);

  useEffect(() => { setLocalDepts(departments); }, [departments]);
  useEffect(() => { setLocalClients(clients); }, [clients]);

  const fetchUsers = useCallback(async () => {
    if (!hasApi()) return;
    setLoading(true);
    try {
      const data = await api.usersAll();
      setUsers(data.users || []);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const getClientName = (clientId) => localClients.find((c) => c.id === clientId)?.name || '';
  const getDeptName = (deptId) => localDepts.find((d) => d.id === deptId)?.name || '';
  const getUserName = (userId) => users.find((u) => u.id === userId)?.name || '';

  // Filtering & sorting
  const filteredUsers = useMemo(() => {
    let list = [...users];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((u) => (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.designation || '').toLowerCase().includes(q));
    }
    if (filterRole) list = list.filter((u) => u.role === filterRole);
    if (filterDept) {
      list = list.filter((u) => {
        const ids = Array.isArray(u.department_ids) ? u.department_ids : [];
        if (ids.length > 0) return ids.includes(filterDept);
        return u.department_id === filterDept;
      });
    }
    if (filterClient) {
      // Junction-priority: if the user has any client_ids, only those count.
      // Otherwise fall back to the legacy primary client_id. Without this,
      // a stale primary leaks the user into clients they're no longer
      // assigned to.
      list = list.filter((u) => {
        const ids = Array.isArray(u.client_ids) ? u.client_ids : [];
        if (ids.length > 0) return ids.includes(filterClient);
        return u.client_id === filterClient;
      });
    }
    if (filterStatus === 'active') list = list.filter((u) => u.is_active !== false);
    if (filterStatus === 'inactive') list = list.filter((u) => u.is_active === false);

    list.sort((a, b) => {
      let va, vb;
      switch (sortCol) {
        case 'name': va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); break;
        case 'email': va = (a.email || '').toLowerCase(); vb = (b.email || '').toLowerCase(); break;
        case 'role': va = a.role || ''; vb = b.role || ''; break;
        case 'department': va = getDeptName(a.department_id).toLowerCase(); vb = getDeptName(b.department_id).toLowerCase(); break;
        case 'employee_id': va = (a.employee_id || a.employee_no || '').toLowerCase(); vb = (b.employee_id || b.employee_no || '').toLowerCase(); break;
        case 'client': va = getClientName(a.client_id).toLowerCase(); vb = getClientName(b.client_id).toLowerCase(); break;
        case 'status': va = a.is_active === false ? 1 : 0; vb = b.is_active === false ? 1 : 0; break;
        default: va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase();
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [users, search, filterRole, filterDept, filterClient, filterStatus, sortCol, sortDir, localClients, localDepts]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / ITEMS_PER_PAGE));
  const pagedUsers = filteredUsers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  useEffect(() => { setPage(1); }, [search, filterRole, filterDept, filterClient, filterStatus]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  // Stats
  // "Total Employees" uses the same rule as the Dashboard: active users, excluding admins.
  // "All Users" separately shows the full list count (including admins + inactive).
  const stats = useMemo(() => {
    const allUsers = users.length;
    const active = users.filter((u) => u.is_active !== false).length;
    const inactive = allUsers - active;
    const total = users.filter((u) => u.is_active !== false && u.role !== 'admin').length;
    const byRole = {};
    ROLES.forEach((r) => { byRole[r] = users.filter((u) => u.role === r && u.is_active !== false).length; });
    return { total, allUsers, active, inactive, byRole };
  }, [users]);

  // Toggle active/inactive
  const handleToggleStatus = async (user) => {
    if (user.id === currentUser?.id) { showToast?.('Cannot deactivate yourself', 'error'); return; }
    if (user.is_active === false) {
      try {
        await api.activateUser(user.id);
        showToast?.('User activated');
        fetchUsers();
        onRefreshUsers?.();
      } catch (e) { showToast?.(e.message || 'Failed', 'error'); }
    } else {
      if (confirmDeactivate !== user.id) { setConfirmDeactivate(user.id); return; }
      try {
        await api.deactivateUser(user.id);
        showToast?.('User deactivated');
        setConfirmDeactivate(null);
        fetchUsers();
        onRefreshUsers?.();
      } catch (e) { showToast?.(e.message || 'Failed', 'error'); setConfirmDeactivate(null); }
    }
  };

  // Reset password
  const handleResetPassword = async (user) => {
    try {
      const result = await api.resetUserPassword(user.id);
      setResetResult({ userId: user.id, password: result.temp_password });
      showToast?.(`Temp password set for ${user.name}`);
    } catch (e) { showToast?.(e.message || 'Failed to reset password', 'error'); }
  };

  // Department CRUD
  const handleAddDept = async () => {
    if (!newDeptName.trim()) return;
    setDeptError('');
    try {
      await api.createDepartment(newDeptName.trim());
      setNewDeptName('');
      const d = await api.departments();
      setLocalDepts(d.departments || []);
      showToast?.('Department added');
    } catch (e) { setDeptError(e.data?.error || e.message || 'Failed'); }
  };

  const handleUpdateDept = async (id) => {
    if (!editingDeptName.trim()) return;
    setDeptError('');
    try {
      await api.updateDepartment(id, editingDeptName.trim());
      setEditingDeptId(null);
      setEditingDeptName('');
      const d = await api.departments();
      setLocalDepts(d.departments || []);
      showToast?.('Department updated');
    } catch (e) { setDeptError(e.data?.error || e.message || 'Failed'); }
  };

  const handleDeleteDept = async (id) => {
    setDeptError('');
    try {
      await api.deleteDepartment(id);
      const d = await api.departments();
      setLocalDepts(d.departments || []);
      showToast?.('Department deleted');
    } catch (e) { setDeptError(e.data?.error || e.message || 'Failed'); }
  };

  // Client CRUD
  const handleAddClient = async () => {
    if (!newClientName.trim()) return;
    setClientError('');
    try {
      await api.createClient({ name: newClientName.trim() });
      setNewClientName('');
      const c = await api.clients();
      setLocalClients(c.clients || []);
      showToast?.('Client added');
    } catch (e) { setClientError(e.data?.error || e.message || 'Failed'); }
  };

  const handleUpdateClient = async (id) => {
    if (!editingClientName.trim()) return;
    setClientError('');
    try {
      await api.updateClient(id, { name: editingClientName.trim() });
      setEditingClientId(null);
      setEditingClientName('');
      const c = await api.clients();
      setLocalClients(c.clients || []);
      showToast?.('Client updated');
    } catch (e) { setClientError(e.data?.error || e.message || 'Failed'); }
  };

  const handleDeleteClient = async (id) => {
    setClientError('');
    try {
      await api.deleteClient(id);
      const c = await api.clients();
      setLocalClients(c.clients || []);
      showToast?.('Client deleted');
    } catch (e) { setClientError(e.data?.error || e.message || 'Failed'); }
  };

  const inputClass = isDark
    ? 'bg-slate-700 border-slate-600 text-white rounded-lg px-3 py-2 w-full text-sm border'
    : 'bg-white border-gray-300 text-gray-900 rounded-lg px-3 py-2 w-full text-sm border';
  const selectClass = inputClass;
  const cardClass = isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200';
  const thClass = `px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none group ${isDark ? 'text-gray-400' : 'text-gray-500'}`;
  const tdClass = `px-3 py-3 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`;

  const isAdmin = currentUser?.type === 'admin';

  return (
    <div className="space-y-6">
      {/* Title row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>User Management</h1>
          <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Manage employees, roles, departments, and access</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${isDark ? 'border-slate-600 text-gray-300 hover:bg-slate-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Depts & Clients
            </button>
          )}
          <button
            type="button"
            onClick={() => { setPanelMode('add'); setEditUser(null); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium text-sm transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Employee
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total = all active headcount (incl. admins). Active = non-admin employees only. */}
        <StatCard label="Total Employees" value={stats.active} color="text-brand" isDark={isDark} />
        <StatCard label="Active" value={stats.total} color="text-green-500" isDark={isDark} />
        <StatCard label="Inactive" value={stats.inactive} color="text-red-500" isDark={isDark} />
        <StatCard label="Admins" value={stats.byRole.admin} color={isDark ? 'text-white' : 'text-gray-800'} isDark={isDark} />
        <StatCard label="Managers" value={stats.byRole.manager} color="text-purple-500" isDark={isDark} />
        <StatCard label="Team Leads" value={stats.byRole.team_lead} color="text-brand" isDark={isDark} />
      </div>

      {/* Filters */}
      <div className={`border rounded-xl p-4 ${cardClass}`}>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or designation..."
              className={inputClass + ' pl-9'}
            />
          </div>
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className={selectClass + ' sm:w-36'}>
            <option value="">All Roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className={selectClass + ' sm:w-40'}>
            <option value="">All Departments</option>
            {localDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)} className={selectClass + ' sm:w-40'}>
            <option value="">All Clients</option>
            {localClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={selectClass + ' sm:w-32'}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <p className={`text-xs mt-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{filteredUsers.length} of {users.length} users</p>
      </div>

      {/* Table */}
      <div className={`border rounded-xl overflow-hidden ${cardClass}`}>
        {loading ? (
          <div className="p-8 text-center">
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Loading users...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-full">
              <thead>
                <tr className={isDark ? 'bg-slate-700/50' : 'bg-gray-50'}>
                  {[
                    { id: 'name', label: 'Name' },
                    { id: 'employee_id', label: 'Emp ID' },
                    { id: 'email', label: 'Email' },
                    { id: 'role', label: 'Role' },
                    { id: 'department', label: 'Department' },
                    { id: 'phone', label: 'Phone', sortable: false },
                    { id: 'client', label: 'Client' },
                    { id: 'tl', label: 'Team Lead', sortable: false },
                    { id: 'manager', label: 'Manager', sortable: false },
                    { id: 'status', label: 'Status' },
                    { id: 'actions', label: 'Actions', sortable: false },
                  ].map((col) => (
                    <th
                      key={col.id}
                      className={thClass}
                      onClick={col.sortable !== false ? () => handleSort(col.id) : undefined}
                      style={col.sortable === false ? { cursor: 'default' } : undefined}
                    >
                      <span className="flex items-center">
                        {col.label}
                        {col.sortable !== false && <SortIcon active={sortCol === col.id} direction={sortDir} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-slate-700' : 'divide-gray-100'}`}>
                {pagedUsers.length === 0 && (
                  <tr>
                    <td colSpan={11} className={`px-4 py-12 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      No users match the current filters.
                    </td>
                  </tr>
                )}
                {pagedUsers.map((u) => {
                  const canOpenRow = currentUser?.type === 'admin' || currentUser?.type === 'manager';
                  const openEdit = () => { setEditUser(u); setPanelMode('edit'); };
                  const handleRowKey = (e) => {
                    if (!canOpenRow) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(); }
                  };
                  return (
                  <tr
                    key={u.id}
                    onClick={canOpenRow ? openEdit : undefined}
                    onKeyDown={handleRowKey}
                    role={canOpenRow ? 'button' : undefined}
                    tabIndex={canOpenRow ? 0 : undefined}
                    className={`${isDark ? 'hover:bg-slate-700/30' : 'hover:bg-gray-50/70'} transition-colors ${canOpenRow ? 'cursor-pointer' : ''} ${u.is_active === false ? 'opacity-60' : ''}`}
                  >
                    <td className={tdClass}>
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${u.is_active === false ? 'bg-gray-300 text-gray-600' : 'bg-brand/15 text-brand'}`}>
                          {(u.name || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <span className={`font-medium block ${isDark ? 'text-white' : 'text-gray-900'}`}>{u.name}</span>
                          {u.designation && <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{u.designation}</span>}
                        </div>
                      </div>
                    </td>
                    <td className={tdClass}><span className="font-mono text-xs">{u.employee_id || u.employee_no || <span className="text-gray-400">--</span>}</span></td>
                    <td className={tdClass}>{u.email}</td>
                    <td className={tdClass}>
                      <RoleBadge user={{ name: u.name, role: u.role }} />
                      <span className="ml-1 text-xs">{ROLE_LABELS[u.role] || u.role}</span>
                    </td>
                    <td className={tdClass}>{(() => {
                      const ids = Array.isArray(u.department_ids) ? u.department_ids : [];
                      const list = ids.length > 0 ? ids : (u.department_id ? [u.department_id] : []);
                      const names = list.map(getDeptName).filter(Boolean);
                      return names.length > 0 ? names.join(', ') : <span className="text-gray-400">--</span>;
                    })()}</td>
                    <td className={tdClass}>{u.phone || <span className="text-gray-400">--</span>}</td>
                    <td className={tdClass}>{(() => {
                      // Show every client the user is currently assigned to —
                      // junction first, falling back to the legacy primary
                      // when the user has no junction rows.
                      const ids = Array.isArray(u.client_ids) ? u.client_ids : [];
                      const list = ids.length > 0 ? ids : (u.client_id ? [u.client_id] : []);
                      const names = list.map(getClientName).filter(Boolean);
                      return names.length > 0 ? names.join(', ') : <span className="text-gray-400">--</span>;
                    })()}</td>
                    <td className={tdClass}>{u.team_lead_id ? getUserName(u.team_lead_id) || <span className="text-gray-400">--</span> : <span className="text-gray-400">--</span>}</td>
                    <td className={tdClass}>{u.manager_id ? getUserName(u.manager_id) || <span className="text-gray-400">--</span> : <span className="text-gray-400">--</span>}</td>
                    <td className={tdClass} onClick={(e) => e.stopPropagation()}>
                      {(currentUser?.type === 'admin' || currentUser?.type === 'manager') && u.id !== currentUser?.id ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleToggleStatus(u); }}
                          className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            u.is_active !== false ? 'bg-green-500' : 'bg-gray-300 dark:bg-slate-600'
                          }`}
                          title={u.is_active !== false ? 'Click to deactivate' : 'Click to activate'}
                        >
                          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-in-out ${
                            u.is_active !== false ? 'translate-x-5' : 'translate-x-0'
                          }`} />
                        </button>
                      ) : (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.is_active !== false
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                        }`}>
                          {u.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      )}
                      {confirmDeactivate === u.id && (
                        <div className="mt-1">
                          <span className="text-xs text-red-500 font-medium">Confirm?</span>
                          <button type="button" onClick={(e) => { e.stopPropagation(); handleToggleStatus(u); }} className="ml-1 text-xs text-red-600 font-bold underline">Yes</button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDeactivate(null); }} className="ml-1 text-xs text-gray-500">No</button>
                        </div>
                      )}
                    </td>
                    <td className={tdClass} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        {(currentUser?.type === 'admin' || currentUser?.type === 'manager') && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openEdit(); }}
                            className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${isDark ? 'border-slate-600 hover:bg-slate-700 text-gray-300' : 'border-gray-300 hover:bg-gray-100 text-gray-700'}`}
                          >
                            Edit
                          </button>
                        )}
                        {isAdmin && u.role !== 'admin' && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleResetPassword(u); }}
                            className="px-2 py-1 rounded text-xs font-medium border border-amber-400 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                            title="Reset password"
                          >
                            Reset Pwd
                          </button>
                        )}
                        {resetResult?.userId === u.id && (
                          <span className="text-xs font-mono text-brand bg-brand/10 px-2 py-0.5 rounded">{resetResult.password}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className={`flex items-center justify-between px-4 py-3 border-t ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
            <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Page {page} of {totalPages} ({filteredUsers.length} users)
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className={`px-3 py-1 rounded text-xs font-medium border disabled:opacity-40 ${isDark ? 'border-slate-600 text-gray-300 hover:bg-slate-700' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
              >
                Previous
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum;
                if (totalPages <= 7) pageNum = i + 1;
                else if (page <= 4) pageNum = i + 1;
                else if (page >= totalPages - 3) pageNum = totalPages - 6 + i;
                else pageNum = page - 3 + i;
                return (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setPage(pageNum)}
                    className={`px-2.5 py-1 rounded text-xs font-medium ${
                      page === pageNum
                        ? 'bg-brand text-white'
                        : isDark ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                className={`px-3 py-1 rounded text-xs font-medium border disabled:opacity-40 ${isDark ? 'border-slate-600 text-gray-300 hover:bg-slate-700' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Slide-out Panel for Departments & Clients */}
      {manageOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setManageOpen(false)}>
          <div className="absolute inset-0 bg-black/30" aria-hidden="true" />
          <div
            className={`relative w-full max-w-md shadow-2xl flex flex-col max-h-full overflow-y-auto ${isDark ? 'bg-slate-800' : 'bg-white'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Panel header */}
            <div className={`p-5 border-b flex items-center justify-between flex-shrink-0 ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
              <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Departments & Clients</h2>
              <button type="button" onClick={() => setManageOpen(false)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-slate-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-5 space-y-6 flex-1 overflow-y-auto">
              {/* Department Management */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-4 h-4 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                  <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Departments ({localDepts.length})</h3>
                </div>
                {deptError && <p className="text-sm text-red-500 mb-2">{deptError}</p>}
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    placeholder="New department name"
                    className={inputClass}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddDept(); }}
                  />
                  <button type="button" onClick={handleAddDept} className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium whitespace-nowrap">
                    Add
                  </button>
                </div>
                <div className="space-y-1.5">
                  {localDepts.map((dept) => (
                    <div key={dept.id} className={`flex items-center gap-2 rounded-lg px-3 py-2.5 ${isDark ? 'bg-slate-700/50' : 'bg-gray-50'}`}>
                      {editingDeptId === dept.id ? (
                        <>
                          <input
                            type="text"
                            value={editingDeptName}
                            onChange={(e) => setEditingDeptName(e.target.value)}
                            className={inputClass}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateDept(dept.id); if (e.key === 'Escape') setEditingDeptId(null); }}
                            autoFocus
                          />
                          <button type="button" onClick={() => handleUpdateDept(dept.id)} className="text-xs text-brand font-medium">Save</button>
                          <button type="button" onClick={() => setEditingDeptId(null)} className="text-xs text-gray-500">Cancel</button>
                        </>
                      ) : (
                        <>
                          <span className={`flex-1 text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{dept.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${isDark ? 'bg-slate-600 text-gray-400' : 'bg-gray-200 text-gray-500'}`}>
                            {users.filter((u) => u.department_id === dept.id && u.is_active !== false).length}
                          </span>
                          <button type="button" onClick={() => { setEditingDeptId(dept.id); setEditingDeptName(dept.name); }} className="text-xs text-brand hover:underline flex-shrink-0">Edit</button>
                          <button type="button" onClick={() => handleDeleteDept(dept.id)} className="text-xs text-red-500 hover:underline flex-shrink-0">Delete</button>
                        </>
                      )}
                    </div>
                  ))}
                  {localDepts.length === 0 && <p className={`text-sm italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No departments yet.</p>}
                </div>
              </div>

              <hr className={isDark ? 'border-slate-700' : 'border-gray-200'} />

              {/* Client Management */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Clients ({localClients.length})</h3>
                </div>
                {clientError && <p className="text-sm text-red-500 mb-2">{clientError}</p>}
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="New client name"
                    className={inputClass}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddClient(); }}
                  />
                  <button type="button" onClick={handleAddClient} className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium whitespace-nowrap">
                    Add
                  </button>
                </div>
                <div className="space-y-1.5">
                  {localClients.map((client) => (
                    <div key={client.id} className={`flex items-center gap-2 rounded-lg px-3 py-2.5 ${isDark ? 'bg-slate-700/50' : 'bg-gray-50'}`}>
                      {editingClientId === client.id ? (
                        <>
                          <input
                            type="text"
                            value={editingClientName}
                            onChange={(e) => setEditingClientName(e.target.value)}
                            className={inputClass}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateClient(client.id); if (e.key === 'Escape') setEditingClientId(null); }}
                            autoFocus
                          />
                          <button type="button" onClick={() => handleUpdateClient(client.id)} className="text-xs text-brand font-medium">Save</button>
                          <button type="button" onClick={() => setEditingClientId(null)} className="text-xs text-gray-500">Cancel</button>
                        </>
                      ) : (
                        <>
                          <span className={`flex-1 text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{client.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${isDark ? 'bg-slate-600 text-gray-400' : 'bg-gray-200 text-gray-500'}`}>
                            {users.filter((u) => {
                              if (u.is_active === false) return false;
                              const ids = Array.isArray(u.client_ids) ? u.client_ids : [];
                              if (ids.length > 0) return ids.includes(client.id);
                              return u.client_id === client.id;
                            }).length}
                          </span>
                          <button type="button" onClick={() => { setEditingClientId(client.id); setEditingClientName(client.name); }} className="text-xs text-brand hover:underline flex-shrink-0">Edit</button>
                          <button type="button" onClick={() => handleDeleteClient(client.id)} className="text-xs text-red-500 hover:underline flex-shrink-0">Delete</button>
                        </>
                      )}
                    </div>
                  ))}
                  {localClients.length === 0 && <p className={`text-sm italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No clients yet.</p>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slide-out Panel for Add/Edit */}
      {panelMode && (
        <UserFormPanel
          mode={panelMode}
          user={editUser}
          isDark={isDark}
          clients={localClients}
          departments={localDepts}
          allUsers={users}
          onClose={() => { setPanelMode(null); setEditUser(null); }}
          onSaved={() => {
            setPanelMode(null);
            setEditUser(null);
            fetchUsers();
            onRefreshUsers?.();
            showToast?.(panelMode === 'add' ? 'Employee added' : 'Employee updated');
          }}
        />
      )}
    </div>
  );
}


/* ── Slide-out Panel for Add/Edit ──────────────────── */
function UserFormPanel({ mode, user, isDark, clients, departments, allUsers, onClose, onSaved }) {
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(user?.role || 'employee');
  const [departmentIds, setDepartmentIds] = useState(user?.department_id ? [user.department_id] : []);
  const [clientIds, setClientIds] = useState(user?.client_id ? [user.client_id] : []);
  const [teamLeadIds, setTeamLeadIds] = useState(user?.team_lead_id ? [user.team_lead_id] : []);
  const [managerIds, setManagerIds] = useState(user?.manager_id ? [user.manager_id] : []);
  const [dateOfBirth, setDateOfBirth] = useState(user?.date_of_birth ? String(user.date_of_birth).slice(0, 10) : '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [designation, setDesignation] = useState(user?.designation || '');
  // Legacy rows stored the ID in `employee_no`; newer edits write to `employee_id`.
  // Accept whichever is populated so the form reflects what's actually in the DB.
  const [employeeId, setEmployeeId] = useState(user?.employee_id || user?.employee_no || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setRole(user.role || 'employee');
      setDateOfBirth(user.date_of_birth ? String(user.date_of_birth).slice(0, 10) : '');
      setPhone(user.phone || '');
      setDesignation(user.designation || '');
      setEmployeeId(user.employee_id || user.employee_no || '');
      setPassword('');
      // Fetch multi-assignments for this user
      api.getUserMultiAssignments().then((data) => {
        const uid = user.id;
        setDepartmentIds((data.user_departments || []).filter((r) => r.user_id === uid).map((r) => r.department_id));
        setClientIds((data.user_clients || []).filter((r) => r.user_id === uid).map((r) => r.client_id));
        setManagerIds((data.user_managers || []).filter((r) => r.user_id === uid).map((r) => r.manager_id));
        setTeamLeadIds((data.user_team_leads || []).filter((r) => r.user_id === uid).map((r) => r.team_lead_id));
      }).catch(() => {
        setDepartmentIds(user.department_id ? [user.department_id] : []);
        setClientIds(user.client_id ? [user.client_id] : []);
        setManagerIds(user.manager_id ? [user.manager_id] : []);
        setTeamLeadIds(user.team_lead_id ? [user.team_lead_id] : []);
      });
    } else {
      setName(''); setEmail(''); setPassword(''); setRole('employee');
      setDepartmentIds([]); setClientIds([]); setTeamLeadIds([]); setManagerIds([]);
      setDateOfBirth(''); setPhone(''); setDesignation(''); setEmployeeId('');
    }
  }, [user]);

  const teamLeads = allUsers.filter((u) => u.role === 'team_lead' && u.id !== user?.id && u.is_active !== false);
  const managers = allUsers.filter((u) => u.role === 'manager' && u.id !== user?.id && u.is_active !== false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (mode === 'add') {
        if (password.length < 6) { setError('Password must be at least 6 characters'); setSaving(false); return; }
        const created = await api.createUser({
          email: email.trim(),
          password,
          name: name.trim(),
          role,
          client_id: clientIds[0] || null,
          manager_id: managerIds[0] || null,
          team_lead_id: teamLeadIds[0] || null,
          department_id: departmentIds[0] || null,
          phone: phone.trim() || null,
          designation: designation.trim() || null,
          employee_id: employeeId.trim() || null,
        });
        if (created?.id) {
          try { await api.saveUserMultiAssignments(created.id, { department_ids: departmentIds, client_ids: clientIds, manager_ids: managerIds, team_lead_ids: teamLeadIds }); } catch (_) {}
        }
      } else {
        const body = {
          email: email.trim(),
          name: name.trim(),
          role,
          client_id: clientIds[0] || null,
          department_id: departmentIds[0] || null,
          team_lead_id: teamLeadIds[0] || null,
          manager_id: managerIds[0] || null,
          date_of_birth: (dateOfBirth.trim() && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth.trim())) ? dateOfBirth.trim() : null,
          phone: phone.trim() || null,
          designation: designation.trim() || null,
          employee_id: employeeId.trim() || null,
        };
        if (password.trim().length >= 6) body.password = password;
        await api.updateUser(user.id, body);
        await api.saveUserMultiAssignments(user.id, { department_ids: departmentIds, client_ids: clientIds, manager_ids: managerIds, team_lead_ids: teamLeadIds });
      }
      onSaved();
    } catch (err) {
      const raw = err.data?.error;
      const msg = Array.isArray(raw)
        ? raw.map((e) => `${(e.path || []).join('.')}: ${e.message}`).join(', ')
        : (typeof raw === 'string' ? raw : err.message || 'Failed');
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const inputClass = isDark
    ? 'bg-slate-700 border-slate-600 text-white rounded-lg px-3 py-2 w-full text-sm border'
    : 'bg-white border-gray-300 text-gray-900 rounded-lg px-3 py-2 w-full text-sm border';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" aria-hidden="true" />
      <div
        className={`relative w-full max-w-lg shadow-2xl flex flex-col max-h-full overflow-y-auto ${isDark ? 'bg-slate-800' : 'bg-white'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Panel header */}
        <div className={`p-5 border-b flex items-center justify-between flex-shrink-0 ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
          <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {mode === 'add' ? 'Add New Employee' : `Edit: ${user?.name}`}
          </h2>
          <button type="button" onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-slate-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Full Name *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} placeholder="John Doe" />
            </div>
            <div className="sm:col-span-2">
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Email *</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} placeholder="john@example.com" />
            </div>
            <div className="sm:col-span-2">
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {mode === 'add' ? 'Password *' : 'New Password (leave blank to keep current)'}
              </label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder={mode === 'add' ? 'Min 6 characters' : 'Leave blank to keep current'} minLength={mode === 'add' ? 6 : undefined} />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Role *</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Departments</label>
              <div className={`border rounded-lg max-h-28 overflow-y-auto p-2 ${isDark ? 'border-slate-600 bg-slate-700' : 'border-gray-300 bg-gray-50'}`}>
                {departments.length === 0 && <p className="text-xs text-gray-400">No departments</p>}
                {departments.map((d) => (
                  <label key={d.id} className={`flex items-center gap-2 py-0.5 text-sm cursor-pointer ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    <input type="checkbox" checked={departmentIds.includes(d.id)} onChange={(e) => { if (e.target.checked) setDepartmentIds(p => [...p, d.id]); else setDepartmentIds(p => p.filter(x => x !== d.id)); }} className="rounded" />
                    {d.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Clients</label>
              <div className={`border rounded-lg max-h-28 overflow-y-auto p-2 ${isDark ? 'border-slate-600 bg-slate-700' : 'border-gray-300 bg-gray-50'}`}>
                {clients.length === 0 && <p className="text-xs text-gray-400">No clients</p>}
                {clients.map((c) => (
                  <label key={c.id} className={`flex items-center gap-2 py-0.5 text-sm cursor-pointer ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    <input type="checkbox" checked={clientIds.includes(c.id)} onChange={(e) => { if (e.target.checked) setClientIds(p => [...p, c.id]); else setClientIds(p => p.filter(x => x !== c.id)); }} className="rounded" />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Team Leads</label>
              <div className={`border rounded-lg max-h-28 overflow-y-auto p-2 ${isDark ? 'border-slate-600 bg-slate-700' : 'border-gray-300 bg-gray-50'}`}>
                {teamLeads.length === 0 && <p className="text-xs text-gray-400">No team leads</p>}
                {teamLeads.map((u) => (
                  <label key={u.id} className={`flex items-center gap-2 py-0.5 text-sm cursor-pointer ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    <input type="checkbox" checked={teamLeadIds.includes(u.id)} onChange={(e) => { if (e.target.checked) setTeamLeadIds(p => [...p, u.id]); else setTeamLeadIds(p => p.filter(x => x !== u.id)); }} className="rounded" />
                    {u.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Managers</label>
              <div className={`border rounded-lg max-h-28 overflow-y-auto p-2 ${isDark ? 'border-slate-600 bg-slate-700' : 'border-gray-300 bg-gray-50'}`}>
                {managers.length === 0 && <p className="text-xs text-gray-400">No managers</p>}
                {managers.map((u) => (
                  <label key={u.id} className={`flex items-center gap-2 py-0.5 text-sm cursor-pointer ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    <input type="checkbox" checked={managerIds.includes(u.id)} onChange={(e) => { if (e.target.checked) setManagerIds(p => [...p, u.id]); else setManagerIds(p => p.filter(x => x !== u.id)); }} className="rounded" />
                    {u.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Employee ID</label>
              <input type="text" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputClass} placeholder="e.g. AMGS-042" />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Designation</label>
              <input type="text" value={designation} onChange={(e) => setDesignation(e.target.value)} className={inputClass} placeholder="e.g. Field Technician" />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Phone</label>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="+1 234 567 8900" />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Date of Birth</label>
              <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={inputClass} />
            </div>
          </div>

          {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{typeof error === 'string' ? error : JSON.stringify(error)}</p>}
        </form>

        {/* Panel footer */}
        <div className={`p-5 border-t flex gap-3 flex-shrink-0 ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
          <button type="button" onClick={onClose} className={`px-4 py-2.5 rounded-lg border text-sm font-medium ${isDark ? 'border-slate-600 text-gray-300 hover:bg-slate-700' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            onClick={handleSubmit}
            className="px-6 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : mode === 'add' ? 'Add Employee' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
