import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api/client';
import ShiftsTable from './ShiftsTable';

const ROLE_BADGES = {
  admin: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-300 dark:border-red-700',
  manager: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-purple-300 dark:border-purple-700',
  team_lead: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-300 dark:border-blue-700',
  employee: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-300 dark:border-green-700',
};

const ROLE_LABELS = {
  admin: 'Admin',
  manager: 'Manager',
  team_lead: 'Team Lead',
  employee: 'Employee',
};

function RoleBadge({ role }) {
  const cls = ROLE_BADGES[role] || ROLE_BADGES.employee;
  const label = ROLE_LABELS[role] || role;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {label}
    </span>
  );
}

function PersonCard({ person, isDark, label }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${isDark ? 'bg-slate-800/60 border-slate-700' : 'bg-white border-gray-200'}`}>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${isDark ? 'bg-slate-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
        {(person.name || '?').charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-medium text-sm truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{person.name}</span>
          <RoleBadge role={person.role || label} />
        </div>
        {person.email && (
          <p className={`text-xs truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{person.email}</p>
        )}
        {person.phone && (
          <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{person.phone}</p>
        )}
      </div>
    </div>
  );
}

function AssignDropdown({ label, value, options, onChange, isDark, disabled = false }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{label}:</span>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className={`text-xs rounded-md border px-2 py-1 ${isDark
          ? 'bg-slate-700 border-slate-600 text-white'
          : 'bg-white border-gray-300 text-gray-900'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <option value="">-- None --</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}

function EmployeeTable({ employees, isDark, allUsers, isAdmin, onMoveEmployee, showToast }) {
  if (!employees || employees.length === 0) {
    return (
      <p className={`text-sm italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No employees</p>
    );
  }

  return (
    <div className={`overflow-x-auto rounded-lg border ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
      <table className="w-full text-left min-w-[500px]">
        <thead>
          <tr className={isDark ? 'bg-slate-800 border-b border-slate-700' : 'bg-gray-50 border-b border-gray-200'}>
            <th className={`px-3 py-2 text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Name</th>
            <th className={`px-3 py-2 text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Role</th>
            <th className={`px-3 py-2 text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Designation</th>
            <th className={`px-3 py-2 text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Team Lead</th>
            <th className={`px-3 py-2 text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Manager</th>
            <th className={`px-3 py-2 text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Status</th>
            {isAdmin && <th className={`px-3 py-2 text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <tr key={emp.id} className={`border-b ${isDark ? 'border-slate-700 hover:bg-slate-800/80' : 'border-gray-100 hover:bg-gray-50'} transition-colors`}>
              <td className={`px-3 py-2 text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{emp.name}</td>
              <td className="px-3 py-2"><RoleBadge role={emp.role} /></td>
              <td className={`px-3 py-2 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{emp.designation || '\u2014'}</td>
              <td className={`px-3 py-2 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{emp.team_lead_name || '\u2014'}</td>
              <td className={`px-3 py-2 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{emp.manager_name || '\u2014'}</td>
              <td className="px-3 py-2">
                {emp.is_active !== false ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />Inactive
                  </span>
                )}
              </td>
              {isAdmin && (
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onMoveEmployee(emp)}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${isDark
                      ? 'border-slate-600 text-gray-300 hover:bg-slate-700'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                    }`}
                    title="Move to different department/client"
                  >
                    Move
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MoveEmployeeModal({ employee, departments, clients, isDark, onClose, onSave }) {
  const [deptId, setDeptId] = useState(employee?.department_id || '');
  const [clientIdVal, setClientIdVal] = useState(employee?.client_id || '');
  const [saving, setSaving] = useState(false);

  const filteredClients = useMemo(() => {
    if (!deptId) return clients;
    return clients.filter((c) => c.department_id === deptId);
  }, [deptId, clients]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateUser(employee.id, {
        department_id: deptId || null,
        client_id: clientIdVal || null,
      });
      onSave();
    } catch (e) {
      alert(e.message || 'Failed to move employee');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className={`w-full max-w-md rounded-xl shadow-xl p-6 ${isDark ? 'bg-slate-800' : 'bg-white'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Move {employee.name}
        </h3>
        <div className="space-y-3">
          <div>
            <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Department</label>
            <select
              value={deptId}
              onChange={(e) => { setDeptId(e.target.value); setClientIdVal(''); }}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
            >
              <option value="">-- None --</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Client</label>
            <select
              value={clientIdVal}
              onChange={(e) => setClientIdVal(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
            >
              <option value="">-- None --</option>
              {filteredClients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand hover:bg-brand/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status, isDark }) {
  if (status === 'logged_in') return <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" title="Logged In" />;
  if (status === 'completed') return <span className="w-2.5 h-2.5 rounded-full bg-blue-400 flex-shrink-0" title="Completed" />;
  if (status === 'auto_logged_out') return <span className="w-2.5 h-2.5 rounded-full bg-orange-500 flex-shrink-0" title="Auto Logged Out (left without clocking out)" />;
  if (status === 'on_leave') return <span className="w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0" title="On Leave" />;
  if (status === 'absent') return <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" title="Absent" />;
  if (status === 'off') return <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isDark ? 'bg-slate-600' : 'bg-gray-300'}`} title="Off / Not Scheduled" />;
  return <span className="w-2.5 h-2.5 rounded-full bg-amber-500 flex-shrink-0" title="Not Logged In" />;
}

function StatusLabel({ status }) {
  const map = {
    logged_in: { text: 'Logged In', cls: 'text-green-600 dark:text-green-400' },
    completed: { text: 'Completed', cls: 'text-blue-500 dark:text-blue-300' },
    auto_logged_out: { text: 'Auto Logged Out', cls: 'text-orange-600 dark:text-orange-400' },
    on_leave: { text: 'On Leave', cls: 'text-blue-600 dark:text-blue-400' },
    absent: { text: 'Absent', cls: 'text-red-600 dark:text-red-400' },
    off: { text: 'Off', cls: 'text-gray-500 dark:text-gray-400' },
    not_logged_in: { text: 'Not Logged In', cls: 'text-amber-600 dark:text-amber-400' },
  };
  const { text, cls } = map[status] || map.not_logged_in;
  return <span className={`text-xs font-medium ${cls}`}>{text}</span>;
}

function MyTeamView({ isDark, currentUser, allUsers, shiftRows, leaveRequests }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const myClientId = currentUser?.client_id;
  const myDeptId = currentUser?.department_id;
  const myId = currentUser?.id;

  // Get teammates: all users returned by the API (backend handles multi-dept filtering), exclude self and admin
  const teammates = useMemo(() => {
    if (!allUsers) return [];
    return allUsers.filter((u) => {
      if (u.id === myId || u.role === 'admin' || u.is_active === false) return false;
      return true;
    });
  }, [allUsers, myId]);

  // Get team lead (may not be in same client_id, look up by team_lead_id from current user's record)
  const myRecord = useMemo(() => allUsers?.find((u) => u.id === myId), [allUsers, myId]);
  const teamLead = useMemo(() => {
    if (!myRecord?.team_lead_id || !allUsers) return null;
    return allUsers.find((u) => u.id === myRecord.team_lead_id) || null;
  }, [allUsers, myRecord]);

  // Get manager: try manager_id, then team lead's manager_id, then fallback to manager in same dept/client
  const manager = useMemo(() => {
    if (!allUsers) return null;
    // 1. Direct manager_id on current user
    if (myRecord?.manager_id) {
      const m = allUsers.find((u) => u.id === myRecord.manager_id);
      if (m) return m;
    }
    // 2. Check if current user appears in any manager's team_lead_ids (via team lead)
    if (teamLead?.manager_id) {
      const m = allUsers.find((u) => u.id === teamLead.manager_id);
      if (m) return m;
    }
    // 3. Fallback: find a manager assigned to the same department (check both department_id and department_ids array)
    return allUsers.find((u) => {
      if (u.id === myId || u.role !== 'manager') return false;
      if (myDeptId) {
        if (u.department_id === myDeptId) return true;
        if (Array.isArray(u.department_ids) && u.department_ids.includes(myDeptId)) return true;
      }
      if (myClientId) {
        if (u.client_id === myClientId) return true;
        if (Array.isArray(u.client_ids) && u.client_ids.includes(myClientId)) return true;
      }
      return false;
    }) || null;
  }, [allUsers, myRecord, myId, myDeptId, myClientId, teamLead]);

  // Build status map from shiftRows
  const statusMap = useMemo(() => {
    const map = {};
    (shiftRows || []).forEach((r) => {
      const uid = r.employeeId || r.id;
      if (r.status === 'current_logged_in') map[uid] = 'logged_in';
      else if (r.status === 'auto_logged_out') map[uid] = 'auto_logged_out';
      else if (r.status === 'completed') map[uid] = 'completed';
      else if (r.status === 'absent') map[uid] = 'absent';
      else if (r.status === 'current_not_logged_in' || r.status === 'not_started') map[uid] = 'not_logged_in';
      else map[uid] = 'off';
    });
    return map;
  }, [shiftRows]);

  // Build on-leave set from leaveRequests
  const onLeaveSet = useMemo(() => {
    const set = new Set();
    (leaveRequests || []).forEach((r) => {
      if (r.status !== 'approved') return;
      const start = String(r.start_date || '').slice(0, 10);
      const end = String(r.end_date || r.start_date || '').slice(0, 10);
      if (start <= today && end >= today) {
        set.add(r.employeeId || r.employee_id);
      }
    });
    return set;
  }, [leaveRequests, today]);

  const getStatus = (userId) => {
    if (onLeaveSet.has(userId)) return 'on_leave';
    if (statusMap[userId]) return statusMap[userId];
    return 'off';
  };

  // Sort: logged_in first, then not_logged_in, on_leave, completed, absent, off
  const statusOrder = { logged_in: 0, not_logged_in: 1, on_leave: 2, completed: 3, absent: 4, off: 5 };
  const sortedTeammates = useMemo(() => {
    return [...teammates].sort((a, b) => {
      const sa = statusOrder[getStatus(a.id)] ?? 6;
      const sb = statusOrder[getStatus(b.id)] ?? 6;
      return sa - sb || (a.name || '').localeCompare(b.name || '');
    });
  }, [teammates, statusMap, onLeaveSet]);

  const counts = useMemo(() => {
    const c = { logged_in: 0, not_logged_in: 0, on_leave: 0, completed: 0, absent: 0, off: 0 };
    sortedTeammates.forEach((t) => { c[getStatus(t.id)]++; });
    return c;
  }, [sortedTeammates, statusMap, onLeaveSet]);

  const card = isDark ? 'bg-slate-800/80 border-slate-700' : 'bg-white border-gray-200';
  const subtleText = isDark ? 'text-gray-400' : 'text-gray-500';

  // Group teammates by department
  const deptGroups = useMemo(() => {
    const groups = {};
    sortedTeammates.forEach((t) => {
      const deptName = t.department_name || 'Unassigned';
      const deptId = t.department_id || 'none';
      if (!groups[deptId]) groups[deptId] = { name: deptName, members: [] };
      groups[deptId].members.push(t);
    });
    return Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));
  }, [sortedTeammates]);

  const hasMultipleDepts = deptGroups.length > 1;

  return (
    <div className="space-y-5 max-w-3xl mx-auto w-full">
      <div>
        <h1 className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{hasMultipleDepts ? 'My Teams' : (deptGroups[0]?.name || 'My Team')}</h1>
        <p className={`text-sm mt-0.5 ${subtleText}`}>{sortedTeammates.length} teammate{sortedTeammates.length !== 1 ? 's' : ''}{hasMultipleDepts ? ` across ${deptGroups.length} departments` : ''}</p>
      </div>

      {/* Status summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Logged In', count: counts.logged_in, color: 'text-green-500', bg: isDark ? 'bg-green-900/20' : 'bg-green-50' },
          { label: 'Not Logged In', count: counts.not_logged_in, color: 'text-amber-500', bg: isDark ? 'bg-amber-900/20' : 'bg-amber-50' },
          { label: 'Completed', count: counts.completed, color: 'text-blue-400', bg: isDark ? 'bg-blue-900/20' : 'bg-blue-50' },
          { label: 'On Leave', count: counts.on_leave, color: 'text-blue-500', bg: isDark ? 'bg-blue-900/20' : 'bg-blue-50' },
          { label: 'Absent', count: counts.absent, color: 'text-red-500', bg: isDark ? 'bg-red-900/20' : 'bg-red-50' },
          { label: 'Off', count: counts.off, color: subtleText, bg: isDark ? 'bg-slate-700/50' : 'bg-gray-50' },
        ].map((s) => (
          <div key={s.label} className={`rounded-lg p-3 text-center ${s.bg}`}>
            <p className={`text-lg font-bold ${s.color}`}>{s.count}</p>
            <p className={`text-[10px] font-medium uppercase tracking-wide ${subtleText}`}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Manager */}
      {manager && (
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>Manager</p>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${isDark ? 'bg-purple-900/30 text-purple-300' : 'bg-purple-50 text-purple-700'}`}>
              {(manager.name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`font-medium text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{manager.name}</p>
              {manager.email && <p className={`text-xs ${subtleText}`}>{manager.email}</p>}
            </div>
            <StatusDot status={getStatus(manager.id)} isDark={isDark} />
            <StatusLabel status={getStatus(manager.id)} />
          </div>
        </div>
      )}

      {/* Team Lead */}
      {teamLead && (
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>Team Lead</p>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${isDark ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-50 text-blue-700'}`}>
              {(teamLead.name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`font-medium text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{teamLead.name}</p>
              {teamLead.email && <p className={`text-xs ${subtleText}`}>{teamLead.email}</p>}
            </div>
            <StatusDot status={getStatus(teamLead.id)} isDark={isDark} />
            <StatusLabel status={getStatus(teamLead.id)} />
          </div>
        </div>
      )}

      {/* Team Members - grouped by department */}
      {deptGroups.map((group) => (
        <div key={group.name} className={`rounded-xl border overflow-hidden ${card}`}>
          <div className={`px-4 py-3 border-b ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between">
              <h2 className={`text-xs font-semibold uppercase tracking-wider ${subtleText}`}>{group.name}</h2>
              <span className={`text-xs ${subtleText}`}>{group.members.length} member{group.members.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          {group.members.length === 0 ? (
            <div className="p-6 text-center">
              <p className={`text-sm ${subtleText}`}>No team members.</p>
            </div>
          ) : (
            <div className={`divide-y ${isDark ? 'divide-slate-700' : 'divide-gray-100'}`}>
              {group.members.map((t) => {
              const st = getStatus(t.id);
              return (
                <div key={t.id} className={`flex items-center gap-3 px-4 py-3 ${isDark ? 'hover:bg-slate-700/40' : 'hover:bg-gray-50'} transition-colors`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${isDark ? 'bg-slate-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                    {(t.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium text-sm truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{t.name}</span>
                      <RoleBadge role={t.role} />
                    </div>
                    {t.designation && <p className={`text-xs ${subtleText}`}>{t.designation}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <StatusDot status={st} isDark={isDark} />
                    <StatusLabel status={st} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      ))}
    </div>
  );
}

export default function TeamView({
  isDark,
  currentUser,
  allUsers,
  showToast,
  clients: propClients,
  departments: propDepartments,
  leaveRequests,
  // ShiftsTable pass-through props
  week,
  clientId: filterClientId,
  searchQuery,
  onEmployeeClick,
  clockedInEmployeeIds,
  clockedInTimes,
  shiftRows,
  apiLoading,
  onRefreshShifts,
  apiError,
  setApiError,
}) {
  const [subTab, setSubTab] = useState('shifts');
  const [hierarchy, setHierarchy] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDept, setSelectedDept] = useState(null); // dept id or 'all'
  const [selectedClient, setSelectedClient] = useState(null); // client id
  const [expandedDepts, setExpandedDepts] = useState({});
  const [moveEmployee, setMoveEmployee] = useState(null);
  const [assigning, setAssigning] = useState(false);

  const isAdmin = currentUser?.type === 'admin';
  const isManager = currentUser?.type === 'manager';
  const isEmployee = currentUser?.type === 'employee';
  const isTeamLead = currentUser?.type === 'team_lead';

  // Employees and team leads get a simplified team view (no department switching)
  if (isEmployee || isTeamLead) {
    return <MyTeamView isDark={isDark} currentUser={currentUser} allUsers={allUsers} shiftRows={shiftRows} leaveRequests={leaveRequests} />;
  }

  const allTeamLeads = useMemo(() => {
    return (allUsers || []).filter((u) => u.role === 'team_lead');
  }, [allUsers]);

  const allManagers = useMemo(() => {
    return (allUsers || []).filter((u) => u.role === 'manager');
  }, [allUsers]);

  const fetchHierarchy = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.teamHierarchy();
      setHierarchy(data.departments || []);
      // Expand all departments by default
      const expanded = {};
      (data.departments || []).forEach((d) => { expanded[d.id || 'null'] = true; });
      setExpandedDepts(expanded);
    } catch (e) {
      if (showToast) showToast(e.message || 'Failed to load team hierarchy', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (subTab === 'hierarchy') {
      fetchHierarchy();
    }
  }, [subTab, fetchHierarchy]);

  const toggleDept = (deptId) => {
    const key = deptId || 'null';
    setExpandedDepts((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSelectDept = (deptId) => {
    setSelectedDept(deptId);
    setSelectedClient(null);
  };

  const handleSelectClient = (deptId, clientId) => {
    setSelectedDept(deptId);
    setSelectedClient(clientId);
  };

  const handleAssignTL = async (clientId, teamLeadId) => {
    setAssigning(true);
    try {
      await api.assignTeamLead({ client_id: clientId, team_lead_id: teamLeadId });
      if (showToast) showToast('Team lead assigned successfully');
      fetchHierarchy();
    } catch (e) {
      if (showToast) showToast(e.message || 'Failed to assign team lead', 'error');
    } finally {
      setAssigning(false);
    }
  };

  const handleAssignManager = async (scope, managerId) => {
    setAssigning(true);
    try {
      await api.assignManager({ ...scope, manager_id: managerId });
      if (showToast) showToast('Manager assigned successfully');
      fetchHierarchy();
    } catch (e) {
      if (showToast) showToast(e.message || 'Failed to assign manager', 'error');
    } finally {
      setAssigning(false);
    }
  };

  const handleMoveEmployee = (emp) => {
    setMoveEmployee(emp);
  };

  const handleMoveSaved = () => {
    setMoveEmployee(null);
    fetchHierarchy();
    if (showToast) showToast('Employee moved successfully');
  };

  // Compute the right panel content based on selection
  const selectedDeptData = useMemo(() => {
    if (!selectedDept) return null;
    return hierarchy.find((d) => (d.id || 'null') === (selectedDept || 'null')) || null;
  }, [hierarchy, selectedDept]);

  const selectedClientData = useMemo(() => {
    if (!selectedClient || !selectedDeptData) return null;
    return selectedDeptData.clients.find((c) => c.id === selectedClient) || null;
  }, [selectedDeptData, selectedClient]);

  // Total employee count per department
  const deptCounts = useMemo(() => {
    const counts = {};
    hierarchy.forEach((dept) => {
      const key = dept.id || 'null';
      let count = (dept.unassigned_employees || []).length;
      (dept.clients || []).forEach((c) => {
        count += (c.employees || []).length;
        if (c.team_lead) count += 1;
      });
      count += (dept.managers || []).length;
      counts[key] = count;
    });
    return counts;
  }, [hierarchy]);

  return (
    <div className="space-y-4">
      {/* Sub-tab toggle */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setSubTab('shifts')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${subTab === 'shifts'
            ? 'bg-brand text-white'
            : isDark ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Shifts
        </button>
        <button
          type="button"
          onClick={() => setSubTab('hierarchy')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${subTab === 'hierarchy'
            ? 'bg-brand text-white'
            : isDark ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Hierarchy
        </button>
      </div>

      {subTab === 'shifts' && (
        <div className="space-y-4">
          {apiError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-red-600 dark:text-red-400">{apiError}</p>
              <button type="button" onClick={() => setApiError && setApiError(null)} className="ml-auto text-red-400 hover:text-red-600 p-0.5" aria-label="Dismiss error">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
          <h1 className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Team Overview</h1>
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Use the filters above to narrow by department, client, or search for employees.</p>
          <ShiftsTable
            week={week}
            clientId={filterClientId}
            searchQuery={searchQuery}
            onEmployeeClick={onEmployeeClick}
            clockedInEmployeeIds={clockedInEmployeeIds}
            clockedInTimes={clockedInTimes}
            shiftRows={shiftRows}
            loading={apiLoading}
            showDepartment={allUsers?.length > 0}
            currentUser={currentUser}
            onRefreshShifts={onRefreshShifts}
          />
        </div>
      )}

      {subTab === 'hierarchy' && (
        <>
          <h1 className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Team Hierarchy</h1>
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Organizational structure grouped by department and client. {isAdmin ? 'As an admin, you can assign team leads, managers, and move employees.' : ''}
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Loading team hierarchy...</p>
              </div>
            </div>
          ) : hierarchy.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <svg className={`w-12 h-12 ${isDark ? 'text-gray-600' : 'text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <p className={`font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>No departments or users found</p>
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Left Panel - Department/Client Tree */}
              <div className={`lg:w-[260px] flex-shrink-0 rounded-xl border ${isDark ? 'bg-slate-800/50 border-slate-700' : 'bg-white border-gray-200'}`}>
                <div className={`px-4 py-3 border-b ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
                  <h2 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>Departments</h2>
                </div>
                <div className="p-2 space-y-1 max-h-[70vh] overflow-y-auto">
                  {/* "All" option */}
                  <button
                    type="button"
                    onClick={() => { setSelectedDept(null); setSelectedClient(null); }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      !selectedDept && !selectedClient
                        ? isDark ? 'bg-brand/20 text-brand' : 'bg-brand/10 text-brand'
                        : isDark ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    All Departments
                  </button>

                  {hierarchy.map((dept) => {
                    const deptKey = dept.id || 'null';
                    const isExpanded = expandedDepts[deptKey];
                    const isDeptSelected = selectedDept === dept.id && !selectedClient;

                    return (
                      <div key={deptKey}>
                        <div className="flex items-center">
                          <button
                            type="button"
                            onClick={() => toggleDept(dept.id)}
                            className={`p-1 rounded transition-colors ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-400 hover:text-gray-600'}`}
                          >
                            <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSelectDept(dept.id)}
                            className={`flex-1 text-left px-2 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-between ${
                              isDeptSelected
                                ? isDark ? 'bg-brand/20 text-brand' : 'bg-brand/10 text-brand'
                                : isDark ? 'text-gray-200 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            <span className="truncate">{dept.name}</span>
                            <span className={`ml-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{deptCounts[deptKey] || 0}</span>
                          </button>
                        </div>

                        {isExpanded && dept.clients.length > 0 && (
                          <div className="ml-6 mt-0.5 space-y-0.5">
                            {dept.clients.map((client) => {
                              const isClientSelected = selectedClient === client.id;
                              const empCount = (client.employees || []).length + (client.team_lead ? 1 : 0);
                              return (
                                <button
                                  key={client.id}
                                  type="button"
                                  onClick={() => handleSelectClient(dept.id, client.id)}
                                  className={`w-full text-left px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center justify-between ${
                                    isClientSelected
                                      ? isDark ? 'bg-brand/20 text-brand' : 'bg-brand/10 text-brand'
                                      : isDark ? 'text-gray-400 hover:bg-slate-700 hover:text-gray-200' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                                  }`}
                                >
                                  <span className="truncate">{client.name}</span>
                                  <span className={`ml-1 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>{empCount}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Panel - Details */}
              <div className="flex-1 min-w-0">
                {/* No selection: show overview */}
                {!selectedDept && !selectedClient && (
                  <div className="space-y-6">
                    {hierarchy.map((dept) => (
                      <div key={dept.id || 'null'} className={`rounded-xl border p-4 ${isDark ? 'bg-slate-800/50 border-slate-700' : 'bg-white border-gray-200'}`}>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className={`text-base font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{dept.name}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? 'bg-slate-700 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                            {deptCounts[dept.id || 'null'] || 0} people
                          </span>
                        </div>

                        {/* Managers */}
                        {dept.managers?.length > 0 && (
                          <div className="mb-3">
                            <p className={`text-xs font-medium mb-1.5 ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>Managers</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {dept.managers.map((m) => (
                                <PersonCard key={m.id} person={m} isDark={isDark} label="manager" />
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Clients summary */}
                        {dept.clients?.length > 0 && (
                          <div className="mb-2">
                            <p className={`text-xs font-medium mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Clients</p>
                            <div className="flex flex-wrap gap-2">
                              {dept.clients.map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => handleSelectClient(dept.id, c.id)}
                                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${isDark
                                    ? 'border-slate-600 text-gray-300 hover:bg-slate-700'
                                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                  }`}
                                >
                                  {c.name}
                                  <span className={`${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                    ({(c.employees || []).length + (c.team_lead ? 1 : 0)})
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Unassigned */}
                        {dept.unassigned_employees?.length > 0 && (
                          <p className={`text-xs mt-2 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                            {dept.unassigned_employees.length} unassigned employee(s)
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Department selected (no client) */}
                {selectedDept && !selectedClient && selectedDeptData && (
                  <div className={`rounded-xl border p-5 ${isDark ? 'bg-slate-800/50 border-slate-700' : 'bg-white border-gray-200'}`}>
                    <h3 className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {selectedDeptData.name}
                    </h3>

                    {/* Managers section */}
                    <div className="mb-5">
                      <div className="flex items-center justify-between mb-2">
                        <p className={`text-sm font-semibold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>Managers</p>
                        {isAdmin && (
                          <AssignDropdown
                            label="Assign Manager"
                            value={selectedDeptData.managers[0]?.id || ''}
                            options={allManagers}
                            onChange={(val) => handleAssignManager({ department_id: selectedDeptData.id }, val)}
                            isDark={isDark}
                            disabled={assigning}
                          />
                        )}
                      </div>
                      {selectedDeptData.managers.length > 0 ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {selectedDeptData.managers.map((m) => (
                            <PersonCard key={m.id} person={m} isDark={isDark} label="manager" />
                          ))}
                        </div>
                      ) : (
                        <p className={`text-sm italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No managers assigned</p>
                      )}
                    </div>

                    {/* Clients in this department */}
                    {selectedDeptData.clients.map((client) => (
                      <div key={client.id} className={`mb-5 p-4 rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-800'}`}>
                            {client.name}
                          </h4>
                          <button
                            type="button"
                            onClick={() => handleSelectClient(selectedDeptData.id, client.id)}
                            className={`text-xs ${isDark ? 'text-brand hover:text-brand/80' : 'text-brand hover:text-brand/80'}`}
                          >
                            View details
                          </button>
                        </div>

                        {/* Team Lead */}
                        <div className="mb-2">
                          <div className="flex items-center justify-between mb-1">
                            <p className={`text-xs font-medium ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>Team Lead</p>
                            {isAdmin && (
                              <AssignDropdown
                                label="Assign TL"
                                value={client.team_lead?.id || ''}
                                options={allTeamLeads}
                                onChange={(val) => handleAssignTL(client.id, val)}
                                isDark={isDark}
                                disabled={assigning}
                              />
                            )}
                          </div>
                          {client.team_lead ? (
                            <PersonCard person={client.team_lead} isDark={isDark} label="team_lead" />
                          ) : (
                            <p className={`text-sm italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No team lead assigned</p>
                          )}
                        </div>

                        <p className={`text-xs mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {(client.employees || []).length} employee(s)
                        </p>
                      </div>
                    ))}

                    {/* Unassigned employees */}
                    {selectedDeptData.unassigned_employees.length > 0 && (
                      <div className="mt-4">
                        <p className={`text-sm font-semibold mb-2 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                          Unassigned Employees ({selectedDeptData.unassigned_employees.length})
                        </p>
                        <EmployeeTable
                          employees={selectedDeptData.unassigned_employees}
                          isDark={isDark}
                          allUsers={allUsers}
                          isAdmin={isAdmin}
                          onMoveEmployee={handleMoveEmployee}
                          showToast={showToast}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Client selected */}
                {selectedClient && selectedClientData && selectedDeptData && (
                  <div className={`rounded-xl border p-5 ${isDark ? 'bg-slate-800/50 border-slate-700' : 'bg-white border-gray-200'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        type="button"
                        onClick={() => { setSelectedClient(null); }}
                        className={`text-xs ${isDark ? 'text-brand hover:text-brand/80' : 'text-brand hover:text-brand/80'}`}
                      >
                        {selectedDeptData.name}
                      </button>
                      <span className={`text-xs ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>/</span>
                    </div>
                    <h3 className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {selectedClientData.name}
                    </h3>

                    {/* Managers (from dept level) */}
                    {selectedDeptData.managers.length > 0 && (
                      <div className="mb-5">
                        <div className="flex items-center justify-between mb-2">
                          <p className={`text-sm font-semibold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>Manager(s)</p>
                          {isAdmin && (
                            <AssignDropdown
                              label="Assign Manager"
                              value={selectedDeptData.managers[0]?.id || ''}
                              options={allManagers}
                              onChange={(val) => handleAssignManager({ client_id: selectedClient }, val)}
                              isDark={isDark}
                              disabled={assigning}
                            />
                          )}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {selectedDeptData.managers.map((m) => (
                            <PersonCard key={m.id} person={m} isDark={isDark} label="manager" />
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedDeptData.managers.length === 0 && isAdmin && (
                      <div className="mb-5">
                        <div className="flex items-center justify-between mb-2">
                          <p className={`text-sm font-semibold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>Manager</p>
                          <AssignDropdown
                            label="Assign Manager"
                            value=""
                            options={allManagers}
                            onChange={(val) => handleAssignManager({ client_id: selectedClient }, val)}
                            isDark={isDark}
                            disabled={assigning}
                          />
                        </div>
                        <p className={`text-sm italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No managers assigned</p>
                      </div>
                    )}

                    {/* Team Lead */}
                    <div className="mb-5">
                      <div className="flex items-center justify-between mb-2">
                        <p className={`text-sm font-semibold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>Team Lead</p>
                        {isAdmin && (
                          <AssignDropdown
                            label="Assign TL"
                            value={selectedClientData.team_lead?.id || ''}
                            options={allTeamLeads}
                            onChange={(val) => handleAssignTL(selectedClient, val)}
                            isDark={isDark}
                            disabled={assigning}
                          />
                        )}
                      </div>
                      {selectedClientData.team_lead ? (
                        <PersonCard person={selectedClientData.team_lead} isDark={isDark} label="team_lead" />
                      ) : (
                        <p className={`text-sm italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No team lead assigned</p>
                      )}
                    </div>

                    {/* Employees */}
                    <div>
                      <p className={`text-sm font-semibold mb-2 ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                        Employees ({(selectedClientData.employees || []).length})
                      </p>
                      <EmployeeTable
                        employees={selectedClientData.employees || []}
                        isDark={isDark}
                        allUsers={allUsers}
                        isAdmin={isAdmin}
                        onMoveEmployee={handleMoveEmployee}
                        showToast={showToast}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Move Employee Modal */}
      {moveEmployee && (
        <MoveEmployeeModal
          employee={moveEmployee}
          departments={propDepartments || []}
          clients={propClients || []}
          isDark={isDark}
          onClose={() => setMoveEmployee(null)}
          onSave={handleMoveSaved}
        />
      )}
    </div>
  );
}
