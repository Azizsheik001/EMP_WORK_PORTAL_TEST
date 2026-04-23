import { useState, useEffect, useCallback } from 'react';
import { hasApi, api } from '../api/client';

function buildLeaveDaySet(employeeId, leaveRequests) {
  const set = new Set();
  (leaveRequests || []).forEach(r => {
    if (r.employeeId !== employeeId || r.status !== 'approved') return;
    const sd = String(r.start_date || '').slice(0, 10);
    const ed = String(r.end_date || r.start_date || '').slice(0, 10);
    if (!sd) return;
    let current = new Date(sd + 'T00:00:00');
    const end = new Date(ed + 'T00:00:00');
    while (current <= end) {
      set.add(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }
  });
  return set;
}

function buildSwapDaySet(employeeId, shiftChangeRequests) {
  const set = new Set();
  (shiftChangeRequests || []).forEach(r => {
    if (r.user_id !== employeeId) return;
    if (r.status !== 'approved') return;
    const rd = String(r.request_date || '').slice(0, 10);
    if (rd) set.add(rd);
  });
  return set;
}

/**
 * Count actual leave days used this year.
 * Only counts days that are in the past (already happened).
 * Future leave days are not deducted until they actually occur.
 * If clockedInDates is provided, days where the employee clocked in are excluded.
 */
function getYearLeaveDays(employeeId, leaveRequests, clockedInDates) {
  const year = new Date().getFullYear();
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const clockedSet = new Set(clockedInDates || []);
  let used = 0;
  let planned = 0;
  (leaveRequests || []).forEach(r => {
    if (r.employeeId !== employeeId || r.status !== 'approved') return;
    const sd = String(r.start_date || '').slice(0, 10);
    const ed = String(r.end_date || r.start_date || '').slice(0, 10);
    if (!sd || !sd.startsWith(String(year))) return;
    // Expand into individual dates
    let current = new Date(sd + 'T00:00:00');
    const end = new Date(ed + 'T00:00:00');
    while (current <= end) {
      const dateStr = current.toISOString().slice(0, 10);
      if (dateStr <= todayIST) {
        // Past date: only count if employee did NOT clock in
        if (!clockedSet.has(dateStr)) used++;
      } else {
        planned++; // Future — don't deduct yet
      }
      current.setDate(current.getDate() + 1);
    }
  });
  return { used, planned };
}

function PretextTimeline({ leaveDaySet, swapDaySet, totalLeaveDays4w, totalSwaps4w, yearLeaveDays, compOff, isDark }) {
  const ANNUAL_LEAVE_TOTAL = 16;
  const used = typeof yearLeaveDays === 'object' ? yearLeaveDays.used : Math.round(yearLeaveDays);
  const planned = typeof yearLeaveDays === 'object' ? yearLeaveDays.planned : 0;
  const remaining = ANNUAL_LEAVE_TOTAL - used;
  const taken4w = Math.round(totalLeaveDays4w);

  // Build 4 weeks grouped
  const weeks = [];
  for (let w = 3; w >= 0; w--) {
    const weekDays = [];
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - (w * 7 + 6));
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + d);
      const dateStr = day.toISOString().slice(0, 10);
      const dayOfWeek = day.getDay();
      weekDays.push({ dateStr, isWeekend: dayOfWeek === 0 || dayOfWeek === 6, isLeave: leaveDaySet.has(dateStr), isSwap: swapDaySet.has(dateStr) });
    }
    const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    weeks.push({ label, days: weekDays });
  }

  const subtleText = isDark ? 'text-gray-400' : 'text-gray-500';
  const cardBg = isDark ? 'bg-slate-700/50' : 'bg-gray-50';
  const borderCol = isDark ? 'border-slate-600' : 'border-gray-200';

  return (
    <div className={`mt-2.5 rounded-lg border ${borderCol} ${cardBg} p-2.5`}>
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Remaining</span>
          <p className={`text-lg font-bold leading-tight ${remaining <= 3 ? 'text-red-500' : ''}`}>{remaining >= 0 ? remaining : 0}</p>
        </div>
        <div className={`border-l ${borderCol} pl-3 flex-1`}>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Used</span>
          <p className="text-lg font-bold leading-tight">{used}</p>
        </div>
        {planned > 0 && (
          <div className={`border-l ${borderCol} pl-3 flex-1`}>
            <span className={`text-[10px] font-semibold uppercase tracking-wider text-amber-500`}>Planned</span>
            <p className="text-lg font-bold leading-tight text-amber-500">{planned}</p>
          </div>
        )}
        <div className={`border-l ${borderCol} pl-3 flex-1`}>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Taken (4w)</span>
          <p className="text-lg font-bold leading-tight">{taken4w}</p>
        </div>
        <div className={`border-l ${borderCol} pl-3 flex-1`}>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Swaps (4w)</span>
          <p className="text-lg font-bold leading-tight">{totalSwaps4w}</p>
        </div>
        {compOff && Number(compOff.available) > 0 && (
          <div className={`border-l ${borderCol} pl-3 flex-1`}>
            <span className={`text-[10px] font-semibold uppercase tracking-wider text-green-600 dark:text-green-400`}>Comp</span>
            <p className="text-lg font-bold leading-tight text-green-600 dark:text-green-400">{compOff.available}</p>
          </div>
        )}
      </div>
      <div className="flex gap-0">
        {weeks.map((week, wi) => (
          <div key={wi} className={`flex-1 px-1 ${wi < weeks.length - 1 ? `border-r ${borderCol}` : ''}`}>
            <p className={`text-[9px] ${subtleText} mb-0.5 truncate`}>{week.label}</p>
            <div className="flex gap-px">
              {week.days.map((day, di) => {
                let bg, text, label;
                if (day.isLeave) {
                  bg = 'bg-red-400 dark:bg-red-500'; text = 'text-white'; label = 'L';
                } else if (day.isSwap) {
                  bg = 'bg-blue-400 dark:bg-blue-500'; text = 'text-white'; label = 'S';
                } else if (day.isWeekend) {
                  bg = isDark ? 'bg-slate-600' : 'bg-gray-200'; text = isDark ? 'text-slate-500' : 'text-gray-400'; label = '-';
                } else {
                  bg = isDark ? 'bg-green-900/40' : 'bg-green-200'; text = isDark ? 'text-green-400' : 'text-green-600'; label = '\u00b7';
                }
                return (
                  <span key={di} title={day.dateStr} className={`w-2.5 h-2.5 rounded-sm ${bg} ${text} text-[7px] font-bold flex items-center justify-center leading-none`}>
                    {label}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function statusLabel(s) {
  const map = {
    pending_team_lead: 'Awaiting Team Lead approval',
    pending_managers: 'Awaiting Manager approval',
    pending_ceo: 'Awaiting CEO approval',
    approved: 'Approved',
    rejected: 'Rejected',
  };
  return map[s] || s;
}

function statusColor(s) {
  if (s === 'approved') return 'text-green-600 dark:text-green-400';
  if (s === 'rejected') return 'text-red-600 dark:text-red-400';
  return 'text-amber-600 dark:text-amber-400';
}

function statusBadge(s) {
  if (s === 'approved') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
  if (s === 'rejected') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
  return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
}

function roleLabel(role) {
  if (role === 'admin') return 'CEO';
  if (role === 'team_lead') return 'TL';
  if (role === 'manager') return 'Manager';
  return role;
}

function formatDateRange(startDate, endDate, totalDays) {
  if (!startDate) return '--';
  // Postgres DATE comes as "2026-03-15" or "2026-03-15T00:00:00.000Z" — normalize to YYYY-MM-DD
  const norm = (d) => String(d).slice(0, 10);
  const fmt = (d) => {
    const date = new Date(norm(d) + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  if (!endDate || norm(startDate) === norm(endDate)) return fmt(startDate);
  const startFmt = new Date(norm(startDate) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endFmt = fmt(endDate);
  const suffix = totalDays ? ` (${totalDays} day${totalDays > 1 ? 's' : ''})` : '';
  return `${startFmt} - ${endFmt}${suffix}`;
}

function formatTimestamp(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST';
}

function ApprovalProgress({ approvalChain, showTimestamp = false }) {
  if (!approvalChain?.length) return <span className="text-gray-400 dark:text-gray-500 text-xs">No approvals yet</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {approvalChain.map((entry, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
          title={entry.at ? `Approved on ${new Date(entry.at).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })} IST` : ''}
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {entry.user_name || entry.userName} ({roleLabel(entry.role)})
        </span>
      ))}
    </div>
  );
}

// Compute recent leave/shift-swap history for an employee (last 4 weeks)
function getEmployeeContext(employeeId, leaveRequests, shiftChangeRequests, clockedInDates) {
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const cutoffDate = fourWeeksAgo.toISOString().slice(0, 10); // "YYYY-MM-DD"

  const recentLeaves = (leaveRequests || []).filter((r) => {
    if (r.employeeId !== employeeId) return false;
    if (r.status !== 'approved') return false;
    // Use start_date (already normalized to YYYY-MM-DD) for cutoff comparison
    const sd = String(r.start_date || r.requestedAt || '').slice(0, 10);
    return sd >= cutoffDate;
  });
  const leavesByType = {};
  let totalLeaveDays = 0;
  recentLeaves.forEach((r) => {
    const type = r.leave_type || 'annual';
    leavesByType[type] = (leavesByType[type] || 0) + (Number(r.total_days) || 1);
    totalLeaveDays += Number(r.total_days) || 1;
  });

  const recentShiftSwaps = (shiftChangeRequests || []).filter((r) => {
    if (r.user_id !== employeeId) return false;
    const cd = String(r.created_at || '').slice(0, 10);
    return cd >= cutoffDate;
  });

  const leaveDaySet = buildLeaveDaySet(employeeId, leaveRequests);
  const swapDaySet = buildSwapDaySet(employeeId, shiftChangeRequests);
  const yearLeaveDays = getYearLeaveDays(employeeId, leaveRequests, clockedInDates);

  return { recentLeaves: recentLeaves.length, totalLeaveDays, leavesByType, recentShiftSwaps: recentShiftSwaps.length, leaveDaySet, swapDaySet, yearLeaveDays };
}

export default function LeavesView({ leaveRequests: rawLeaveRequests, allLeaveRequests: rawAllLeaveRequests, currentUser, onApprove, onReject, onCancelLeave, onSplitLeave, isDark, myOnly = false, approvalsOnly = false, shiftChangeRequests = [], allShiftChangeRequests, onApproveShiftChange, onRejectShiftChange, compOffSummary }) {
  // Ensure arrays are always valid (filter out any null/undefined entries)
  const leaveRequests = Array.isArray(rawLeaveRequests) ? rawLeaveRequests.filter(Boolean) : [];
  const allLeaveRequests = Array.isArray(rawAllLeaveRequests) ? rawAllLeaveRequests.filter(Boolean) : [];

  // Use all* variants for context lookups AND for approved/rejected/pipeline views
  const contextLeaveSource = allLeaveRequests.length > 0 ? allLeaveRequests : leaveRequests;
  const contextShiftSource = allShiftChangeRequests && allShiftChangeRequests.length > 0 ? allShiftChangeRequests : shiftChangeRequests;
  const fullLeaveSource = contextLeaveSource; // all leaves for pipeline/approved/rejected sections
  const fullShiftSource = contextShiftSource; // all shift changes for approved/rejected sections

  const userType = currentUser?.type;
  const userId = currentUser?.id;

  // Fetch clocked-in-on-leave-dates so we don't count those as "used"
  const [clockedInOnLeaveDates, setClockedInOnLeaveDates] = useState({});
  useEffect(() => {
    if (!hasApi() || !userId) return;
    // Fetch balance for current user
    api.leaveRequests.balance(userId)
      .then(data => {
        setClockedInOnLeaveDates(prev => ({ ...prev, [userId]: data.clocked_in_on_leave_dates || [] }));
      })
      .catch(() => {});
  }, [userId, leaveRequests]);
  const canApprove = userType === 'team_lead' || userType === 'manager' || userType === 'admin';

  // Date filter state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Date filter helper — checks if a leave/shift request falls within the date range
  const inDateRange = (startDate) => {
    if (!dateFrom && !dateTo) return true;
    const sd = String(startDate || '').slice(0, 10);
    if (!sd) return true;
    if (dateFrom && sd < dateFrom) return false;
    if (dateTo && sd > dateTo) return false;
    return true;
  };

  const pending = canApprove
    ? leaveRequests.filter((r) => {
        if (r.employeeId === userId) return false;
        if ((r.approvalChain || []).some((a) => a.userId === userId || a.user_id === userId)) return false;
        if (userType === 'team_lead') return r.status === 'pending_team_lead';
        if (userType === 'manager') return r.status === 'pending_managers';
        if (userType === 'admin') return r.status === 'pending_ceo';
        return false;
      })
    : [];

  const myRequests = leaveRequests.filter((r) => r.employeeId === userId);

  // Use full data source for approved/rejected/pipeline — not just actionable requests
  const approved = canApprove
    ? fullLeaveSource.filter((r) => r.status === 'approved' && r.employeeId !== userId && inDateRange(r.start_date))
    : [];

  const rejected = canApprove
    ? fullLeaveSource.filter((r) => r.status === 'rejected' && r.employeeId !== userId && inDateRange(r.start_date))
    : [];

  const resolved = [...approved, ...rejected];

  const allPending = canApprove
    ? fullLeaveSource.filter((r) => (r.status === 'pending_team_lead' || r.status === 'pending_managers' || r.status === 'pending_ceo') && r.employeeId !== userId)
    : [];

  const cardClass = isDark
    ? 'bg-slate-800 border-slate-600 text-white'
    : 'bg-white border-gray-200 text-gray-900';
  const tableRowClass = isDark
    ? 'border-slate-600 hover:bg-slate-700/50'
    : 'border-gray-200 hover:bg-gray-50';

  // Edit/split state for my leaves
  const [editingLeave, setEditingLeave] = useState(null); // leave request being edited
  const [excludedDates, setExcludedDates] = useState(new Set());
  const [cancelConfirm, setCancelConfirm] = useState(null);

  const isPending = (status) => status === 'pending_team_lead' || status === 'pending_managers' || status === 'pending_ceo';

  // Expand a leave request's date range into individual dates
  const expandDates = (startDate, endDate) => {
    const dates = [];
    const sd = new Date(String(startDate).slice(0, 10) + 'T00:00:00');
    const ed = new Date(String(endDate || startDate).slice(0, 10) + 'T00:00:00');
    for (let d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  };

  const handleStartEdit = (r) => {
    setEditingLeave(r);
    setExcludedDates(new Set());
  };

  const handleToggleDate = (date) => {
    setExcludedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const handleSaveEdit = () => {
    if (!editingLeave || !onSplitLeave || excludedDates.size === 0) return;
    onSplitLeave(editingLeave.id, Array.from(excludedDates));
    setEditingLeave(null);
    setExcludedDates(new Set());
  };

  const handleConfirmCancel = (id) => {
    if (onCancelLeave) onCancelLeave(id);
    setCancelConfirm(null);
  };

  // My Leaves only view
  if (myOnly) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">My Leave Requests</h1>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${myRequests.length > 0 ? 'bg-brand/10 text-brand' : 'bg-gray-100 dark:bg-slate-700 text-gray-500'}`}>
            {myRequests.length} request{myRequests.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
          {myRequests.length === 0 ? (
            <div className="p-8 text-center">
              <svg className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm text-gray-500 dark:text-gray-400">No leave requests yet.</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Submit a leave request from My Shift page.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-full text-left text-sm">
                <thead>
                  <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                    <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Dates</th>
                    <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Type</th>
                    <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Approval Progress</th>
                    <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Requested</th>
                    <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {myRequests.map((r) => (
                    <tr key={r.id} className={`border-b ${tableRowClass}`}>
                      <td className="px-4 py-3 font-medium">{formatDateRange(r.start_date, r.end_date, r.total_days)}</td>
                      <td className="px-4 py-3"><span className="capitalize">{r.leave_type || '--'}</span>{r.reason && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.reason}</p>}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge(r.status)}`}>
                          {statusLabel(r.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.status === 'rejected' && r.rejectedBy
                          ? <div>
                              <span className="text-red-600 dark:text-red-400 text-xs">Rejected{r.rejectedAt ? ` on ${formatTimestamp(r.rejectedAt)}` : ''}</span>
                              {r.rejectedByName && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">by {r.rejectedByName}</p>}
                              {r.rejectionNotes && <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 italic">{r.rejectionNotes}</p>}
                            </div>
                          : <ApprovalProgress approvalChain={r.approvalChain} />}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                        {formatTimestamp(r.requestedAt)}
                      </td>
                      <td className="px-4 py-3">
                        {isPending(r.status) && (
                          <div className="flex items-center gap-2">
                            {r.start_date !== r.end_date && (
                              <button
                                type="button"
                                onClick={() => handleStartEdit(r)}
                                className="text-xs px-2.5 py-1 rounded-lg bg-brand/10 text-brand hover:bg-brand/20 font-medium transition-colors"
                              >
                                Edit dates
                              </button>
                            )}
                            {cancelConfirm === r.id ? (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleConfirmCancel(r.id)}
                                  className="text-xs px-2 py-1 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition-colors"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCancelConfirm(null)}
                                  className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-gray-400 font-medium hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setCancelConfirm(r.id)}
                                className="text-xs px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 font-medium transition-colors"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Edit dates modal */}
        {editingLeave && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingLeave(null)}>
            <div className={`rounded-xl shadow-xl w-full max-w-md p-6 ${isDark ? 'bg-slate-800 text-white' : 'bg-white text-gray-900'}`} onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-1">Edit Leave Dates</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Uncheck dates you want to remove. The request will be split into separate ranges.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                {expandDates(editingLeave.start_date, editingLeave.end_date).map((date) => {
                  const excluded = excludedDates.has(date);
                  const dayName = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
                  const dayNum = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => handleToggleDate(date)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                        excluded
                          ? (isDark ? 'border-red-800 bg-red-900/30 text-red-400 line-through' : 'border-red-200 bg-red-50 text-red-400 line-through')
                          : (isDark ? 'border-slate-600 bg-slate-700 text-white' : 'border-gray-200 bg-gray-50 text-gray-900')
                      }`}
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                        excluded
                          ? 'border-red-400 bg-red-100 dark:bg-red-900/50'
                          : 'border-brand bg-brand text-white'
                      }`}>
                        {!excluded && (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span>{dayName}, {dayNum}</span>
                    </button>
                  );
                })}
              </div>
              {excludedDates.size > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
                  {excludedDates.size} date{excludedDates.size > 1 ? 's' : ''} will be removed. The remaining dates will be kept as separate requests if needed.
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingLeave(null)}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium ${isDark ? 'border-slate-600 text-gray-300 hover:bg-slate-700' : 'border-gray-300 text-gray-700 hover:bg-gray-100'} transition-colors`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={excludedDates.size === 0}
                  className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save changes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Shift change requests categorized
  const myShiftChanges = shiftChangeRequests.filter((r) => r.user_id === userId);
  const pendingShiftChanges = canApprove
    ? shiftChangeRequests.filter((r) => {
        if (r.user_id === userId) return false;
        if ((r.approval_chain || []).some((a) => a.user_id === userId)) return false;
        if (userType === 'team_lead') return r.status === 'pending_team_lead';
        if (userType === 'manager') return r.status === 'pending_managers';
        if (userType === 'admin') return r.status === 'pending_ceo';
        return false;
      })
    : [];
  const approvedShiftChanges = canApprove
    ? fullShiftSource.filter((r) => r.status === 'approved' && r.user_id !== userId && inDateRange(r.request_date))
    : [];
  const rejectedShiftChanges = canApprove
    ? fullShiftSource.filter((r) => r.status === 'rejected' && r.user_id !== userId && inDateRange(r.request_date))
    : [];

  // Requests view (for all roles including employee)
  if (approvalsOnly) {
    // For employees, show their own requests
    const isEmployee = userType === 'employee';

    return (
      <div className="space-y-8 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{isEmployee ? 'My Requests' : 'Requests'}</h1>
            {!isEmployee && pending.length > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                {pending.length} pending
              </span>
            )}
          </div>
          {!isEmployee && (
            <div className="flex flex-wrap items-center gap-2 text-sm w-full sm:w-auto">
              <label className="text-gray-500 dark:text-gray-400">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={`flex-1 sm:flex-none rounded-lg px-2 py-1 border text-sm ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-700'}`}
              />
              <label className="text-gray-500 dark:text-gray-400">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={`flex-1 sm:flex-none rounded-lg px-2 py-1 border text-sm ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-700'}`}
              />
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="text-xs text-brand hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {/* Employee: My Leave Requests */}
        {isEmployee && myRequests.length > 0 && (
          <section>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              My Leave Requests
              <span className={`text-xs px-2 py-0.5 rounded-full ${myRequests.length > 0 ? 'bg-brand/10 text-brand' : 'bg-gray-100 dark:bg-slate-700 text-gray-500'}`}>{myRequests.length}</span>
            </h2>
            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-full text-left text-sm">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Dates</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Type</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Approval Progress</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Requested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myRequests.map((r) => (
                      <tr key={r.id} className={`border-b ${tableRowClass}`}>
                        <td className="px-4 py-3 font-medium">{formatDateRange(r.start_date, r.end_date, r.total_days)}</td>
                        <td className="px-4 py-3"><span className="capitalize">{r.leave_type || '--'}</span>{r.reason && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.reason}</p>}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge(r.status)}`}>
                            {statusLabel(r.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {r.status === 'rejected' && r.rejectedBy
                            ? <span className="text-red-600 dark:text-red-400 text-xs">Rejected{r.rejectedAt ? ` on ${formatTimestamp(r.rejectedAt)}` : ''}</span>
                            : <ApprovalProgress approvalChain={r.approvalChain} />}
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                          {formatTimestamp(r.requestedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* Employee: My Shift Change Requests */}
        {isEmployee && myShiftChanges.length > 0 && (
          <section>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              My Shift Change Requests
              <span className={`text-xs px-2 py-0.5 rounded-full ${myShiftChanges.length > 0 ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'bg-gray-100 dark:bg-slate-700 text-gray-500'}`}>{myShiftChanges.length}</span>
            </h2>
            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-full text-left text-sm">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Date</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Shift Change</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Reason</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Approvals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myShiftChanges.map((scr) => {
                      const reqDate = String(scr.request_date || '').slice(0, 10);
                      return (
                        <tr key={scr.id} className={`border-b ${tableRowClass}`}>
                          <td className="px-4 py-3 font-medium">{reqDate}</td>
                          <td className="px-4 py-3">
                            {scr.original_start_time && scr.original_end_time
                              ? `${scr.original_start_time}-${scr.original_end_time}`
                              : 'No current shift'}
                            {' -> '}
                            <span className="font-medium text-indigo-600 dark:text-indigo-400">{scr.requested_start_time}-{scr.requested_end_time}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{scr.reason || '--'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge(scr.status)}`}>
                              {statusLabel(scr.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <ApprovalProgress approvalChain={
                              (Array.isArray(scr.approval_chain) ? scr.approval_chain : []).map((e) => ({
                                role: e.role,
                                userName: e.user_name,
                              }))
                            } />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* Employee: empty state */}
        {isEmployee && myRequests.length === 0 && myShiftChanges.length === 0 && (
          <div className={`rounded-xl border p-8 text-center ${cardClass}`}>
            <svg className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400">No requests yet.</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Submit a leave or shift change request from My Work page.</p>
          </div>
        )}

        {/* Below sections only for approvers (TL/Manager/Admin) */}
        {!isEmployee && (<>


        {/* Pending approvals */}
        <section>
          <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            Pending for Your Approval
            {pending.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-500 text-white">{pending.length}</span>
            )}
          </h2>
          <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
            {pending.length === 0 ? (
              <div className="p-6 text-center">
                <svg className="w-10 h-10 mx-auto text-green-400 dark:text-green-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-gray-500 dark:text-gray-400">All caught up! No pending approvals.</p>
              </div>
            ) : (
              <div className="divide-y divide-inherit">
                {pending.map((req) => {
                  const ctx = getEmployeeContext(req.employeeId, contextLeaveSource, contextShiftSource, clockedInOnLeaveDates[req.employeeId]);
                  return (
                  <div key={req.id} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center text-brand text-xs font-bold">
                            {(req.employeeName || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium">{req.employeeName}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {[roleLabel(req.employeeRole), req.clientName, req.departmentName].filter(Boolean).join(' · ') || '--'}
                            </p>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 ml-10">
                          {formatDateRange(req.start_date, req.end_date, req.total_days)}
                          <span className="text-gray-400 mx-1">|</span>
                          <span className="capitalize">{req.leave_type || 'annual'}</span>{req.reason && <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">- {req.reason}</span>}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 ml-10">
                          Requested {formatTimestamp(req.requestedAt)}
                        </p>
                        {/* Context: dot timeline + summary */}
                        <div className="ml-10">
                          <PretextTimeline
                            leaveDaySet={ctx.leaveDaySet}
                            swapDaySet={ctx.swapDaySet}
                            totalLeaveDays4w={ctx.totalLeaveDays}
                            totalSwaps4w={ctx.recentShiftSwaps}
                            yearLeaveDays={ctx.yearLeaveDays}
                            compOff={compOffSummary ? compOffSummary[req.employeeId] : null}
                            isDark={isDark}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => onApprove(req.id)}
                          className="px-4 py-2 rounded-lg text-white text-sm font-medium bg-brand hover:bg-brand-hover transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => onReject(req.id)}
                          className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                    {req.approvalChain?.length > 0 && (
                      <div className="pt-1 ml-10">
                        <ApprovalProgress approvalChain={req.approvalChain} />
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* All requests in pipeline (visible to admin always, others when more pending exist) */}
        {(userType === 'admin' ? allPending.length > 0 : allPending.length > pending.length) && (
          <section>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Requests in Pipeline ({allPending.length})
            </h2>
            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-full text-left text-sm">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Employee</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Dates</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Type</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Approvals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allPending.map((r) => {
                      const ctx = getEmployeeContext(r.employeeId, contextLeaveSource, contextShiftSource, clockedInOnLeaveDates[r.employeeId]);
                      return (
                      <tr key={r.id} className={`border-b ${tableRowClass}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{r.employeeName}</p>
                          <PretextTimeline
                            leaveDaySet={ctx.leaveDaySet}
                            swapDaySet={ctx.swapDaySet}
                            totalLeaveDays4w={ctx.totalLeaveDays}
                            totalSwaps4w={ctx.recentShiftSwaps}
                            yearLeaveDays={ctx.yearLeaveDays}
                            compOff={compOffSummary ? compOffSummary[r.employeeId] : null}
                            isDark={isDark}
                          />
                        </td>
                        <td className="px-4 py-3">{formatDateRange(r.start_date, r.end_date, r.total_days)}</td>
                        <td className="px-4 py-3"><span className="capitalize">{r.leave_type || '--'}</span>{r.reason && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.reason}</p>}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge(r.status)}`}>
                            {statusLabel(r.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3"><ApprovalProgress approvalChain={r.approvalChain} /></td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* Pending Shift Change Requests */}
        {pendingShiftChanges.length > 0 && (
          <section>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Pending Shift Changes
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500 text-white">{pendingShiftChanges.length}</span>
            </h2>
            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
              <div className="divide-y divide-inherit">
                {pendingShiftChanges.map((scr) => {
                  const reqDate = String(scr.request_date || '').slice(0, 10);
                  const ctx = getEmployeeContext(scr.user_id, contextLeaveSource, contextShiftSource, clockedInOnLeaveDates[scr.user_id]);
                  return (
                    <div key={scr.id} className="p-4 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-xs font-bold">
                              {(scr.user_name || '?')[0].toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium">{scr.user_name}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">Date: {reqDate}</p>
                            </div>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-300 ml-10">
                            {scr.original_start_time && scr.original_end_time
                              ? `${scr.original_start_time}-${scr.original_end_time}`
                              : 'No current shift'}
                            <span className="text-gray-400 mx-2">-&gt;</span>
                            <span className="font-medium text-indigo-600 dark:text-indigo-400">{scr.requested_start_time}-{scr.requested_end_time}</span>
                          </p>
                          {scr.reason && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 ml-10">Reason: {scr.reason}</p>
                          )}
                          {/* Context: dot timeline + summary */}
                          <div className="ml-10">
                            <PretextTimeline
                              leaveDaySet={ctx.leaveDaySet}
                              swapDaySet={ctx.swapDaySet}
                              totalLeaveDays4w={ctx.totalLeaveDays}
                              totalSwaps4w={ctx.recentShiftSwaps}
                              yearLeaveDays={ctx.yearLeaveDays}
                              compOff={compOffSummary ? compOffSummary[scr.user_id] : null}
                              isDark={isDark}
                            />
                          </div>
                          <div className="ml-10">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge(scr.status)}`}>
                              {statusLabel(scr.status)}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          {onApproveShiftChange && (
                            <button
                              type="button"
                              onClick={() => onApproveShiftChange(scr.id)}
                              className="px-4 py-2 rounded-lg text-white text-sm font-medium bg-brand hover:bg-brand-hover transition-colors"
                            >
                              Approve
                            </button>
                          )}
                          {onRejectShiftChange && (
                            <button
                              type="button"
                              onClick={() => onRejectShiftChange(scr.id)}
                              className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      </div>
                      {scr.approval_chain?.length > 0 && (
                        <div className="pt-1 ml-10">
                          <ApprovalProgress approvalChain={
                            (Array.isArray(scr.approval_chain) ? scr.approval_chain : []).map((e) => ({
                              role: e.role,
                              userName: e.user_name,
                            }))
                          } />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Approved Leaves */}
        {approved.length > 0 && (
          <section>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Approved Leaves ({approved.length})
            </h2>
            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-full text-left text-sm">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Employee</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Dates</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Type</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Approved By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approved.map((r) => {
                      const ctx = getEmployeeContext(r.employeeId, contextLeaveSource, contextShiftSource, clockedInOnLeaveDates[r.employeeId]);
                      return (
                      <tr key={r.id} className={`border-b ${tableRowClass}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{r.employeeName}</p>
                          <PretextTimeline
                            leaveDaySet={ctx.leaveDaySet}
                            swapDaySet={ctx.swapDaySet}
                            totalLeaveDays4w={ctx.totalLeaveDays}
                            totalSwaps4w={ctx.recentShiftSwaps}
                            yearLeaveDays={ctx.yearLeaveDays}
                            compOff={compOffSummary ? compOffSummary[r.employeeId] : null}
                            isDark={isDark}
                          />
                        </td>
                        <td className="px-4 py-3">{formatDateRange(r.start_date, r.end_date, r.total_days)}</td>
                        <td className="px-4 py-3"><span className="capitalize">{r.leave_type || '--'}</span>{r.reason && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.reason}</p>}</td>
                        <td className="px-4 py-3"><ApprovalProgress approvalChain={r.approvalChain} /></td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* Approved Shift Changes */}
        {approvedShiftChanges.length > 0 && (
          <section>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Approved Shift Changes ({approvedShiftChanges.length})
            </h2>
            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-full text-left text-sm">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Employee</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Date</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Shift Change</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Approved By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvedShiftChanges.map((scr) => {
                      const ctx = getEmployeeContext(scr.user_id, contextLeaveSource, contextShiftSource, clockedInOnLeaveDates[scr.user_id]);
                      return (
                      <tr key={scr.id} className={`border-b ${tableRowClass}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{scr.user_name}</p>
                          <PretextTimeline
                            leaveDaySet={ctx.leaveDaySet}
                            swapDaySet={ctx.swapDaySet}
                            totalLeaveDays4w={ctx.totalLeaveDays}
                            totalSwaps4w={ctx.recentShiftSwaps}
                            yearLeaveDays={ctx.yearLeaveDays}
                            compOff={compOffSummary ? compOffSummary[scr.user_id] : null}
                            isDark={isDark}
                          />
                        </td>
                        <td className="px-4 py-3">{String(scr.request_date || '').slice(0, 10)}</td>
                        <td className="px-4 py-3">
                          {scr.original_start_time && scr.original_end_time
                            ? `${scr.original_start_time}-${scr.original_end_time}`
                            : '--'}
                          {' -> '}
                          <span className="font-medium text-indigo-600 dark:text-indigo-400">{scr.requested_start_time}-{scr.requested_end_time}</span>
                        </td>
                        <td className="px-4 py-3">
                          <ApprovalProgress approvalChain={
                            (Array.isArray(scr.approval_chain) ? scr.approval_chain : []).map((e) => ({
                              role: e.role,
                              userName: e.user_name,
                            }))
                          } />
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* Rejected Leaves */}
        {rejected.length > 0 && (
          <section>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Rejected Leaves ({rejected.length})
            </h2>
            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-full text-left text-sm">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Employee</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Dates</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Type</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejected.map((r) => {
                      const ctx = getEmployeeContext(r.employeeId, contextLeaveSource, contextShiftSource, clockedInOnLeaveDates[r.employeeId]);
                      return (
                      <tr key={r.id} className={`border-b ${tableRowClass}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{r.employeeName}</p>
                          <PretextTimeline
                            leaveDaySet={ctx.leaveDaySet}
                            swapDaySet={ctx.swapDaySet}
                            totalLeaveDays4w={ctx.totalLeaveDays}
                            totalSwaps4w={ctx.recentShiftSwaps}
                            yearLeaveDays={ctx.yearLeaveDays}
                            compOff={compOffSummary ? compOffSummary[r.employeeId] : null}
                            isDark={isDark}
                          />
                        </td>
                        <td className="px-4 py-3">{formatDateRange(r.start_date, r.end_date, r.total_days)}</td>
                        <td className="px-4 py-3"><span className="capitalize">{r.leave_type || '--'}</span>{r.reason && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.reason}</p>}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className="text-red-500">{r.rejectedAt ? formatTimestamp(r.rejectedAt) : 'Rejected'}</span>
                          {r.rejectedByName && (
                            <p className="text-gray-500 dark:text-gray-400 mt-0.5">by {r.rejectedByName}</p>
                          )}
                          {r.rejectionNotes && (
                            <p className="text-gray-600 dark:text-gray-300 mt-0.5 italic">{r.rejectionNotes}</p>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* Rejected Shift Changes */}
        {rejectedShiftChanges.length > 0 && (
          <section>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Rejected Shift Changes ({rejectedShiftChanges.length})
            </h2>
            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-full text-left text-sm">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Employee</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Date</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Shift Change</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejectedShiftChanges.map((scr) => {
                      const ctx = getEmployeeContext(scr.user_id, contextLeaveSource, contextShiftSource, clockedInOnLeaveDates[scr.user_id]);
                      return (
                      <tr key={scr.id} className={`border-b ${tableRowClass}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{scr.user_name}</p>
                          <PretextTimeline
                            leaveDaySet={ctx.leaveDaySet}
                            swapDaySet={ctx.swapDaySet}
                            totalLeaveDays4w={ctx.totalLeaveDays}
                            totalSwaps4w={ctx.recentShiftSwaps}
                            yearLeaveDays={ctx.yearLeaveDays}
                            compOff={compOffSummary ? compOffSummary[scr.user_id] : null}
                            isDark={isDark}
                          />
                        </td>
                        <td className="px-4 py-3">{String(scr.request_date || '').slice(0, 10)}</td>
                        <td className="px-4 py-3">
                          {scr.original_start_time && scr.original_end_time
                            ? `${scr.original_start_time}-${scr.original_end_time}`
                            : '--'}
                          {' -> '}
                          <span className="font-medium text-indigo-600 dark:text-indigo-400">{scr.requested_start_time}-{scr.requested_end_time}</span>
                        </td>
                        <td className="px-4 py-3 text-red-500 text-xs">
                          {scr.rejected_at ? formatTimestamp(scr.rejected_at) : 'Rejected'}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
        {/* My Approvals — requests I personally approved */}
        {(() => {
          const myApprovedLeaves = leaveRequests.filter((r) =>
            r.status === 'approved' && r.employeeId !== userId &&
            (r.approvalChain || []).some((a) => (a.userId || a.user_id) === userId)
          );
          const myApprovedShifts = shiftChangeRequests.filter((r) =>
            r.status === 'approved' && r.user_id !== userId &&
            (r.approval_chain || []).some((a) => a.user_id === userId)
          );
          if (myApprovedLeaves.length === 0 && myApprovedShifts.length === 0) return null;
          return (
            <section>
              <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <svg className="w-5 h-5 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                My Approvals ({myApprovedLeaves.length + myApprovedShifts.length})
              </h2>
              {myApprovedLeaves.length > 0 && (
                <div className={`rounded-xl border overflow-hidden mb-4 ${cardClass}`}>
                  <div className={`px-4 py-2 border-b ${isDark ? 'border-slate-600 bg-slate-700/30' : 'border-gray-200 bg-gray-50'}`}>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Leaves I Approved</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-full text-left text-sm">
                      <thead>
                        <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                          <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Employee</th>
                          <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Dates</th>
                          <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Type</th>
                          <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Full Chain</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myApprovedLeaves.map((r) => (
                          <tr key={r.id} className={`border-b ${tableRowClass}`}>
                            <td className="px-4 py-3 font-medium">{r.employeeName}</td>
                            <td className="px-4 py-3">{formatDateRange(r.start_date, r.end_date, r.total_days)}</td>
                            <td className="px-4 py-3"><span className="capitalize">{r.leave_type || '--'}</span>{r.reason && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.reason}</p>}</td>
                            <td className="px-4 py-3"><ApprovalProgress approvalChain={r.approvalChain} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {myApprovedShifts.length > 0 && (
                <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
                  <div className={`px-4 py-2 border-b ${isDark ? 'border-slate-600 bg-slate-700/30' : 'border-gray-200 bg-gray-50'}`}>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Shift Changes I Approved</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-full text-left text-sm">
                      <thead>
                        <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                          <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Employee</th>
                          <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Date</th>
                          <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Shift Change</th>
                          <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Full Chain</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myApprovedShifts.map((scr) => (
                          <tr key={scr.id} className={`border-b ${tableRowClass}`}>
                            <td className="px-4 py-3 font-medium">{scr.user_name}</td>
                            <td className="px-4 py-3">{String(scr.request_date || '').slice(0, 10)}</td>
                            <td className="px-4 py-3">
                              {scr.original_start_time && scr.original_end_time
                                ? `${scr.original_start_time}-${scr.original_end_time}`
                                : '--'}
                              {' -> '}
                              <span className="font-medium text-indigo-600 dark:text-indigo-400">{scr.requested_start_time}-{scr.requested_end_time}</span>
                            </td>
                            <td className="px-4 py-3">
                              <ApprovalProgress approvalChain={
                                (Array.isArray(scr.approval_chain) ? scr.approval_chain : []).map((e) => ({
                                  role: e.role,
                                  userName: e.user_name,
                                }))
                              } />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          );
        })()}

        </>)}
      </div>
    );
  }

  // Default: full view (backward compatible)
  return (
    <div className="space-y-8 max-w-5xl mx-auto w-full">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Leave Requests</h1>

      <section>
        <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3">My Leave Requests</h2>
        <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
          {myRequests.length === 0 ? (
            <p className="p-4 text-sm text-gray-500 dark:text-gray-400">No leave requests yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-full text-left text-sm">
                <thead>
                  <tr className={`border-b ${isDark ? 'border-slate-600' : 'border-gray-200'}`}>
                    <th className="px-4 py-3 font-medium">Dates</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Approval Progress</th>
                    <th className="px-4 py-3 font-medium">Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {myRequests.map((r) => (
                    <tr key={r.id} className={`border-b ${tableRowClass}`}>
                      <td className="px-4 py-3">{formatDateRange(r.start_date, r.end_date, r.total_days)}</td>
                      <td className="px-4 py-3"><span className="capitalize">{r.leave_type || '--'}</span>{r.reason && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.reason}</p>}</td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${statusColor(r.status)}`}>{statusLabel(r.status)}</span>
                      </td>
                      <td className="px-4 py-3">
                        {r.status === 'rejected' && r.rejectedBy
                          ? <div>
                              <span className="text-red-600 dark:text-red-400 text-xs">Rejected{r.rejectedAt ? ` on ${formatTimestamp(r.rejectedAt)}` : ''}</span>
                              {r.rejectedByName && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">by {r.rejectedByName}</p>}
                              {r.rejectionNotes && <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 italic">{r.rejectionNotes}</p>}
                            </div>
                          : <ApprovalProgress approvalChain={r.approvalChain} />}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{formatTimestamp(r.requestedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {canApprove && (
        <section>
          <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3">Pending for Your Approval ({pending.length})</h2>
          <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
            {pending.length === 0 ? (
              <p className="p-4 text-sm text-gray-500 dark:text-gray-400">No pending leave requests.</p>
            ) : (
              <div className="divide-y divide-inherit">
                {pending.map((req) => (
                  <div key={req.id} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium">{req.employeeName}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {formatDateRange(req.start_date, req.end_date, req.total_days)}
                          <span className="mx-1">|</span>
                          <span className="capitalize">{req.leave_type || 'annual'}</span>{req.reason && <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">- {req.reason}</span>}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button type="button" onClick={() => onApprove(req.id)} className="px-4 py-2 rounded-lg text-white text-sm font-medium bg-brand hover:bg-brand-hover">Approve</button>
                        <button type="button" onClick={() => onReject(req.id)} className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium">Reject</button>
                      </div>
                    </div>
                    {req.approvalChain?.length > 0 && <ApprovalProgress approvalChain={req.approvalChain} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
