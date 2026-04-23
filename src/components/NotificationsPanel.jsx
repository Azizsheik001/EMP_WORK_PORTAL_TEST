import { useState } from 'react';
import useModalKeyboard from '../hooks/useModalKeyboard';

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

function getYearLeaveDays(employeeId, leaveRequests) {
  const year = new Date().getFullYear();
  let total = 0;
  (leaveRequests || []).forEach(r => {
    if (r.employeeId !== employeeId || r.status !== 'approved') return;
    const sd = String(r.start_date || '').slice(0, 10);
    if (sd && sd.startsWith(String(year))) {
      total += Number(r.total_days) || 1;
    }
  });
  return total;
}

function getLeaveContext(employeeId, leaveRequests, shiftChangeRequests) {
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const cutoffDate = fourWeeksAgo.toISOString().slice(0, 10);
  const recentLeaves = (leaveRequests || []).filter((r) => {
    if (r.employeeId !== employeeId) return false;
    if (r.status !== 'approved') return false;
    const sd = String(r.start_date || r.requestedAt || '').slice(0, 10);
    return sd >= cutoffDate;
  });
  let totalDays = 0;
  recentLeaves.forEach((r) => {
    totalDays += Number(r.total_days) || 1;
  });
  const recentSwaps = (shiftChangeRequests || []).filter((r) => {
    if (r.user_id !== employeeId) return false;
    const cd = String(r.created_at || '').slice(0, 10);
    return cd >= cutoffDate;
  }).length;

  const leaveDaySet = buildLeaveDaySet(employeeId, leaveRequests);
  const swapDaySet = buildSwapDaySet(employeeId, shiftChangeRequests);
  const yearLeaveDays = getYearLeaveDays(employeeId, leaveRequests);

  return { totalDays, recentSwaps, leaveDaySet, swapDaySet, yearLeaveDays };
}

function PretextTimeline({ leaveDaySet, swapDaySet, totalLeaveDays4w, totalSwaps4w, yearLeaveDays, compOff, isDark }) {
  const ANNUAL_LEAVE_TOTAL = 20;
  const remaining = ANNUAL_LEAVE_TOTAL - Math.round(yearLeaveDays);
  const taken4w = Math.round(totalLeaveDays4w);

  // Build 4 weeks of days grouped by week
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
      {/* Summary row */}
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Remaining</span>
          <p className={`text-lg font-bold leading-tight ${remaining <= 3 ? 'text-red-500' : ''}`}>{remaining >= 0 ? remaining : 0}</p>
        </div>
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
      {/* Weekly dot timeline */}
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

function getPendingForUser(leaveRequests, currentUser) {
  if (!currentUser || !leaveRequests) return { pending: [], unacknowledged: [] };
  const userId = currentUser.id;
  const type = currentUser.type;
  const pending = leaveRequests.filter((r) => {
    if (r.employeeId === userId) return false;
    if ((r.approvalChain || []).some((a) => a.userId === userId)) return false;
    if (type === 'team_lead') return r.status === 'pending_team_lead';
    if (type === 'manager') return r.status === 'pending_managers';
    if (type === 'admin') return r.status === 'pending_ceo';
    return false;
  });
  const unacknowledged = type === 'admin'
    ? leaveRequests.filter((r) => r.status === 'approved' && !r.acknowledgedBy && r.employeeId !== userId)
    : [];
  return { pending, unacknowledged };
}

function formatDateRange(startDate, endDate, totalDays) {
  // Normalize to "YYYY-MM-DD" — handles both "2026-03-19" and "2026-03-19T00:00:00.000Z"
  const norm = (d) => d ? String(d).slice(0, 10) : null;
  const fmt = (d) => {
    const n = norm(d);
    if (!n) return '--';
    const date = new Date(n + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const sd = norm(startDate);
  const ed = norm(endDate);
  if (!sd) return ed ? fmt(ed) : '--';
  if (sd === ed || !ed) return fmt(sd);
  const startFmt = new Date(sd + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endFmt = fmt(ed);
  const suffix = totalDays ? ` (${totalDays}d)` : '';
  return `${startFmt} - ${endFmt}${suffix}`;
}

export default function NotificationsPanel({
  isOpen,
  onClose,
  leaveRequests,
  allLeaveRequests,
  currentUser,
  onApprove,
  onReject,
  onAcknowledge,
  onApproveShiftChange,
  onRejectShiftChange,
  shiftChangeRequests = [],
  allShiftChangeRequests,
  isDark,
  compOffSummary,
  adminAlerts = [],
  onDismissAlert,
  autoLogoutNotices = [],
  onDismissAutoLogout,
}) {
  // Use full datasets for context lookups
  const contextLeaves = allLeaveRequests && allLeaveRequests.length > 0 ? allLeaveRequests : leaveRequests;
  const contextShifts = allShiftChangeRequests && allShiftChangeRequests.length > 0 ? allShiftChangeRequests : shiftChangeRequests;
  const { pending, unacknowledged } = getPendingForUser(leaveRequests, currentUser);
  const pendingShiftChanges = shiftChangeRequests.filter((r) => {
    if (r.user_id === currentUser?.id) return false;
    if ((r.approval_chain || []).some((a) => a.user_id === currentUser?.id)) return false;
    const type = currentUser?.type;
    if (type === 'team_lead') return r.status === 'pending_team_lead';
    if (type === 'manager') return r.status === 'pending_managers';
    if (type === 'admin') return r.status === 'pending_ceo';
    return false;
  });
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectNotes, setRejectNotes] = useState('');

  // Rejected leaves for current employee (last 7 days)
  const recentRejectedLeaves = (() => {
    if (!currentUser || !contextLeaves) return [];
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString();
    return contextLeaves.filter((r) => {
      if (r.employeeId !== currentUser.id) return false;
      if (r.status !== 'rejected') return false;
      const rejAt = r.rejectedAt || r.requestedAt;
      return rejAt && rejAt >= cutoff;
    });
  })();

  const modalRef = useModalKeyboard(isOpen, onClose);
  const panelClass = isDark
    ? 'bg-slate-800 border-slate-600 text-white'
    : 'bg-white border-gray-200 text-gray-900';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-label="Notifications">
      <div
        ref={modalRef}
        className={`w-full max-w-md ${panelClass} border-l shadow-xl flex flex-col max-h-full overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-inherit flex justify-between items-center">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:opacity-80" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {pending.length === 0 && unacknowledged.length === 0 && pendingShiftChanges.length === 0 && adminAlerts.length === 0 && recentRejectedLeaves.length === 0 && autoLogoutNotices.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No pending notifications.</p>
          ) : (
            <div className="space-y-4">
              {/* Admin Alerts (mobile device flags, etc.) */}
              {adminAlerts.length > 0 && (
                <>
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    Alerts ({adminAlerts.length})
                  </p>
                  {adminAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`rounded-lg border-2 p-3 ${
                        isDark ? 'border-amber-800/50 bg-amber-900/20' : 'border-amber-200 bg-amber-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            {alert.employee_name || 'Employee'}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{alert.message}</p>
                          {alert.details?.device_mismatches > 0 && (
                            <p className="text-[11px] text-red-600 dark:text-red-400 mt-1 font-medium">
                              {alert.details.device_mismatches} times: clocked in from desktop, clocked out from mobile
                            </p>
                          )}
                          <p className={`text-[10px] mt-1.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            {new Date(alert.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onDismissAlert?.(alert.id)}
                          className={`p-1 rounded hover:opacity-80 flex-shrink-0 ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-400 hover:text-gray-600'}`}
                          title="Dismiss"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {/* Auto-logout reminders */}
              {autoLogoutNotices.length > 0 && (
                <>
                  <p className="text-sm font-medium text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Auto-Logout Reminder ({autoLogoutNotices.length})
                  </p>
                  {autoLogoutNotices.map((notice) => {
                    const dateStr = notice.shift_date;
                    const dateObj = new Date(dateStr + 'T00:00:00');
                    const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                    const logoutTime = notice.auto_logout_at
                      ? new Date(notice.auto_logout_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
                      : 'N/A';
                    const shiftEnd = notice.shift_end_time
                      ? (() => { const [h, m] = notice.shift_end_time.split(':').map(Number); const ampm = h >= 12 ? 'PM' : 'AM'; const hr = h % 12 || 12; return `${hr}:${String(m).padStart(2, '0')} ${ampm}`; })()
                      : null;
                    return (
                      <div
                        key={dateStr}
                        className={`rounded-lg border-2 p-3 ${
                          isDark ? 'border-orange-800/50 bg-orange-900/20' : 'border-orange-200 bg-orange-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-orange-700 dark:text-orange-300">
                              {formattedDate}
                            </p>
                            <p className={`text-xs mt-1.5 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                              Your shift ended{shiftEnd ? ` at ${shiftEnd}` : ''}, but you did not log out. The system auto-logged you out at <span className="font-semibold">{logoutTime}</span>.
                            </p>
                            <p className={`text-xs mt-1.5 font-medium ${isDark ? 'text-orange-400' : 'text-orange-600'}`}>
                              Please remember to log out when your shift ends.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => onDismissAutoLogout?.(dateStr)}
                            className={`p-1 rounded hover:opacity-80 flex-shrink-0 ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-400 hover:text-gray-600'}`}
                            title="Dismiss"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
              {pending.length > 0 && (
                <>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Leave requests ({pending.length})
                  </p>
                  {pending.map((req) => {
                    const ctx = getLeaveContext(req.employeeId, contextLeaves, contextShifts);
                    return (
                    <div
                      key={req.id}
                      className={`rounded-lg border-2 p-3 ${
                        isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <p className="font-medium text-gray-900 dark:text-white">{req.employeeName}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                        {[req.employeeRole === 'employee' ? 'Employee' : req.employeeRole === 'team_lead' ? 'TL' : req.employeeRole === 'manager' ? 'Manager' : req.employeeRole, req.clientName, req.departmentName].filter(Boolean).join(' · ')} -- {formatDateRange(req.start_date, req.end_date, req.total_days)}
                      </p>
                      {req.leave_type && (
                        <p className="text-sm text-gray-500 dark:text-gray-500 mt-1 capitalize">{req.leave_type}</p>
                      )}
                      {req.approvalChain?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {req.approvalChain.map((a, i) => (
                            <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                              {a.role === 'team_lead' ? 'TL' : a.role === 'admin' ? 'CEO' : 'Mgr'}: {a.userName}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Context: dot timeline + summary */}
                      <PretextTimeline
                        leaveDaySet={ctx.leaveDaySet}
                        swapDaySet={ctx.swapDaySet}
                        totalLeaveDays4w={ctx.totalDays}
                        totalSwaps4w={ctx.recentSwaps}
                        yearLeaveDays={ctx.yearLeaveDays}
                        compOff={compOffSummary ? compOffSummary[req.employeeId] : null}
                        isDark={isDark}
                      />
                      {rejectingId === req.id ? (
                        <div className="mt-3 space-y-2">
                          <textarea
                            className={`w-full rounded-lg border px-3 py-2 text-sm resize-none ${isDark ? 'bg-slate-600 border-slate-500 text-white placeholder-gray-400' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'}`}
                            rows={2}
                            placeholder="Rejection reason (optional)"
                            value={rejectNotes}
                            onChange={(e) => setRejectNotes(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => { onReject(req.id, rejectNotes.trim() || undefined); setRejectingId(null); setRejectNotes(''); }}
                              className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium"
                            >
                              Confirm Reject
                            </button>
                            <button
                              type="button"
                              onClick={() => { setRejectingId(null); setRejectNotes(''); }}
                              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${isDark ? 'bg-slate-600 hover:bg-slate-500 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() => onApprove(req.id)}
                            className="px-3 py-1.5 rounded-lg text-white text-sm font-medium bg-brand hover:bg-brand-hover"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => { setRejectingId(req.id); setRejectNotes(''); }}
                            className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </>
              )}
              {unacknowledged.length > 0 && (
                <>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Approved - awaiting acknowledgement ({unacknowledged.length})
                  </p>
                  {unacknowledged.map((req) => {
                    const ctx = getLeaveContext(req.employeeId, contextLeaves, contextShifts);
                    return (
                    <div
                      key={req.id}
                      className={`rounded-lg border-2 p-3 ${
                        isDark ? 'border-green-800/50 bg-green-900/20' : 'border-green-200 bg-green-50'
                      }`}
                    >
                      <p className="font-medium text-gray-900 dark:text-white">{req.employeeName}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                        {[req.employeeRole === 'employee' ? 'Employee' : req.employeeRole === 'team_lead' ? 'TL' : req.employeeRole === 'manager' ? 'Manager' : req.employeeRole, req.clientName, req.departmentName].filter(Boolean).join(' · ')} -- {formatDateRange(req.start_date, req.end_date, req.total_days)}
                      </p>
                      {req.leave_type && (
                        <p className="text-sm text-gray-500 dark:text-gray-500 mt-1 capitalize">{req.leave_type}</p>
                      )}
                      {req.approvalChain?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {req.approvalChain.map((a, i) => (
                            <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                              {a.role === 'team_lead' ? 'TL' : a.role === 'admin' ? 'CEO' : 'Mgr'}: {a.userName}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Context: dot timeline + summary */}
                      <PretextTimeline
                        leaveDaySet={ctx.leaveDaySet}
                        swapDaySet={ctx.swapDaySet}
                        totalLeaveDays4w={ctx.totalDays}
                        totalSwaps4w={ctx.recentSwaps}
                        yearLeaveDays={ctx.yearLeaveDays}
                        compOff={compOffSummary ? compOffSummary[req.employeeId] : null}
                        isDark={isDark}
                      />
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 mt-1.5">
                        Approved
                      </span>
                      <div className="flex gap-2 mt-3">
                        <button
                          type="button"
                          onClick={() => onAcknowledge(req.id)}
                          className="px-3 py-1.5 rounded-lg text-white text-sm font-medium bg-brand hover:bg-brand-hover"
                        >
                          OK
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </>
              )}
              {pendingShiftChanges.length > 0 && (
                <>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Shift change requests ({pendingShiftChanges.length})
                  </p>
                  {pendingShiftChanges.map((req) => {
                    const fmtTime = (t) => t ? t.split(':').slice(0, 2).join(':') : '—';
                    return (
                      <div
                        key={req.id}
                        className={`rounded-lg border-2 p-3 ${
                          isDark ? 'border-blue-800/50 bg-blue-900/20' : 'border-blue-200 bg-blue-50'
                        }`}
                      >
                        <p className="font-medium text-gray-900 dark:text-white">{req.user_name || 'Employee'}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                          Date: {req.request_date ? String(req.request_date).slice(0, 10) : '—'}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-500 mt-0.5">
                          {fmtTime(req.original_start_time)}-{fmtTime(req.original_end_time)} → <span className="font-medium text-blue-600 dark:text-blue-400">{fmtTime(req.requested_start_time)}-{fmtTime(req.requested_end_time)}</span>
                        </p>
                        {req.reason && (
                          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">Reason: {req.reason}</p>
                        )}
                        <div className="flex gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() => onApproveShiftChange?.(req.id)}
                            className="px-3 py-1.5 rounded-lg text-white text-sm font-medium bg-brand hover:bg-brand-hover"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => onRejectShiftChange?.(req.id)}
                            className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
              {/* Rejected leave notifications for employees */}
              {recentRejectedLeaves.length > 0 && (
                <>
                  <p className="text-sm font-medium text-red-600 dark:text-red-400 flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Rejected Leaves ({recentRejectedLeaves.length})
                  </p>
                  {recentRejectedLeaves.map((req) => (
                    <div
                      key={req.id}
                      className={`rounded-lg border-2 p-3 ${
                        isDark ? 'border-red-800/50 bg-red-900/20' : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatDateRange(req.start_date, req.end_date, req.total_days)}
                      </p>
                      {req.leave_type && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 capitalize">{req.leave_type}</p>
                      )}
                      {req.rejectedByName && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                          Rejected by {req.rejectedByName}
                        </p>
                      )}
                      {req.rejectionNotes && (
                        <p className={`text-xs mt-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          Reason: {req.rejectionNotes}
                        </p>
                      )}
                      {req.rejectedAt && (
                        <p className={`text-[10px] mt-1.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {new Date(req.rejectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
