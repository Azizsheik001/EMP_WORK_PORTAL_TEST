import { useState, useEffect } from 'react';
import { getEmployeeById, getClientById, CANONICAL_SHIFTS } from '../data/mockData';
import { hasApi, api } from '../api/client';

// Map common timezone abbreviations to IANA names for browser compatibility
const TZ_MAP = { IST: 'Asia/Kolkata', CST: 'America/Chicago', EST: 'America/New_York', PST: 'America/Los_Angeles', MST: 'America/Denver', CT: 'America/Chicago', ET: 'America/New_York', PT: 'America/Los_Angeles', GMT: 'Etc/GMT', UTC: 'Etc/UTC' };
function resolveTimezone(tz) {
  if (!tz) return 'Asia/Kolkata';
  return TZ_MAP[tz.toUpperCase()] || tz;
}

// Convert an IST "HH:MM[:SS]" on a given YYYY-MM-DD date into the target timezone's HH:MM
function convertIstTime(timeStr, dateStr, targetTz) {
  if (!timeStr || !dateStr) return timeStr;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return timeStr;
  // IST is UTC+5:30 — construct an explicit ISO with offset
  const iso = `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return timeStr;
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: resolveTimezone(targetTz),
  });
}

// Format a shift as "HH:MM - HH:MM TZ" in the requested timezone. Handles overnight shifts.
function formatShiftInTz(shift, tz) {
  if (!shift || !shift.shift_start_time || !shift.shift_end_time) return null;
  const [sh, sm] = String(shift.shift_start_time).split(':').map(Number);
  const [eh, em] = String(shift.shift_end_time).split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const isOvernight = endMin <= startMin;
  const startDate = String(shift.shift_date).slice(0, 10);
  const endDate = isOvernight
    ? new Date(new Date(startDate + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)
    : startDate;
  const startLocal = convertIstTime(shift.shift_start_time, startDate, tz);
  const endLocal = convertIstTime(shift.shift_end_time, endDate, tz);
  return `${startLocal} - ${endLocal} ${tz}`;
}

export default function EmployeeView({ isDark, currentUser, clockedInAt, clockedInAtRaw, onClockIn, onClockOut, isClockedIn, onLeaveRequest, onCancelLeave, clients = [], apiShifts = [], leaveRequests = [] }) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [fromSession, setFromSession] = useState(1);
  const [toSession, setToSession] = useState(2);
  const [leaveType, setLeaveType] = useState('casual');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [wfhToday, setWfhToday] = useState(currentUser?.work_location_default === 'wfh');
  const [clockInError, setClockInError] = useState(null);
  const [offerShiftSwap, setOfferShiftSwap] = useState(false);
  const [showShiftChangeForm, setShowShiftChangeForm] = useState(false);
  const [scrDate, setScrDate] = useState('');
  const [scrStartTime, setScrStartTime] = useState('09:00');
  const [scrEndTime, setScrEndTime] = useState('18:00');
  const [scrReason, setScrReason] = useState('');
  const [scrSession, setScrSession] = useState('full');
  const [scrSubmitting, setScrSubmitting] = useState(false);
  const [scrSubmitted, setScrSubmitted] = useState(false);
  const [myShiftChanges, setMyShiftChanges] = useState([]);
  const [loadingShiftChanges, setLoadingShiftChanges] = useState(false);

  // Display timezone toggle — defaults to the user's own work_timezone (CST for
  // Kerry/CT employees, IST for India team). Toggle is persisted per-user.
  const tzStorageKey = currentUser?.id ? `ags_my_work_tz_${currentUser.id}` : 'ags_my_work_tz';
  const userDefaultTz = (() => {
    const raw = (currentUser?.work_timezone || '').trim();
    if (!raw) return 'IST';
    const upper = raw.toUpperCase();
    if (upper === 'CST' || upper === 'CT' || upper === 'CDT') return 'CST';
    if (upper === 'IST') return 'IST';
    const lower = raw.toLowerCase();
    if (lower.startsWith('america/chicago') || lower.startsWith('america/menominee') || lower.startsWith('america/indiana/knox')) return 'CST';
    if (lower.startsWith('america/')) return 'CST'; // other US zones — map to CST label for this toggle
    return 'IST';
  })();
  const [displayTz, setDisplayTz] = useState(() => {
    try {
      const saved = localStorage.getItem(tzStorageKey);
      if (saved === 'IST' || saved === 'CST') return saved;
    } catch {}
    return userDefaultTz;
  });
  useEffect(() => {
    try { localStorage.setItem(tzStorageKey, displayTz); } catch {}
  }, [displayTz, tzStorageKey]);

  // Set WFH default from user profile
  useEffect(() => {
    setWfhToday(currentUser?.work_location_default === 'wfh');
  }, [currentUser?.work_location_default]);

  // Auto-dismiss the submitted message after a few seconds
  useEffect(() => {
    if (submitted) {
      const timer = setTimeout(() => setSubmitted(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [submitted]);

  useEffect(() => {
    if (scrSubmitted) {
      const timer = setTimeout(() => setScrSubmitted(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [scrSubmitted]);

  // Fetch today's shift for the current user directly
  const [myTodayShift, setMyTodayShift] = useState(null);
  const [myShiftLoaded, setMyShiftLoaded] = useState(false);
  useEffect(() => {
    if (!hasApi() || !currentUser) return;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: resolveTimezone(currentUser.work_timezone) });
    api.shifts({ from: today, to: today })
      .then((data) => {
        const mine = (data.shifts || []).find((s) => s.user_id === currentUser.id);
        setMyTodayShift(mine || null);
      })
      .catch(() => setMyTodayShift(null))
      .finally(() => setMyShiftLoaded(true));
  }, [currentUser]);

  // Fetch shift change requests for current user
  useEffect(() => {
    if (!hasApi() || !currentUser) return;
    setLoadingShiftChanges(true);
    api.shiftChanges.list()
      .then((data) => {
        const reqs = (data.shift_change_requests || []).filter((r) => r.user_id === currentUser.id);
        setMyShiftChanges(reqs);
      })
      .catch(() => setMyShiftChanges([]))
      .finally(() => setLoadingShiftChanges(false));
  }, [currentUser, scrSubmitted]);

  const isEmployeeOrTL = currentUser?.type === 'employee' || currentUser?.type === 'team_lead' || currentUser?.type === 'manager';
  const mockEmp = getEmployeeById(currentUser?.id);
  const emp = isEmployeeOrTL
    ? (mockEmp || {
        id: currentUser.id,
        name: currentUser.name,
        role: currentUser.type,
        clientId: currentUser.client_id,
        leavesRemaining: 12,
        leavesLast4Weeks: 0,
        plannedLeaves: [],
      })
    : getEmployeeById('govardhan-kolli');
  const client = emp?.clientId && clients?.length
    ? clients.find((c) => c.id === emp.clientId)
    : emp ? getClientById(emp.clientId) : null;
  // Find today's shift — prefer the directly fetched one, fall back to apiShifts
  const today = new Date().toLocaleDateString('en-CA', { timeZone: resolveTimezone(currentUser?.work_timezone) });
  const todayShift = myTodayShift || apiShifts.find((s) => s.user_id === currentUser?.id && s.shift_date === today);

  const formatShiftTime24 = (timeStr) => {
    if (!timeStr) return '';
    return timeStr.slice(0, 5);
  };

  const myShift = todayShift
    ? (todayShift.shift_start_time && todayShift.shift_end_time
        ? (formatShiftInTz(todayShift, displayTz) || `${formatShiftTime24(todayShift.shift_start_time)} - ${formatShiftTime24(todayShift.shift_end_time)} ${displayTz}`)
        : 'OFF')
    : (myShiftLoaded ? 'No shift assigned' : 'Loading...');
  const status = isClockedIn ? 'Logged in' : 'Not logged in';

  const handleClockIn = async () => {
    setClockInError(null);
    try {
      if (hasApi()) {
        const userTimezone = resolveTimezone(currentUser.work_timezone);
        await api.clockIn(null, userTimezone, wfhToday);
        // If success, call the parent handler to update state
        if (onClockIn) onClockIn();
      } else {
        if (onClockIn) onClockIn();
      }
    } catch (e) {
      if (e.status === 403 && e.data) {
        setClockInError(e.data.error || e.message);
        setOfferShiftSwap(!!e.data.offer_shift_swap || !!e.data.past_buffer);
        // Pre-fill shift change form
        setScrDate(e.data.shift_date || today);
        if (e.data.shift_start) setScrStartTime(e.data.shift_start);
        if (e.data.shift_end) setScrEndTime(e.data.shift_end);
      } else {
        setClockInError(e.message || 'Failed to clock in');
        setOfferShiftSwap(false);
      }
    }
  };

  const handleSubmitLeave = (e) => {
    e.preventDefault();
    if (!fromDate || !toDate) return;
    if (toDate < fromDate) return;
    if (emp && onLeaveRequest) {
      onLeaveRequest(emp.id, emp.name, emp.clientId, fromDate, reason, toDate, fromSession, toSession, leaveType);
      setSubmitted(true);
      setFromDate('');
      setToDate('');
      setFromSession(1);
      setToSession(2);
      setLeaveType('casual');
      setReason('');
    }
  };

  const handleSubmitShiftChange = async (e) => {
    e.preventDefault();
    if (!scrDate || !scrStartTime || !scrEndTime) return;
    setScrSubmitting(true);
    try {
      await api.shiftChanges.create({
        request_date: scrDate,
        requested_start_time: scrStartTime,
        requested_end_time: scrEndTime,
        reason: scrReason || undefined,
        session: scrSession,
      });
      setScrSubmitted(true);
      setShowShiftChangeForm(false);
      setScrReason('');
      setClockInError(null);
    } catch (e) {
      setClockInError(e.data?.error || e.message || 'Failed to submit shift change request');
    } finally {
      setScrSubmitting(false);
    }
  };

  const formatSCRStatus = (s) => {
    if (s === 'approved') return 'Approved';
    if (s === 'rejected') return 'Rejected';
    return 'Pending';
  };

  const scrStatusColor = (s) => {
    if (s === 'approved') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
    if (s === 'rejected') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
    return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
  };

  const cardClass = isDark
    ? 'bg-slate-800 border-2 border-slate-600 text-white'
    : 'bg-white border-2 border-gray-300 text-gray-900';

  if (!emp) {
    return (
      <div className="max-w-2xl mx-auto w-full">
        <div className="flex flex-col items-center gap-3 py-12">
          <svg className="w-16 h-16 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <p className="text-gray-600 dark:text-gray-400 font-medium">Sign in as an employee to see your shift and clock in.</p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Demo: govardhan.kolli@libsysinc.com / emp123 or poojith.burra@libsysinc.com / emp123
          </p>
        </div>
      </div>
    );
  }

  // Minimum date for leave request
  const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // Format the clock-in timestamp in whichever timezone the toggle is set to.
  // Falls back to the pre-formatted string when the raw ISO isn't available (mock/demo mode).
  const formattedLoginTime = (() => {
    if (!isClockedIn) return '\u2014';
    if (clockedInAtRaw) {
      const d = new Date(clockedInAtRaw);
      if (!Number.isNaN(d.getTime())) {
        const iana = resolveTimezone(displayTz);
        const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: iana });
        return `${t} ${displayTz}`;
      }
    }
    return clockedInAt || '\u2014';
  })();

  return (
    <div className="space-y-6 max-w-2xl mx-auto w-full">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">My dashboard</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          {currentUser?.name} -- {currentUser?.designation || emp.role}
          {currentUser?.department_name && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand/10 text-brand dark:bg-brand/20 dark:text-brand-light">
              {currentUser.department_name}
            </span>
          )}
        </p>
        {currentUser?.work_timezone && (
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
            Timezone: {currentUser.work_timezone}
            {currentUser.work_hours ? ` | Hours: ${currentUser.work_hours}` : ''}
          </p>
        )}
      </div>

      {/* Shift card */}
      <div className={`rounded-xl p-5 ${cardClass} shadow-sm`}>
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <h3 className="font-semibold text-lg text-brand flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            My shift today
          </h3>
          <div className={`inline-flex rounded-lg p-0.5 text-xs font-medium ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`} role="group" aria-label="Select timezone">
            {['IST', 'CST'].map((tz) => (
              <button
                key={tz}
                type="button"
                onClick={() => setDisplayTz(tz)}
                aria-pressed={displayTz === tz}
                className={`px-3 py-1 rounded-md transition-colors ${
                  displayTz === tz
                    ? 'bg-brand text-white shadow-sm'
                    : isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tz}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <span className="text-gray-500 dark:text-gray-400">Shift</span>
          <span className="font-medium">{myShift}</span>
          <span className="text-gray-500 dark:text-gray-400">Login time</span>
          <span>{formattedLoginTime}</span>
          <span className="text-gray-500 dark:text-gray-400">Status</span>
          <span className="font-medium flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${isClockedIn ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className={isClockedIn ? 'text-brand' : ''}>{status}</span>
          </span>
          <span className="text-gray-500 dark:text-gray-400">Client</span>
          <span>{client?.name ?? emp.clientId}</span>
        </div>
        {(currentUser?.type === 'employee' || currentUser?.type === 'team_lead' || currentUser?.type === 'manager' || (currentUser?.type === 'admin' && todayShift)) && (
          <div className="mt-4 pt-4 border-t-2 border-gray-300 dark:border-slate-600">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Clock in when you start your shift.</p>
            {!isClockedIn ? (
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wfhToday}
                    onChange={(e) => setWfhToday(e.target.checked)}
                    className="rounded border-gray-300 text-brand focus:ring-brand w-5 h-5"
                  />
                  <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    Working from home today (no food coupon)
                  </span>
                </label>
                <button
                  type="button"
                  onClick={handleClockIn}
                  className="w-full sm:w-auto px-6 py-4 sm:py-3 rounded-lg text-white font-semibold text-lg sm:text-base border-2 border-brand-hover shadow-md hover:bg-brand-hover active:scale-[0.98] transition-all bg-brand min-h-[48px]"
                  aria-label="Clock in to your shift"
                >
                  Login to shift (Clock in)
                </button>

                {/* Clock-in error with shift change prompt */}
                {clockInError && (
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                    <div className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="flex-1">
                        <p className="text-sm text-red-700 dark:text-red-400">{clockInError}</p>
                        {offerShiftSwap && (
                          <p className="mt-2 text-sm font-medium text-red-800 dark:text-red-300">
                            You cannot clock in past the buffer window. Do you need a shift swap?
                          </p>
                        )}
                        {!showShiftChangeForm && (
                          <button
                            type="button"
                            onClick={() => { setShowShiftChangeForm(true); setScrDate(scrDate || today); }}
                            className="mt-2 w-full sm:w-auto px-4 py-3 sm:py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 active:scale-[0.98] text-white text-base sm:text-sm font-medium transition-all min-h-[48px] sm:min-h-0"
                          >
                            {offerShiftSwap ? 'Request Shift Swap' : 'Request Shift Change'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Inline shift change request form */}
                {showShiftChangeForm && (
                  <div className={`rounded-lg border p-4 ${isDark ? 'bg-slate-700/50 border-slate-600' : 'bg-indigo-50 border-indigo-200'}`}>
                    <h4 className="font-medium text-sm mb-3 flex items-center gap-2 text-indigo-700 dark:text-indigo-300">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Request Shift Change
                    </h4>
                    <form onSubmit={handleSubmitShiftChange} className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Date</label>
                        <input
                          type="date"
                          value={scrDate}
                          onChange={(e) => setScrDate(e.target.value)}
                          required
                          className={`w-full rounded-lg px-3 py-2.5 sm:py-2 border text-sm min-h-[44px] sm:min-h-0 ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Session</label>
                        <select
                          value={scrSession}
                          onChange={(e) => setScrSession(e.target.value)}
                          className={`w-full rounded-lg px-3 py-2.5 sm:py-2 border text-sm min-h-[44px] sm:min-h-0 ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                        >
                          <option value="full">Full Day</option>
                          <option value="session_1">Session 1 (First Half)</option>
                          <option value="session_2">Session 2 (Second Half)</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Requested Start</label>
                          <input
                            type="time"
                            value={scrStartTime}
                            onChange={(e) => setScrStartTime(e.target.value)}
                            required
                            className={`w-full rounded-lg px-3 py-2.5 sm:py-2 border text-sm min-h-[44px] sm:min-h-0 ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Requested End</label>
                          <input
                            type="time"
                            value={scrEndTime}
                            onChange={(e) => setScrEndTime(e.target.value)}
                            required
                            className={`w-full rounded-lg px-3 py-2.5 sm:py-2 border text-sm min-h-[44px] sm:min-h-0 ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Reason</label>
                        <textarea
                          value={scrReason}
                          onChange={(e) => setScrReason(e.target.value)}
                          rows={2}
                          placeholder="Why do you need a different shift time?"
                          className={`w-full rounded-lg px-3 py-2.5 sm:py-2 border text-sm ${isDark ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'}`}
                        />
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="submit"
                          disabled={scrSubmitting}
                          className="w-full sm:w-auto px-4 py-3 sm:py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 active:scale-[0.98] text-white text-base sm:text-sm font-medium transition-all disabled:opacity-50 min-h-[48px] sm:min-h-0"
                        >
                          {scrSubmitting ? 'Submitting...' : 'Submit Request'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowShiftChangeForm(false); setClockInError(null); }}
                          className={`w-full sm:w-auto px-4 py-3 sm:py-2 rounded-lg border text-base sm:text-sm min-h-[48px] sm:min-h-0 ${isDark ? 'border-slate-600 text-gray-300' : 'border-gray-300 text-gray-700'}`}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Shift change submitted success */}
                {scrSubmitted && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                    <svg className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="text-sm text-green-700 dark:text-green-400">Shift change request submitted. You will be able to clock in once approved.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <span className="text-sm text-green-700 dark:text-green-400 font-semibold flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  You clocked in at {formattedLoginTime}
                </span>
                <button
                  type="button"
                  onClick={onClockOut}
                  className="w-full sm:w-auto px-4 py-3 sm:py-2 rounded-lg bg-red-500 hover:bg-red-600 active:scale-[0.98] text-white text-base sm:text-sm font-semibold border-2 border-red-600 transition-all min-h-[48px] sm:min-h-0"
                  aria-label="Clock out from your shift"
                >
                  Clock out
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* My Shift Change Requests */}
      {isEmployeeOrTL && myShiftChanges.length > 0 && (
        <div className={`rounded-xl border p-5 ${cardClass}`}>
          <h3 className="font-medium mb-3 text-gray-900 dark:text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            My Shift Change Requests
          </h3>
          <div className="space-y-2">
            {myShiftChanges.slice(0, 5).map((scr) => {
              const reqDate = scr.request_date instanceof Date
                ? scr.request_date.toISOString().slice(0, 10)
                : String(scr.request_date).slice(0, 10);
              return (
                <div key={scr.id} className={`flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2 p-2.5 sm:p-2 rounded-lg ${isDark ? 'bg-slate-700/50' : 'bg-gray-50'}`}>
                  <div className="text-sm min-w-0">
                    <span className="font-medium">{reqDate}</span>
                    <span className="text-gray-400 mx-1">|</span>
                    <span>{scr.requested_start_time} - {scr.requested_end_time}</span>
                    {scr.original_start_time && (
                      <span className="text-gray-400 text-xs ml-1 block sm:inline">(was {scr.original_start_time}-{scr.original_end_time})</span>
                    )}
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 self-start sm:self-center ${scrStatusColor(scr.status)}`}>
                    {formatSCRStatus(scr.status)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Leave balance card */}
      {(() => {
        // Build last 4 weeks of leave data
        const todayD = new Date(today + 'T00:00:00');
        const myLeaves = (leaveRequests || []).filter((r) => {
          const eid = r.employeeId || r.employee_id;
          return eid === currentUser?.id && (r.status === 'approved' || (r.status || '').startsWith('pending'));
        });
        // Get leave dates as a Set of YYYY-MM-DD strings
        const leaveDateSet = new Set();
        myLeaves.forEach((r) => {
          const sd = String(r.start_date || r.leaveDate || '').slice(0, 10);
          const ed = String(r.end_date || r.leaveDate || '').slice(0, 10);
          if (!sd) return;
          const s = new Date(sd + 'T00:00:00');
          const e = ed ? new Date(ed + 'T00:00:00') : s;
          for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
            leaveDateSet.add(d.toISOString().slice(0, 10));
          }
        });
        // Build 4 weeks (most recent first): each week = Mon-Fri (5 working days)
        const weeks = [];
        // Find Monday of current week
        const dayOfWeek = todayD.getDay(); // 0=Sun
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const thisMonday = new Date(todayD);
        thisMonday.setDate(todayD.getDate() + mondayOffset);
        for (let w = 0; w < 4; w++) {
          const weekStart = new Date(thisMonday);
          weekStart.setDate(thisMonday.getDate() - (w * 7));
          const days = [];
          for (let d = 0; d < 5; d++) {
            const day = new Date(weekStart);
            day.setDate(weekStart.getDate() + d);
            const iso = day.toISOString().slice(0, 10);
            days.push({ date: iso, isLeave: leaveDateSet.has(iso), isFuture: iso > today });
          }
          const wLabel = new Date(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          weeks.unshift({ label: wLabel, days }); // unshift so oldest first
        }
        const totalTaken = [...leaveDateSet].filter((d) => d <= today && d >= weeks[0]?.days[0]?.date).length;
        // Planned = future leaves
        const planned = myLeaves.filter((r) => {
          const sd = String(r.start_date || '').slice(0, 10);
          return sd > today;
        });

        return (
          <div className={`rounded-xl border p-5 ${cardClass}`}>
            <h3 className="font-medium mb-4 text-gray-900 dark:text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              My leave balance
            </h3>
            {/* Stats row */}
            <div className="flex items-center gap-4 sm:gap-6 mb-4 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400 text-xs">Remaining</span>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{emp.leavesRemaining}</p>
              </div>
              <div className={`w-px h-8 ${isDark ? 'bg-slate-600' : 'bg-gray-200'}`} />
              <div>
                <span className="text-gray-500 dark:text-gray-400 text-xs">Taken (4 weeks)</span>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{totalTaken}</p>
              </div>
              <div className={`w-px h-8 ${isDark ? 'bg-slate-600' : 'bg-gray-200'}`} />
              <div>
                <span className="text-gray-500 dark:text-gray-400 text-xs">Planned</span>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{planned.length}</p>
              </div>
            </div>
            {/* Visual week grid */}
            <div className="flex items-center gap-0">
              {weeks.map((week, wi) => (
                <div key={wi} className={`flex-1 ${wi > 0 ? (isDark ? 'border-l border-slate-600' : 'border-l border-gray-200') : ''}`}>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center mb-1.5 font-medium">{week.label}</p>
                  <div className="flex items-center justify-center gap-1.5 px-1">
                    {week.days.map((day) => (
                      <div key={day.date} className="flex flex-col items-center" title={day.date}>
                        {day.isFuture ? (
                          <span className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center ${isDark ? 'text-slate-600' : 'text-gray-300'}`}>-</span>
                        ) : day.isLeave ? (
                          <span className="w-5 h-5 rounded bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[10px] font-bold flex items-center justify-center">L</span>
                        ) : (
                          <span className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center ${isDark ? 'bg-slate-700 text-green-400' : 'bg-green-50 text-green-500'}`}>&middot;</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
              <div className="flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded text-[8px] font-bold flex items-center justify-center ${isDark ? 'bg-slate-700 text-green-400' : 'bg-green-50 text-green-500'}`}>&middot;</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">Present</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[8px] font-bold flex items-center justify-center">L</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">Leave</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded text-[8px] font-bold flex items-center justify-center ${isDark ? 'text-slate-600' : 'text-gray-300'}`}>-</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">Future</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* My Leave Requests — with cancel */}
      {(() => {
        const myReqs = (leaveRequests || []).filter(r => {
          const eid = r.employeeId || r.employee_id;
          return eid === currentUser?.id;
        });
        if (myReqs.length === 0) return null;
        const isPending = (s) => s === 'pending_team_lead' || s === 'pending_managers' || s === 'pending_ceo';
        const statusLbl = (s) => ({ pending_team_lead: 'Awaiting TL', pending_managers: 'Awaiting Manager', pending_ceo: 'Awaiting CEO', approved: 'Approved', rejected: 'Rejected' }[s] || s);
        const statusClr = (s) => {
          if (s === 'approved') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
          if (s === 'rejected') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
          return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
        };
        const typeLbl = (t) => ({ casual: 'CL', sick: 'SL', comp: 'Comp', loss_of_pay: 'LOP' }[t] || t || '--');
        return (
          <div className={`rounded-xl border p-5 ${cardClass}`}>
            <h3 className="font-medium mb-3 text-gray-900 dark:text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              My Requests
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${isDark ? 'bg-slate-700 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>{myReqs.length}</span>
            </h3>
            <div className="space-y-2">
              {myReqs.map(r => {
                const sd = String(r.start_date || '').slice(0, 10);
                const ed = String(r.end_date || r.start_date || '').slice(0, 10);
                const fmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const dateStr = sd === ed ? fmt(sd) : `${fmt(sd)} - ${fmt(ed)}`;
                return (
                  <div key={r.id} className={`flex items-center gap-3 py-2 px-3 rounded-lg ${isDark ? 'bg-slate-700/50' : 'bg-gray-50'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{dateStr}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isDark ? 'bg-slate-600 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>{typeLbl(r.leave_type)}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusClr(r.status)}`}>{statusLbl(r.status)}</span>
                      </div>
                      {r.reason && <p className={`text-[11px] mt-0.5 truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{r.reason}</p>}
                    </div>
                    {isPending(r.status) && onCancelLeave && (
                      <button type="button"
                        onClick={() => { if (window.confirm('Cancel this leave request?')) onCancelLeave(r.id); }}
                        className="flex-shrink-0 text-xs px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 font-medium transition-colors">
                        Cancel
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Request leave card */}
      <div className={`rounded-xl border p-5 ${cardClass}`}>
        <h3 className="font-medium mb-3 text-gray-900 dark:text-white flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Request leave
        </h3>
        <form onSubmit={handleSubmitLeave} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label htmlFor="leave-from-date" className="block text-sm text-gray-500 dark:text-gray-400 mb-1">From date *</label>
              <input
                id="leave-from-date"
                type="date"
                value={fromDate}
                min={todayISO}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setSubmitted(false);
                  if (toDate && e.target.value > toDate) setToDate(e.target.value);
                }}
                required
                className={`w-full rounded-lg px-3 py-2.5 sm:py-2 border text-sm ${
                  isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'
                } focus:ring-2 focus:ring-brand min-h-[44px] sm:min-h-0`}
              />
            </div>
            <div className="w-full sm:w-32">
              <label htmlFor="leave-from-session" className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Session</label>
              <select
                id="leave-from-session"
                value={fromSession}
                onChange={(e) => setFromSession(Number(e.target.value))}
                className={`w-full rounded-lg px-3 py-2.5 sm:py-2 border text-sm ${
                  isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'
                } focus:ring-2 focus:ring-brand min-h-[44px] sm:min-h-0`}
              >
                <option value={1}>Session 1</option>
                <option value={2}>Session 2</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label htmlFor="leave-to-date" className="block text-sm text-gray-500 dark:text-gray-400 mb-1">To date *</label>
              <input
                id="leave-to-date"
                type="date"
                value={toDate}
                min={fromDate || todayISO}
                onChange={(e) => { setToDate(e.target.value); setSubmitted(false); }}
                required
                className={`w-full rounded-lg px-3 py-2.5 sm:py-2 border text-sm ${
                  isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'
                } focus:ring-2 focus:ring-brand min-h-[44px] sm:min-h-0`}
              />
            </div>
            <div className="w-full sm:w-32">
              <label htmlFor="leave-to-session" className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Session</label>
              <select
                id="leave-to-session"
                value={toSession}
                onChange={(e) => setToSession(Number(e.target.value))}
                className={`w-full rounded-lg px-3 py-2.5 sm:py-2 border text-sm ${
                  isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'
                } focus:ring-2 focus:ring-brand min-h-[44px] sm:min-h-0`}
              >
                <option value={1}>Session 1</option>
                <option value={2}>Session 2</option>
              </select>
            </div>
          </div>
          {toDate && fromDate && toDate < fromDate && (
            <p className="text-sm text-red-500">To date must be on or after the from date.</p>
          )}
          <div>
            <label htmlFor="leave-type" className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Leave type *</label>
            <select
              id="leave-type"
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value)}
              className={`w-full rounded-lg px-3 py-2.5 sm:py-2 border text-sm ${
                isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'
              } focus:ring-2 focus:ring-brand min-h-[44px] sm:min-h-0`}
            >
              <option value="casual">Casual Leave (CL)</option>
              <option value="sick">Sick Leave (SL)</option>
              <option value="comp">Comp Leave (Earned)</option>
              <option value="loss_of_pay">Loss of Pay (LOP)</option>
            </select>
          </div>
          <div>
            <label htmlFor="leave-reason" className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Reason</label>
            <textarea
              id="leave-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Describe the reason for your leave"
              className={`w-full rounded-lg px-3 py-2.5 sm:py-2 border text-sm ${
                isDark ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400' : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-500'
              } focus:ring-2 focus:ring-brand`}
            />
          </div>
          <button
            type="submit"
            disabled={!fromDate || !toDate || (toDate < fromDate)}
            className="w-full sm:w-auto px-4 py-3 sm:py-2 rounded-lg bg-brand hover:bg-brand-hover active:scale-[0.98] text-white text-base sm:text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] sm:min-h-0"
          >
            Submit request
          </button>
        </form>
        {submitted && (
          <div className="mt-3 flex items-center gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
            <svg className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-sm text-green-700 dark:text-green-400">Leave request submitted successfully.</p>
          </div>
        )}
      </div>
    </div>
  );
}
