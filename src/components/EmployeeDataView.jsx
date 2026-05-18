import { useState, useEffect, useCallback } from 'react';
import { api, hasApi } from '../api/client';
import EmployeeDataEditModal from './EmployeeDataEditModal';

function fmt(name) {
  if (!name) return '';
  return String(name).toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function InfoRow({ label, value, accent }) {
  return (
    <div className="flex items-start justify-between gap-2 py-2 border-b border-inherit last:border-0">
      <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 w-28">{label}</span>
      <span className={`text-xs font-medium text-right ${accent || 'text-gray-800 dark:text-gray-200'}`}>
        {value ?? <span className="text-gray-400">—</span>}
      </span>
    </div>
  );
}

function StatPill({ label, value, color }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl p-3 ${color}`}>
      <span className="text-2xl font-bold leading-none">{value ?? '—'}</span>
      <span className="text-[10px] font-medium mt-1 uppercase tracking-wider opacity-80">{label}</span>
    </div>
  );
}

const ROLE_COLORS = {
  admin: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  manager: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  team_lead: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  employee: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', team_lead: 'Team Lead', employee: 'Employee' };

export default function EmployeeDataView({ isDark, currentUser }) {
  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [profile, setProfile] = useState(null);
  const [balance, setBalance] = useState(null);
  const [assets, setAssets] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  const isAdmin = currentUser?.type === 'admin' || currentUser?.role === 'admin' || currentUser?.role === 'manager';

  // Fetch user list
  useEffect(() => {
    if (!hasApi()) return;
    setLoadingUsers(true);
    api.usersAll()
      .then(d => setUsers(d.users || []))
      .catch(() => setUsers([]))
      .finally(() => setLoadingUsers(false));
  }, []);

  const loadProfile = useCallback(async (userId) => {
    if (!userId || !hasApi()) return;
    setLoading(true);
    setProfile(null); setBalance(null); setAssets([]); setShifts([]);
    try {
      const u = users.find(u => u.id === userId) || null;
      setProfile(u);

      // Leave balance
      try {
        const bal = await api.leaveRequests.balance(userId, new Date().getFullYear());
        setBalance(bal);
      } catch {}

      // Assets assigned to user
      try {
        const assetData = await api.assets.list({ assigned_to: userId });
        setAssets(assetData.assets || []);
      } catch {}

      // Recent shifts (last 30 days)
      try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const from = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const sd = await api.shifts({ from, to: today });
        const mine = (sd.shifts || []).filter(s => s.user_id === userId);
        setShifts(mine);
      } catch {}
    } finally {
      setLoading(false);
    }
  }, [users]);

  useEffect(() => {
    if (selectedId) loadProfile(selectedId);
    else { setProfile(null); setBalance(null); setAssets([]); setShifts([]); }
  }, [selectedId, loadProfile]);

  const cardClass = isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-gray-200 text-gray-900';
  const subCard = isDark ? 'bg-slate-700/50 border-slate-600' : 'bg-gray-50 border-gray-200';

  // Compute attendance summary from shifts
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const present = shifts.filter(s => s.clock_in_at && s.shift_date <= today).length;
  const absent = shifts.filter(s => !s.clock_in_at && !s.is_off && s.shift_date < today).length;
  const offDays = shifts.filter(s => s.is_off).length;

  return (
    <div className="space-y-6 w-full h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Employee Data</h1>
          <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Full profile, leave balances, assets &amp; attendance for any employee
          </p>
        </div>
      </div>

      {/* User Selector */}
      <div className={`rounded-2xl border p-5 ${cardClass}`}>
        <label className="block text-sm font-semibold mb-2">Select Employee</label>
        {loadingUsers ? (
          <div className={`h-10 rounded-lg animate-pulse ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`} />
        ) : (
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className={`w-full rounded-xl px-4 py-2.5 text-sm border focus:outline-none focus:ring-2 focus:ring-brand/50 transition-all ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
          >
            <option value="">— Choose an employee —</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{fmt(u.name)} ({ROLE_LABELS[u.role] || u.role})</option>
            ))}
          </select>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className={`h-40 rounded-2xl animate-pulse ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`} />
          ))}
        </div>
      )}

      {/* Profile loaded */}
      {!loading && profile && (
        <div className="space-y-5">
          {/* Identity Banner */}
          <div className={`rounded-2xl border p-6 ${cardClass}`}>
            <div className="flex flex-col sm:flex-row items-start gap-5">
              {/* Avatar */}
              <div className={`w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-extrabold flex-shrink-0 shadow-lg ${
                profile.is_active === false
                  ? 'bg-gray-300 text-gray-600'
                  : 'bg-gradient-to-br from-brand/80 to-brand text-white'
              }`}>
                {(profile.name || '?')[0].toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h2 className="text-xl font-bold">{fmt(profile.name)}</h2>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[profile.role] || 'bg-gray-100 text-gray-700'}`}>
                    {ROLE_LABELS[profile.role] || profile.role}
                  </span>
                  {profile.is_active === false && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                      Inactive
                    </span>
                  )}
                  {isAdmin && (
                    <button 
                      onClick={() => setIsEditing(true)}
                      className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      Edit Data
                    </button>
                  )}
                </div>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{profile.email}</p>
                {profile.designation && (
                  <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{profile.designation}</p>
                )}
              </div>

              {/* Quick ID chips */}
              <div className="flex flex-col gap-1.5 text-right">
                {profile.employee_id && (
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-medium border ${isDark ? 'border-slate-600 bg-slate-700 text-gray-300' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
                    ID: {profile.employee_id}
                  </span>
                )}
                {profile.department_name && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-brand/10 text-brand">
                    {profile.department_name}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 3-col grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Personal Info */}
            <div className={`rounded-2xl border p-5 ${cardClass}`}>
              <h3 className={`text-xs font-bold uppercase tracking-widest mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Personal Info
              </h3>
              <div className={`rounded-xl border divide-y ${subCard} ${isDark ? 'divide-slate-600' : 'divide-gray-200'}`}>
                <InfoRow label="Phone" value={profile.phone} />
                <InfoRow label="Date of Birth" value={profile.date_of_birth} />
                <InfoRow label="Employment" value={profile.employment_type?.replace('_', ' ')} />
                <InfoRow label="Timezone" value={profile.work_timezone} />
                <InfoRow label="Location" value={profile.work_location_default?.toUpperCase()} />
                <InfoRow label="Team Lead" value={fmt(profile.team_lead_name)} />
                <InfoRow label="Manager" value={fmt(profile.manager_name)} />
                <InfoRow label="Client" value={profile.client_name} />
              </div>
            </div>

            {/* Leave Balances */}
            <div className={`rounded-2xl border p-5 ${cardClass}`}>
              <h3 className={`text-xs font-bold uppercase tracking-widest mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Leave Balances
              </h3>
              {balance ? (
                <div className="grid grid-cols-2 gap-2">
                  <StatPill
                    label="CL Left"
                    value={balance?.casual?.remaining ?? '—'}
                    color="bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                  />
                  <StatPill
                    label="SL Left"
                    value={balance?.sick?.remaining ?? '—'}
                    color="bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                  />
                  <StatPill
                    label="Comp Off"
                    value={balance?.comp?.available ?? '—'}
                    color="bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                  />
                  <StatPill
                    label="NHCO"
                    value={balance?.nhco?.available ?? '—'}
                    color="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                  />
                </div>
              ) : (
                <div className={`rounded-xl p-4 text-center text-sm ${isDark ? 'text-gray-500 bg-slate-700/40' : 'text-gray-400 bg-gray-50'}`}>
                  No leave balance data
                </div>
              )}
              {/* 30-day Attendance */}
              <h3 className={`text-xs font-bold uppercase tracking-widest mt-4 mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Last 30 Days
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <StatPill label="Present" value={present} color="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300" />
                <StatPill label="Absent" value={absent} color="bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300" />
                <StatPill label="Off Days" value={offDays} color="bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-400" />
              </div>
            </div>

            {/* Assets */}
            <div className={`rounded-2xl border p-5 ${cardClass}`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-xs font-bold uppercase tracking-widest ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Assigned Assets
                </h3>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${assets.length > 0 ? 'bg-brand/15 text-brand' : isDark ? 'bg-slate-700 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                  {assets.length} item{assets.length !== 1 ? 's' : ''}
                </span>
              </div>
              {assets.length === 0 ? (
                <div className={`rounded-xl p-4 text-center text-sm ${isDark ? 'text-gray-500 bg-slate-700/40' : 'text-gray-400 bg-gray-50'}`}>
                  No assets assigned
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {assets.map(a => (
                    <div key={a.id} className={`rounded-xl border p-3 flex items-start gap-2 ${subCard}`}>
                      <div className="w-7 h-7 rounded-lg bg-brand/15 flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{a.brand} {a.model}</p>
                        <p className={`text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {a.category_name} · {a.asset_tag || a.serial_number || 'N/A'}
                        </p>
                        <span className={`inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          a.status === 'assigned' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          a.status === 'under_repair' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {(a.status || '').replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Shift Timeline */}
          {shifts.length > 0 && (
            <div className={`rounded-2xl border p-5 ${cardClass}`}>
              <h3 className={`text-xs font-bold uppercase tracking-widest mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Recent Shift History (Last 30 Days)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-full text-xs">
                  <thead>
                    <tr className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                      {['Date', 'Shift', 'Clock In', 'Clock Out', 'Status'].map(h => (
                        <th key={h} className="text-left px-3 py-2 font-semibold uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-slate-700' : 'divide-gray-100'}`}>
                    {[...shifts]
                      .filter(s => {
                        const thirtyDaysAgo = new Date();
                        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                        return s.shift_date >= thirtyDaysAgo.toISOString().slice(0, 10);
                      })
                      .sort((a,b) => b.shift_date.localeCompare(a.shift_date))
                      .map(s => {
                      const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';
                      const status = s.is_off ? 'Off' : s.clock_in_at && s.clock_out_at ? 'Done' : s.clock_in_at ? 'Active' : s.shift_date < today ? 'Absent' : 'Scheduled';
                      const statusColor = {
                        Off: 'text-gray-400',
                        Done: 'text-green-600 dark:text-green-400',
                        Active: 'text-blue-600 dark:text-blue-400',
                        Absent: 'text-red-600 dark:text-red-400',
                        Scheduled: 'text-amber-600 dark:text-amber-400',
                      }[status];
                      
                      const [y, m, d] = s.shift_date.split('-');
                      const displayDate = `${m}-${d}-${y.slice(2)}`;

                      return (
                        <tr key={s.id || s.shift_date} className={`${isDark ? 'hover:bg-slate-700/30' : 'hover:bg-gray-50'}`}>
                          <td className="px-3 py-2 font-medium">{displayDate}</td>
                          <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                            {s.shift_start_time && s.shift_end_time ? `${s.shift_start_time?.slice(0,5)} – ${s.shift_end_time?.slice(0,5)}` : '—'}
                          </td>
                          <td className="px-3 py-2">{fmtTime(s.clock_in_at)}</td>
                          <td className="px-3 py-2">{fmtTime(s.clock_out_at)}</td>
                          <td className={`px-3 py-2 font-semibold ${statusColor}`}>{status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && !profile && selectedId && (
        <div className={`rounded-2xl border p-12 text-center ${cardClass}`}>
          <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Could not load employee profile.</p>
        </div>
      )}

      {!loading && !selectedId && (
        <div className={`rounded-2xl border p-12 text-center ${cardClass}`}>
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className={`text-base font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Select an employee to view their full profile</p>
          <p className={`text-sm mt-1 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Leave balances, assets, shift history and more</p>
        </div>
      )}

      {isEditing && profile && (
        <EmployeeDataEditModal 
          profile={profile}
          balance={balance}
          assets={assets}
          users={users}
          isDark={isDark}
          onClose={() => setIsEditing(false)}
          onSaved={() => {
            setIsEditing(false);
            loadProfile(selectedId);
          }}
        />
      )}
    </div>
  );
}
