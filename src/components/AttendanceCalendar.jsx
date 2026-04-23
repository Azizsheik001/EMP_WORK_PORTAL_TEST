import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../api/client';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Determine attendance status for a single day.
 *
 * @param {string} dateStr   - "YYYY-MM-DD"
 * @param {object|null} shift - shift record for that day (from API) or null
 * @param {boolean} hasLeave  - whether the employee has an approved leave covering this date
 * @param {string} todayStr   - today in "YYYY-MM-DD"
 * @returns {'P'|'A'|'L'|'O'|'H'|'-'}
 */
function getDayStatus(dateStr, shift, hasLeave, todayStr) {
  const isFuture = dateStr > todayStr;
  const isToday = dateStr === todayStr;

  // Check if the employee actually clocked in (overrides leave / off day)
  const clockedIn = shift && !!shift.clock_in_at;

  // Approved leave — but only if the employee did NOT actually clock in
  if (hasLeave) {
    if (!clockedIn) return 'L';
    // Employee clocked in despite having leave — treat as present below
  }

  // No shift assigned = off day (unless they clocked in anyway)
  if (!shift || !shift.shift_start_time || !shift.shift_end_time) {
    if (clockedIn) return 'P'; // came in despite no shift / on leave
    return 'O';
  }

  // Future date with a shift assigned but not yet worked
  if (isFuture) return '-';

  // For today: check if the shift has actually started before marking absent
  if (isToday && !clockedIn) {
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const nowMin = nowIST.getHours() * 60 + nowIST.getMinutes();
    const [sh, sm] = shift.shift_start_time.split(':').map(Number);
    const shiftStartMin = sh * 60 + (sm || 0);
    // Allow 1 hour buffer after shift start before marking absent
    if (nowMin < shiftStartMin + 60) return '-'; // shift hasn't started yet (or just started)
  }

  // Has shift — check clock data
  const hasClockIn = !!shift.clock_in_at;
  const hasClockOut = !!shift.clock_out_at;

  if (hasClockIn && hasClockOut) {
    // Check for half-day: worked less than half the scheduled duration
    const scheduledMinutes = getShiftDurationMinutes(shift.shift_start_time, shift.shift_end_time);
    const workedMinutes = getWorkedMinutes(shift.clock_in_at, shift.clock_out_at);
    if (scheduledMinutes > 0 && workedMinutes > 0 && workedMinutes < scheduledMinutes * 0.6) {
      return 'H';
    }
    return 'P';
  }

  if (hasClockIn && !hasClockOut) {
    // Clocked in but not out — if today, they're present; if past, still present
    return 'P';
  }

  // Had shift, no clock in, and date is in the past or today (past shift start + buffer)
  return 'A';
}

function getShiftDurationMinutes(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let start = sh * 60 + (sm || 0);
  let end = eh * 60 + (em || 0);
  if (end <= start) end += 24 * 60; // overnight shift
  return end - start;
}

function getWorkedMinutes(clockIn, clockOut) {
  if (!clockIn || !clockOut) return 0;
  const inTime = new Date(clockIn).getTime();
  const outTime = new Date(clockOut).getTime();
  return Math.max(0, (outTime - inTime) / 60000);
}

function formatDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getTodayStr() {
  // Use real calendar date for attendance (not the overnight-adjusted date)
  // because attendance is per calendar day
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

const STATUS_CONFIG = {
  P: { label: 'Present', letter: 'P', bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300', dot: 'bg-green-500' },
  A: { label: 'Absent',  letter: 'A', bg: 'bg-red-100 dark:bg-red-900/40',   text: 'text-red-700 dark:text-red-300',     dot: 'bg-red-500' },
  L: { label: 'Leave',   letter: 'L', bg: 'bg-blue-100 dark:bg-blue-900/40',  text: 'text-blue-700 dark:text-blue-300',   dot: 'bg-blue-500' },
  O: { label: 'Off',     letter: 'O', bg: 'bg-gray-100 dark:bg-gray-800/60',  text: 'text-gray-500 dark:text-gray-400',   dot: 'bg-gray-400' },
  H: { label: 'Half Day',letter: 'H', bg: 'bg-amber-100 dark:bg-amber-900/40',text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  '-': { label: 'Upcoming', letter: '-', bg: '', text: 'text-gray-300 dark:text-gray-600', dot: 'bg-gray-300 dark:bg-gray-600' },
};

export default function AttendanceCalendar({ isDark, currentUser, onNavigate, showToast }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [shifts, setShifts] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Admin clock-in/out state
  const [adminClockUserId, setAdminClockUserId] = useState('');
  const [adminClockDate, setAdminClockDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  const [adminClockLoading, setAdminClockLoading] = useState(false);
  const [adminClockMessage, setAdminClockMessage] = useState(null);

  const isAdmin = currentUser && ['admin', 'manager', 'team_lead'].includes(currentUser.role || currentUser.type);

  // Compute month date range
  const { from, to } = useMemo(() => {
    const firstDay = formatDate(year, month, 1);
    const lastDay = formatDate(year, month, new Date(year, month + 1, 0).getDate());
    return { from: firstDay, to: lastDay };
  }, [year, month]);

  // Fetch users list for admin dropdown
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    api.users().then((data) => {
      if (cancelled) return;
      const list = data.users || data || [];
      setUsers(Array.isArray(list) ? list : []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isAdmin]);

  // Set default selected user
  useEffect(() => {
    if (!selectedUserId && currentUser) {
      setSelectedUserId(currentUser.id);
    }
  }, [currentUser, selectedUserId]);

  // Fetch shift data and leave requests when month or selected user changes
  const fetchData = useCallback(async () => {
    if (!selectedUserId) return;
    setLoading(true);
    setError(null);
    try {
      const [shiftData, leaveData] = await Promise.all([
        api.shifts({ from, to }),
        api.leaveRequests.list(),
      ]);
      setShifts(shiftData.shifts || []);
      // Combine both leave request arrays from the response
      const allLeaves = [
        ...(leaveData.leave_requests || []),
        ...(leaveData.all_leave_requests || []),
      ];
      setLeaveRequests(allLeaves);
    } catch (err) {
      setError(err.message || 'Failed to load attendance data');
      setShifts([]);
      setLeaveRequests([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, selectedUserId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build a map of date -> shift for the selected user
  const shiftMap = useMemo(() => {
    const map = {};
    for (const s of shifts) {
      if (s.user_id === selectedUserId) {
        map[s.shift_date] = s;
      }
    }
    return map;
  }, [shifts, selectedUserId]);

  // Build a set of dates that have approved leave for the selected user
  const leaveDates = useMemo(() => {
    const dates = new Set();
    for (const lr of leaveRequests) {
      if (lr.employee_id !== selectedUserId) continue;
      if (lr.status !== 'approved') continue;
      // Expand date range
      const start = lr.start_date ? String(lr.start_date).slice(0, 10) : null;
      const end = lr.end_date ? String(lr.end_date).slice(0, 10) : null;
      if (!start) continue;
      const endDate = end || start;
      let cursor = new Date(start + 'T12:00:00');
      const limit = new Date(endDate + 'T12:00:00');
      while (cursor <= limit) {
        dates.add(cursor.toISOString().slice(0, 10));
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return dates;
  }, [leaveRequests, selectedUserId]);

  // Build calendar grid
  const calendarWeeks = useMemo(() => {
    const todayStr = getTodayStr();
    const firstDayOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Monday = 0, Sunday = 6 (ISO week)
    let startDow = firstDayOfMonth.getDay(); // 0=Sun, 1=Mon ... 6=Sat
    startDow = startDow === 0 ? 6 : startDow - 1; // convert to Mon=0

    const weeks = [];
    let currentWeek = new Array(startDow).fill(null); // padding before 1st

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = formatDate(year, month, day);
      const shift = shiftMap[dateStr] || null;
      const hasLeave = leaveDates.has(dateStr);
      const status = getDayStatus(dateStr, shift, hasLeave, todayStr);

      currentWeek.push({ day, dateStr, status, isToday: dateStr === todayStr });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }

    // Pad last week
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push(null);
      weeks.push(currentWeek);
    }

    return weeks;
  }, [year, month, shiftMap, leaveDates]);

  // Summary counts
  const summary = useMemo(() => {
    const counts = { P: 0, A: 0, L: 0, O: 0, H: 0 };
    for (const week of calendarWeeks) {
      for (const cell of week) {
        if (cell && counts[cell.status] !== undefined) {
          counts[cell.status]++;
        }
      }
    }
    return counts;
  }, [calendarWeeks]);

  // Navigation
  const goToPrevMonth = () => {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const goToNextMonth = () => {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  };
  const goToToday = () => {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth());
  };

  // Admin clock-in handler
  const handleAdminClockIn = useCallback(async () => {
    if (!adminClockUserId || !adminClockDate) return;
    setAdminClockLoading(true);
    setAdminClockMessage(null);
    try {
      const result = await api.adminClockIn(adminClockUserId, adminClockDate);
      setAdminClockMessage({ type: 'success', text: result.message || 'Employee clocked in successfully' });
      if (showToast) showToast(result.message || 'Employee clocked in');
      fetchData(); // refresh calendar data
    } catch (e) {
      const msg = e.data?.error || e.message || 'Failed to clock in';
      setAdminClockMessage({ type: 'error', text: msg });
    } finally {
      setAdminClockLoading(false);
    }
  }, [adminClockUserId, adminClockDate, fetchData, showToast]);

  // Admin clock-out handler
  const handleAdminClockOut = useCallback(async () => {
    if (!adminClockUserId || !adminClockDate) return;
    setAdminClockLoading(true);
    setAdminClockMessage(null);
    try {
      const result = await api.adminClockOut(adminClockUserId, adminClockDate);
      setAdminClockMessage({ type: 'success', text: result.message || 'Employee clocked out successfully' });
      if (showToast) showToast(result.message || 'Employee clocked out');
      fetchData(); // refresh calendar data
    } catch (e) {
      const msg = e.data?.error || e.message || 'Failed to clock out';
      setAdminClockMessage({ type: 'error', text: msg });
    } finally {
      setAdminClockLoading(false);
    }
  }, [adminClockUserId, adminClockDate, fetchData, showToast]);

  // Selected user display name
  const selectedUserName = useMemo(() => {
    if (!isAdmin) return currentUser?.name || '';
    const u = users.find((u) => u.id === selectedUserId);
    return u?.name || currentUser?.name || '';
  }, [isAdmin, users, selectedUserId, currentUser]);

  // Style helpers
  const cardBg = isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200';
  const headerBg = isDark ? 'bg-slate-700/50' : 'bg-gray-50';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-500';
  const btnClass = isDark
    ? 'bg-slate-700 hover:bg-slate-600 text-gray-200 border-slate-600'
    : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-300';
  const selectClass = isDark
    ? 'bg-slate-700 border-slate-600 text-white focus:border-blue-500 focus:ring-blue-500'
    : 'bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className={`rounded-xl border ${cardBg} p-4`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className={`text-lg font-semibold ${textPrimary}`}>Attendance Calendar</h2>
            <p className={`text-sm ${textSecondary}`}>
              Monthly attendance overview{selectedUserName ? ` for ${selectedUserName}` : ''}
            </p>
          </div>

          {/* Employee selector for admins */}
          {isAdmin && users.length > 0 && (
            <div className="flex items-center gap-2">
              <label className={`text-sm font-medium ${textSecondary}`}>Employee:</label>
              <select
                value={selectedUserId || ''}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${selectClass}`}
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Calendar Card */}
      <div className={`rounded-xl border ${cardBg} overflow-hidden`}>
        {/* Month Navigation */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-slate-700' : 'border-gray-200'} ${headerBg}`}>
          <button
            onClick={goToPrevMonth}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border text-sm font-medium transition-colors ${btnClass}`}
            aria-label="Previous month"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="flex items-center gap-3">
            <h3 className={`text-base font-semibold ${textPrimary}`}>
              {MONTH_NAMES[month]} {year}
            </h3>
            <button
              onClick={goToToday}
              className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${btnClass}`}
            >
              Today
            </button>
          </div>

          <button
            onClick={goToNextMonth}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border text-sm font-medium transition-colors ${btnClass}`}
            aria-label="Next month"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Loading / Error states */}
        {loading && (
          <div className={`flex items-center justify-center py-16 ${textSecondary}`}>
            <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading attendance data...
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center justify-center py-16 text-red-500 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Calendar Grid */}
        {!loading && !error && (
          <div className="p-4">
            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {DAY_HEADERS.map((d) => (
                <div key={d} className={`text-center text-xs font-semibold py-2 ${textSecondary}`}>
                  {d}
                </div>
              ))}
            </div>

            {/* Week Rows */}
            <div className="grid grid-cols-7 gap-1">
              {calendarWeeks.map((week, wi) =>
                week.map((cell, di) => {
                  if (!cell) {
                    return <div key={`${wi}-${di}`} className="h-14" />;
                  }

                  const cfg = STATUS_CONFIG[cell.status] || STATUS_CONFIG['-'];
                  const todayRing = cell.isToday
                    ? 'ring-2 ring-blue-500 dark:ring-blue-400'
                    : '';

                  return (
                    <div
                      key={cell.dateStr}
                      className={`h-14 rounded-lg flex flex-col items-center justify-center transition-colors cursor-default ${cfg.bg} ${todayRing}`}
                      title={`${cell.dateStr}: ${cfg.label}`}
                    >
                      <span className={`text-xs font-medium ${cell.isToday ? (isDark ? 'text-blue-300' : 'text-blue-600') : textSecondary}`}>
                        {cell.day}
                      </span>
                      <span className={`text-sm font-bold leading-none mt-0.5 ${cfg.text}`}>
                        {cfg.letter}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Legend */}
        {!loading && !error && (
          <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 border-t ${isDark ? 'border-slate-700' : 'border-gray-200'} ${headerBg}`}>
            {['P', 'A', 'L', 'O', 'H'].map((key) => {
              const cfg = STATUS_CONFIG[key];
              return (
                <div key={key} className="flex items-center gap-1.5 text-xs">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                  <span className={textSecondary}>{cfg.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Summary Card */}
      {!loading && !error && (
        <div className={`rounded-xl border ${cardBg} p-4`}>
          <h3 className={`text-sm font-semibold mb-3 ${textPrimary}`}>
            Monthly Summary — {MONTH_NAMES[month]} {year}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {[
              { key: 'P', label: 'Present',  color: 'green' },
              { key: 'A', label: 'Absent',   color: 'red' },
              { key: 'L', label: 'Leave',    color: 'blue' },
              { key: 'O', label: 'Off',      color: 'gray' },
              { key: 'H', label: 'Half Day', color: 'amber' },
            ].map(({ key, label, color }) => {
              const bgMap = {
                green:  isDark ? 'bg-green-900/20 border-green-800/40'  : 'bg-green-50 border-green-200',
                red:    isDark ? 'bg-red-900/20 border-red-800/40'     : 'bg-red-50 border-red-200',
                blue:   isDark ? 'bg-blue-900/20 border-blue-800/40'   : 'bg-blue-50 border-blue-200',
                gray:   isDark ? 'bg-gray-800/40 border-gray-700/40'   : 'bg-gray-50 border-gray-200',
                amber:  isDark ? 'bg-amber-900/20 border-amber-800/40' : 'bg-amber-50 border-amber-200',
              };
              const numMap = {
                green:  isDark ? 'text-green-300'  : 'text-green-700',
                red:    isDark ? 'text-red-300'    : 'text-red-700',
                blue:   isDark ? 'text-blue-300'   : 'text-blue-700',
                gray:   isDark ? 'text-gray-300'   : 'text-gray-600',
                amber:  isDark ? 'text-amber-300'  : 'text-amber-700',
              };
              return (
                <div key={key} className={`rounded-lg border px-3 py-2 text-center ${bgMap[color]}`}>
                  <div className={`text-lg font-bold ${numMap[color]}`}>
                    {summary[key]}
                  </div>
                  <div className={`text-[11px] font-medium ${textSecondary}`}>
                    {label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Admin Clock In/Out Card */}
      {isAdmin && users.length > 0 && (
        <div className={`rounded-xl border ${cardBg} p-4`}>
          <h3 className={`text-sm font-semibold mb-3 ${textPrimary} flex items-center gap-2`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Admin Clock In / Out
          </h3>
          <p className={`text-xs ${textSecondary} mb-3`}>
            Clock in or out an employee for any date (past dates allowed, up to today).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className={`block text-xs font-medium ${textSecondary} mb-1`}>Employee</label>
              <select
                value={adminClockUserId}
                onChange={(e) => { setAdminClockUserId(e.target.value); setAdminClockMessage(null); }}
                className={`w-full rounded-lg border px-3 py-2 text-sm ${selectClass}`}
              >
                <option value="">-- Select employee --</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role || u.type})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={`block text-xs font-medium ${textSecondary} mb-1`}>Date</label>
              <input
                type="date"
                value={adminClockDate}
                max={new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}
                onChange={(e) => { setAdminClockDate(e.target.value); setAdminClockMessage(null); }}
                className={`w-full rounded-lg border px-3 py-2 text-sm ${selectClass}`}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAdminClockIn}
                disabled={!adminClockUserId || !adminClockDate || adminClockLoading}
                className="flex-1 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adminClockLoading ? '...' : 'Clock In'}
              </button>
              <button
                type="button"
                onClick={handleAdminClockOut}
                disabled={!adminClockUserId || !adminClockDate || adminClockLoading}
                className="flex-1 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adminClockLoading ? '...' : 'Clock Out'}
              </button>
            </div>
          </div>
          {adminClockMessage && (
            <div className={`mt-3 p-2.5 rounded-lg text-sm flex items-center gap-2 ${
              adminClockMessage.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
            }`}>
              <svg className={`w-4 h-4 flex-shrink-0 ${adminClockMessage.type === 'success' ? 'text-green-500' : 'text-red-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {adminClockMessage.type === 'success'
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                }
              </svg>
              {adminClockMessage.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
