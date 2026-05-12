import { useState, useMemo, useCallback } from 'react';
import { getShiftRows } from '../data/mockData';
import { getEmployeeById } from '../data/mockData';
import { hasApi, api } from '../api/client';

function formatName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ── Timezone helpers ─────────────────────────────────────────────
// Format 24hr HH:MM to 12hr AM/PM
function to12hr(h, m) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Parse any time string (HH:MM 24hr or h:mm AM/PM) into { h, m } in 24hr
function parseTime(t) {
  if (!t) return null;
  const ampm = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = parseInt(ampm[2]);
    const isPm = ampm[3].toUpperCase() === 'PM';
    if (isPm && h !== 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return { h, m };
  }
  const parts = t.split(':').map(Number);
  return { h: parts[0] || 0, m: parts[1] || 0 };
}

// Convert IST time to Central Time using proper Intl (auto handles CST vs CDT)
function convertIstToCt(h, m) {
  const now = new Date();
  // Build a UTC timestamp for this IST time today: IST = UTC+5:30
  const utc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), h - 5, m - 30));
  const ctStr = utc.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour12: false, hour: '2-digit', minute: '2-digit' });
  const [cH, cM] = ctStr.split(':').map(Number);
  return { h: cH, m: cM };
}

// Format a time string for display: IST → 12hr AM/PM; CT → convert then 12hr AM/PM
function formatTimeDisplay(timeStr, useCt) {
  if (!timeStr || timeStr === '\u2014' || timeStr === '—' || timeStr === 'Off') return timeStr;

  // Handle range formats: "HH:MM-HH:MM", "HH:MM - HH:MM", "h:mm AM - h:mm PM"
  const rangeMatch = timeStr.match(/^(.+?)\s*-\s*(.+)$/);
  if (rangeMatch) {
    const part1 = rangeMatch[1].trim();
    const part2 = rangeMatch[2].trim();
    // Only treat as range if both parts parse as times
    if (parseTime(part1) && parseTime(part2)) {
      return `${formatSingle(part1, useCt)} - ${formatSingle(part2, useCt)}`;
    }
  }

  return formatSingle(timeStr, useCt);
}

function formatSingle(t, useCt) {
  const parsed = parseTime(t);
  if (!parsed) return t;
  if (useCt) {
    const ct = convertIstToCt(parsed.h, parsed.m);
    return to12hr(ct.h, ct.m);
  }
  return to12hr(parsed.h, parsed.m);
}

const statusConfig = {
  current_logged_in: {
    label: 'Logged in',
    bg: 'bg-green-100 dark:bg-green-900/40',
    text: 'text-green-800 dark:text-green-300',
    border: 'border-green-400 dark:border-green-600',
    nameColor: 'text-brand font-semibold',
    dot: 'bg-green-500',
  },
  current_not_logged_in: {
    label: 'Not logged in',
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    text: 'text-amber-800 dark:text-amber-300',
    border: 'border-amber-400 dark:border-amber-600',
    nameColor: 'text-amber-600 dark:text-amber-400 font-semibold',
    dot: 'bg-amber-500',
  },
  off: {
    label: 'Off',
    bg: 'bg-gray-100 dark:bg-gray-800/60',
    text: 'text-gray-600 dark:text-gray-400',
    border: 'border-gray-300 dark:border-gray-600',
    nameColor: 'text-gray-500 dark:text-gray-400',
    dot: 'bg-gray-400',
  },
  not_started: {
    label: 'Upcoming Shift',
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    text: 'text-orange-600 dark:text-orange-400',
    border: 'border-orange-300 dark:border-orange-700',
    nameColor: 'text-orange-700 dark:text-orange-300',
    dot: 'bg-orange-400',
  },
  completed: {
    label: 'Completed',
    bg: 'bg-gray-100 dark:bg-gray-800/60',
    text: 'text-gray-600 dark:text-gray-400',
    border: 'border-gray-300 dark:border-gray-600',
    nameColor: 'text-gray-500 dark:text-gray-400',
    dot: 'bg-gray-400',
  },
  not_current: {
    label: 'Off',
    bg: 'bg-gray-100 dark:bg-gray-800/60',
    text: 'text-gray-600 dark:text-gray-400',
    border: 'border-gray-300 dark:border-gray-600',
    nameColor: 'text-gray-500 dark:text-gray-400',
    dot: 'bg-gray-400',
  },
  absent: {
    label: 'Absent',
    bg: 'bg-red-100 dark:bg-red-900/40',
    text: 'text-red-800 dark:text-red-300',
    border: 'border-red-400 dark:border-red-600',
    nameColor: 'text-red-600 dark:text-red-400 font-semibold',
    dot: 'bg-red-500',
  },
};

function LoadingSkeleton() {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => (
        <tr key={i} className="border-b border-gray-200 dark:border-slate-700 animate-pulse">
          <td className="px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-32" /></td>
          <td className="px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-28" /></td>
          <td className="px-4 py-3"><div className="h-6 bg-gray-200 dark:bg-slate-700 rounded-full w-24" /></td>
          <td className="px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-16" /></td>
          <td className="px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-16" /></td>
        </tr>
      ))}
    </>
  );
}

export default function ShiftsTable({
  week,
  clientId,
  searchQuery,
  onEmployeeClick,
  clockedInEmployeeIds,
  clockedInTimes,
  shiftRows = null,
  loading = false,
  showDepartment = false,
  currentUser = null,
  onRefreshShifts = null,
}) {
  const [showCst, setShowCst] = useState(false);
  const [actionLoading, setActionLoading] = useState(null); // employeeId being acted on
  const [actionError, setActionError] = useState(null);
  const [editingShift, setEditingShift] = useState(null); // { employeeId, clientId, shiftDate, start, end }

  const isSuperior = currentUser?.type === 'admin' || currentUser?.type === 'manager' || currentUser?.type === 'team_lead';
  const isAdmin = currentUser?.type === 'admin';
  const ROLE_LEVEL = { employee: 0, team_lead: 1, manager: 2, admin: 3 };
  const canActOn = (targetRole) => (ROLE_LEVEL[currentUser?.type] || 0) > (ROLE_LEVEL[targetRole] || 0);

  const rows = useMemo(
    () => (Array.isArray(shiftRows) ? shiftRows : getShiftRows(week, clientId, searchQuery, clockedInEmployeeIds, clockedInTimes)),
    [shiftRows, week, clientId, searchQuery, clockedInEmployeeIds, clockedInTimes]
  );

  const handleNameClick = (row) => {
    if (Array.isArray(shiftRows)) {
      onEmployeeClick({ id: row.employeeId, name: row.employeeName, clientId: row.client_id });
      return;
    }
    const emp = getEmployeeById(row.employeeId);
    if (emp) onEmployeeClick(emp);
  };

  const handleAdminClockIn = useCallback(async (employeeId, shiftDate) => {
    if (!hasApi()) return;
    setActionLoading(employeeId);
    setActionError(null);
    try {
      await api.adminClockIn(employeeId, shiftDate);
      if (onRefreshShifts) onRefreshShifts();
    } catch (e) {
      setActionError({ id: employeeId, msg: e.data?.error || e.message || 'Failed' });
    } finally {
      setActionLoading(null);
    }
  }, [onRefreshShifts]);

  const handleAdminClockOut = useCallback(async (employeeId, shiftDate) => {
    if (!hasApi()) return;
    setActionLoading(employeeId);
    setActionError(null);
    try {
      await api.adminClockOut(employeeId, shiftDate);
      if (onRefreshShifts) onRefreshShifts();
    } catch (e) {
      setActionError({ id: employeeId, msg: e.data?.error || e.message || 'Failed' });
    } finally {
      setActionLoading(null);
    }
  }, [onRefreshShifts]);

  const handleAdminEditShift = useCallback(async () => {
    if (!editingShift || !hasApi()) return;
    setActionLoading(editingShift.employeeId);
    setActionError(null);
    try {
      await api.shiftsBulk({
        client_id: editingShift.clientId,
        assignments: [{
          user_id: editingShift.employeeId,
          shift_date: editingShift.shiftDate,
          shift_start_time: editingShift.start,
          shift_end_time: editingShift.end,
          is_off: false,
        }],
      });
      setEditingShift(null);
      if (onRefreshShifts) onRefreshShifts();
    } catch (e) {
      setActionError({ id: editingShift.employeeId, msg: e.data?.error || e.message || 'Failed to update shift' });
    } finally {
      setActionLoading(null);
    }
  }, [editingShift, onRefreshShifts]);

  // Summary counts for display
  // Use unique employees excluding admins so the "N employees" number matches
  // the Dashboard "Total Employees" counter (active non-admins in scope).
  const summary = useMemo(() => {
    if (loading || rows.length === 0) return null;
    const countable = rows.filter((r) => r.employeeRole !== 'admin');
    const uniqueIds = new Set(countable.map((r) => r.employeeId));
    const loggedIn = countable.filter((r) => r.status === 'current_logged_in').length;
    const completed = countable.filter((r) => r.status === 'completed').length;
    const notLoggedIn = countable.filter((r) => r.status === 'current_not_logged_in').length;
    const absent = countable.filter((r) => r.status === 'absent').length;
    return { total: uniqueIds.size, loggedIn, completed, notLoggedIn, absent };
  }, [rows, loading]);

  const tz = (val) => formatTimeDisplay(val, showCst);

  const colCount = 6 + (showDepartment ? 1 : 0) + (isSuperior ? 1 : 0);

  return (
    <div className="space-y-3">
      {/* Summary bar + TZ toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {summary && (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-900 dark:text-white">{summary.total}</span> employees
            </span>
            {summary.loggedIn > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-green-700 dark:text-green-400">{summary.loggedIn} logged in</span>
              </span>
            )}
            {summary.completed > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-blue-700 dark:text-blue-400">{summary.completed} completed</span>
              </span>
            )}
            {summary.notLoggedIn > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-amber-700 dark:text-amber-400">{summary.notLoggedIn} not logged in</span>
              </span>
            )}
            {summary.absent > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-red-700 dark:text-red-400">{summary.absent} absent</span>
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-1 text-xs ml-auto">
          <span className="text-gray-500 dark:text-gray-400 mr-1">Timezone:</span>
          <button type="button" onClick={() => setShowCst(false)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${!showCst ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'}`}>
            IST
          </button>
          <button type="button" onClick={() => setShowCst(true)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${showCst ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'}`}>
            CT
          </button>
        </div>
      </div>
      {showCst && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Times shown in Central Time (CST/CDT auto-adjusted).</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
        <table className="w-full text-left min-w-[640px]" role="table" aria-label="Employee shift overview">
          <thead>
            <tr className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
              <th scope="col" className="px-4 py-3 text-gray-500 dark:text-gray-400 font-medium text-sm">Employee Name</th>
              {showDepartment && <th scope="col" className="px-4 py-3 text-gray-500 dark:text-gray-400 font-medium text-sm">Department</th>}
              <th scope="col" className="px-4 py-3 text-gray-500 dark:text-gray-400 font-medium text-sm">Shift Time</th>
              <th scope="col" className="px-4 py-3 text-gray-500 dark:text-gray-400 font-medium text-sm">Status</th>
              <th scope="col" className="px-4 py-3 text-gray-500 dark:text-gray-400 font-medium text-sm">Login Time</th>
              <th scope="col" className="px-4 py-3 text-gray-500 dark:text-gray-400 font-medium text-sm">Logout Time</th>
              {isSuperior && <th scope="col" className="px-4 py-3 text-gray-500 dark:text-gray-400 font-medium text-sm">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <LoadingSkeleton />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <p className="text-gray-500 dark:text-gray-400 font-medium">No employees match your filters</p>
                    <p className="text-sm text-gray-400 dark:text-gray-500">Try adjusting the client or search filters above.</p>
                  </div>
                </td>
              </tr>
            ) : rows.map((row) => {
              const config = statusConfig[row.status] || statusConfig.not_current;
              const isLoggedIn = row.status === 'current_logged_in';
              const isCurrentShift = row.status === 'current_logged_in' || row.status === 'current_not_logged_in' || row.status === 'absent';
              const isActing = actionLoading === row.employeeId;
              const hasError = actionError?.id === row.employeeId;
              return (
                <tr
                  key={row.employeeId}
                  className="border-b border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/80 transition-colors"
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleNameClick(row)}
                      className={`${config.nameColor} hover:opacity-80 text-left underline underline-offset-2 cursor-pointer`}
                      aria-label={`View details for ${formatName(row.employeeName)}`}
                    >
                      {formatName(row.employeeName)}
                    </button>
                    {row.clockInBy && (
                      <span className="ml-1.5 text-[10px] text-purple-600 dark:text-purple-400 font-medium" title={`Clocked in by ${row.clockInBy}`}>
                        (by {formatName(row.clockInBy).split(' ')[0]})
                      </span>
                    )}
                  </td>
                  {showDepartment && (
                    <td className="px-4 py-3 text-sm">
                      {row.department_name ? (
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300">
                            {row.department_name}
                          </span>
                          {row.department_name.toLowerCase() === 'solar' && row.client_names?.length > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                              {row.client_names.join(', ')}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">{'\u2014'}</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-gray-900 dark:text-white text-sm">{tz(row.shiftTime)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text} ${config.border} border`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
                      {config.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-900 dark:text-white text-sm">{tz(row.loginTime)}</td>
                  <td className="px-4 py-3 text-gray-900 dark:text-white text-sm">
                    {tz(row.logoutTime)}
                    {row.clockOutDevice === 'mobile' && row.clockInDevice !== 'mobile' && row.logoutTime !== '—' && (
                      <span className="ml-1 inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" title="Clocked out from mobile device (different from clock-in device)">
                        <svg className="w-3 h-3 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                        Mobile
                      </span>
                    )}
                    {row.clockOutDevice === 'system' && row.logoutTime !== '—' && (
                      <span className="ml-1 inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400" title="Auto-clocked out by system (buffer expired)">
                        Auto
                      </span>
                    )}
                  </td>
                  {isSuperior && (
                    <td className="px-4 py-3">
                      {editingShift?.employeeId === row.employeeId ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <input
                            type="time"
                            value={editingShift.start}
                            onChange={(e) => setEditingShift((p) => ({ ...p, start: e.target.value }))}
                            className="w-[90px] text-xs border rounded px-1.5 py-1 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                          />
                          <span className="text-xs text-gray-400">-</span>
                          <input
                            type="time"
                            value={editingShift.end}
                            onChange={(e) => setEditingShift((p) => ({ ...p, end: e.target.value }))}
                            className="w-[90px] text-xs border rounded px-1.5 py-1 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                          />
                          <button
                            type="button"
                            disabled={isActing}
                            onClick={handleAdminEditShift}
                            className="px-2 py-1 rounded text-xs font-medium text-white bg-brand hover:bg-brand-hover disabled:opacity-50"
                          >
                            {isActing ? '...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingShift(null)}
                            className="px-2 py-1 rounded text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {!isLoggedIn && canActOn(row.employeeRole) && (
                            <button
                              type="button"
                              disabled={isActing}
                              onClick={() => handleAdminClockIn(row.employeeId, row.shiftDate)}
                              className="inline-flex items-center gap-1 px-3 py-2 sm:px-2.5 sm:py-1 rounded-md text-sm sm:text-xs font-medium text-white bg-green-600 hover:bg-green-700 active:scale-[0.97] disabled:opacity-50 transition-all min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 justify-center"
                              title={`Clock in ${row.employeeName}`}
                            >
                              {isActing ? (
                                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              ) : (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14" />
                                </svg>
                              )}
                              In
                            </button>
                          )}
                          {isLoggedIn && canActOn(row.employeeRole) && (
                            <button
                              type="button"
                              disabled={isActing}
                              onClick={() => handleAdminClockOut(row.employeeId, row.shiftDate)}
                              className="inline-flex items-center gap-1 px-3 py-2 sm:px-2.5 sm:py-1 rounded-md text-sm sm:text-xs font-medium text-white bg-red-500 hover:bg-red-600 active:scale-[0.97] disabled:opacity-50 transition-all min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 justify-center"
                              title={`Clock out ${row.employeeName}`}
                            >
                              {isActing ? (
                                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              ) : (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7" />
                                </svg>
                              )}
                              Out
                            </button>
                          )}
                          {isAdmin && row.client_id && (
                            <button
                              type="button"
                              onClick={() => setEditingShift({
                                employeeId: row.employeeId,
                                clientId: row.client_id,
                                shiftDate: row.shiftDate,
                                start: row.shiftStartTime || '',
                                end: row.shiftEndTime || '',
                              })}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                              title="Edit shift time directly"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              Shift
                            </button>
                          )}
                          {hasError && (
                            <span className="text-[10px] text-red-500 dark:text-red-400 max-w-[120px] truncate" title={actionError.msg}>
                              {actionError.msg}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
