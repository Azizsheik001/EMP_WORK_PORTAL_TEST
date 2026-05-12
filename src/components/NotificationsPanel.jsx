import { useEffect, useState } from 'react';
import useModalKeyboard from '../hooks/useModalKeyboard';
import { api } from '../api/client';
import {
  isCarrieLu,
  getPendingDocumentsForUser,
  getCompletedDocumentsForCarrie,
  downloadCompletedDocument,
  setActiveDocumentRequest,
  deleteDocumentRequest,
} from '../utils/documentStorage';

function buildLeaveDaySet(employeeId, leaveRequests) {
  const set = new Set();
  (leaveRequests || []).forEach((r) => {
    if ((r.employeeId || r.employee_id) !== employeeId || r.status !== 'approved') return;
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

  (shiftChangeRequests || []).forEach((r) => {
    if (r.user_id !== employeeId) return;
    if (!['approved', 'acknowledged'].includes(r.status)) return;

    const fromDate = String(r.from_date || r.request_date || '').slice(0, 10);
    const toDate = String(r.to_date || r.request_date || fromDate).slice(0, 10);
    if (!fromDate) return;

    let current = new Date(fromDate + 'T00:00:00');
    const end = new Date(toDate + 'T00:00:00');

    while (current <= end) {
      set.add(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }
  });

  return set;
}

function getYearLeaveDays(employeeId, leaveRequests) {
  const year = new Date().getFullYear();
  let total = 0;

  (leaveRequests || []).forEach((r) => {
    if ((r.employeeId || r.employee_id) !== employeeId || r.status !== 'approved') return;
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
    if ((r.employeeId || r.employee_id) !== employeeId) return false;
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

  return {
    totalDays,
    recentSwaps,
    leaveDaySet: buildLeaveDaySet(employeeId, leaveRequests),
    swapDaySet: buildSwapDaySet(employeeId, shiftChangeRequests),
    yearLeaveDays: getYearLeaveDays(employeeId, leaveRequests),
  };
}

function PretextTimeline({
  leaveDaySet,
  swapDaySet,
  totalLeaveDays4w,
  totalSwaps4w,
  yearLeaveDays,
  compOff,
  isDark,
}) {
  const ANNUAL_LEAVE_TOTAL = 20;
  const remaining = ANNUAL_LEAVE_TOTAL - Math.round(yearLeaveDays);
  const taken4w = Math.round(totalLeaveDays4w);

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

      weekDays.push({
        dateStr,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        isLeave: leaveDaySet.has(dateStr),
        isSwap: swapDaySet.has(dateStr),
      });
    }

    weeks.push({
      label: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      days: weekDays,
    });
  }

  const subtleText = isDark ? 'text-gray-400' : 'text-gray-500';
  const cardBg = isDark ? 'bg-slate-700/50' : 'bg-gray-50';
  const borderCol = isDark ? 'border-slate-600' : 'border-gray-200';

  return (
    <div className={`mt-2.5 rounded-lg border ${borderCol} ${cardBg} p-2.5`}>
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>
            Remaining
          </span>
          <p className={`text-lg font-bold leading-tight ${remaining <= 3 ? 'text-red-500' : ''}`}>
            {remaining >= 0 ? remaining : 0}
          </p>
        </div>

        <div className={`border-l ${borderCol} pl-3 flex-1`}>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>
            Taken (4w)
          </span>
          <p className="text-lg font-bold leading-tight">{taken4w}</p>
        </div>

        <div className={`border-l ${borderCol} pl-3 flex-1`}>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>
            Swaps (4w)
          </span>
          <p className="text-lg font-bold leading-tight">{totalSwaps4w}</p>
        </div>

        {compOff && Number(compOff.available) > 0 && (
          <div className={`border-l ${borderCol} pl-3 flex-1`}>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">
              Comp
            </span>
            <p className="text-lg font-bold leading-tight text-green-600 dark:text-green-400">
              {compOff.available}
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-0">
        {weeks.map((week, wi) => (
          <div
            key={wi}
            className={`flex-1 px-1 ${wi < weeks.length - 1 ? `border-r ${borderCol}` : ''}`}
          >
            <p className={`text-[9px] ${subtleText} mb-0.5 truncate`}>{week.label}</p>
            <div className="flex gap-px">
              {week.days.map((day, di) => {
                let bg;
                let text;
                let label;

                if (day.isLeave) {
                  bg = 'bg-red-400 dark:bg-red-500';
                  text = 'text-white';
                  label = 'L';
                } else if (day.isSwap) {
                  bg = 'bg-blue-400 dark:bg-blue-500';
                  text = 'text-white';
                  label = 'S';
                } else if (day.isWeekend) {
                  bg = isDark ? 'bg-slate-600' : 'bg-gray-200';
                  text = isDark ? 'text-slate-500' : 'text-gray-400';
                  label = '-';
                } else {
                  bg = isDark ? 'bg-green-900/40' : 'bg-green-200';
                  text = isDark ? 'text-green-400' : 'text-green-600';
                  label = '\u00b7';
                }

                return (
                  <span
                    key={di}
                    title={day.dateStr}
                    className={`w-2.5 h-2.5 rounded-sm ${bg} ${text} text-[7px] font-bold flex items-center justify-center leading-none`}
                  >
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

function getPendingForUser(leaveRequests, currentUser, allUsers) {
  if (!currentUser || !leaveRequests) return { pending: [], unacknowledged: [] };

  const userId = currentUser.id;
  const type = currentUser.type;
  const isHRorFinance =
    currentUser.department_name === 'HR' ||
    currentUser.department_name === 'Human Resources' ||
    currentUser.department_name === 'Finance';

  const pending = leaveRequests.filter((r) => {
    const requesterId = r.employeeId || r.employee_id;
    if (requesterId === userId) return false;

    if ((r.approvalChain || []).some((a) => a.userId === userId || a.user_id === userId)) {
      return false;
    }

    const st = r.status;

    if (type === 'admin' || isHRorFinance) {
      return ['pending_team_lead', 'pending_managers', 'pending_ceo'].includes(st);
    }

    const requester = (allUsers || []).find((u) => u.id === requesterId);

    if (type === 'team_lead') {
      if (st !== 'pending_team_lead') return false;
      return requester && (requester.team_lead_id === userId || requester.id === userId);
    }

    if (type === 'manager') {
      if (st !== 'pending_managers') return false;
      return requester && (requester.manager_id === userId || requester.id === userId);
    }

    return false;
  });

  const unacknowledged =
    type === 'admin' || isHRorFinance
      ? leaveRequests.filter(
          (r) =>
            r.status === 'approved' &&
            !r.acknowledgedBy &&
            (r.employeeId || r.employee_id) !== userId
        )
      : [];

  return { pending, unacknowledged };
}

function formatDateRange(startDate, endDate, totalDays) {
  const norm = (d) => (d ? String(d).slice(0, 10) : null);

  const fmt = (d) => {
    const n = norm(d);
    if (!n) return '--';
    const date = new Date(n + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const sd = norm(startDate);
  const ed = norm(endDate);

  if (!sd) return ed ? fmt(ed) : '--';
  if (sd === ed || !ed) return fmt(sd);

  const startFmt = new Date(sd + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const endFmt = fmt(ed);
  const suffix = totalDays ? ` (${totalDays}d)` : '';

  return `${startFmt} - ${endFmt}${suffix}`;
}

function formatName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatShiftChangeDateLabel(req) {
  const kind = req.request_kind || 'future_change';
  const fromDate = String(req.from_date || req.request_date || '').slice(0, 10);
  const toDate = String(req.to_date || '').slice(0, 10);

  if (!fromDate) return 'Date: —';

  const fmt = (d) =>
    new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  if (kind === 'permanent_change') {
    return `Effective from: ${fmt(fromDate)}`;
  }

  if (!toDate || toDate === fromDate) {
    return `Date: ${fmt(fromDate)}`;
  }

  const startShort = new Date(fromDate + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return `Date: ${startShort} - ${fmt(toDate)}`;
}

function formatShiftKind(kind) {
  if (kind === 'past_acknowledgement') return 'Past Ack';
  if (kind === 'permanent_change') return 'Permanent';
  return 'Future';
}

function shiftKindBadgeClass(kind) {
  if (kind === 'past_acknowledgement') {
    return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300';
  }
  if (kind === 'permanent_change') {
    return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
  }
  return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';
}

function hasSeenByUser(req, userId) {
  const seen = req?.seen_by || req?.seenBy || [];
  return seen.some((item) => {
    if (typeof item === 'string') return item === userId;
    return item?.user_id === userId || item?.userId === userId;
  });
}

export default function NotificationsPanel({
  isOpen,
  onClose,
  leaveRequests = [],
  allLeaveRequests,
  currentUser,
  allUsers = [],
  onApprove,
  onReject,
  onAcknowledge,
  onApproveShiftChange,
  onRejectShiftChange,
  onAcknowledgeShiftChange,
  onAcknowledgeShiftNotice,
  shiftChangeRequests = [],
  allShiftChangeRequests,
  isDark,
  compOffSummary,
  adminAlerts = [],
  onDismissAlert,
  autoLogoutNotices = [],
  onDismissAutoLogout,
}) {
  const contextLeaves =
    allLeaveRequests && allLeaveRequests.length > 0 ? allLeaveRequests : leaveRequests;

  const contextShifts =
    allShiftChangeRequests && allShiftChangeRequests.length > 0
      ? allShiftChangeRequests
      : shiftChangeRequests;

  const { pending, unacknowledged } = getPendingForUser(
    leaveRequests,
    currentUser,
    allUsers
  );

  const [rejectingId, setRejectingId] = useState(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [dismissedIds, setDismissedIds] = useState(new Set());
  const [dismissedShiftNoticeIds, setDismissedShiftNoticeIds] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Backend/Supabase NDA notifications
  const [backendPendingShreeNdas, setBackendPendingShreeNdas] = useState([]);
  const [backendCompletedNdas, setBackendCompletedNdas] = useState([]);
  const [ndaLoading, setNdaLoading] = useState(false);

  const refreshNotifications = () => setRefreshKey((k) => k + 1);

  const dismissNotification = (id) => {
    setDismissedIds((prev) => new Set([...prev, id]));
  };

  const isHRorFinance =
    currentUser?.department_name === 'HR' ||
    currentUser?.department_name === 'Human Resources' ||
    currentUser?.department_name === 'Finance';

  const carrieOnly = isCarrieLu(currentUser);
  const currentEmail = String(currentUser?.email || '').toLowerCase();
  const shreeOnly = currentEmail === 'shreey@amgsol.com' || currentUser?.type === 'admin';

  const getDismissedBackendShreeIds = () => {
    try {
      return JSON.parse(localStorage.getItem('ags_dismissed_shree_nda_ids') || '[]');
    } catch {
      return [];
    }
  };

  const saveDismissedBackendShreeId = (id) => {
    try {
      const ids = new Set(getDismissedBackendShreeIds());
      ids.add(id);
      localStorage.setItem('ags_dismissed_shree_nda_ids', JSON.stringify([...ids]));
    } catch {}
  };

  useEffect(() => {
    if (!isOpen || !currentUser) return;

    let active = true;

    async function loadBackendNdaNotifications() {
      try {
        setNdaLoading(true);

        const dismissedShreeIds = getDismissedBackendShreeIds();

        if (shreeOnly) {
          const data = await api.nda.getShreePending();
          if (active) {
            setBackendPendingShreeNdas(
              (data.ndas || []).filter((nda) => !dismissedShreeIds.includes(nda.id))
            );
          }
        } else if (active) {
          setBackendPendingShreeNdas([]);
        }

        if (carrieOnly) {
          const data = await api.nda.getCarrieCompleted();
          if (active) setBackendCompletedNdas(data.ndas || []);
        } else if (active) {
          setBackendCompletedNdas([]);
        }
      } catch {
        if (active) {
          setBackendPendingShreeNdas([]);
          setBackendCompletedNdas([]);
        }
      } finally {
        if (active) setNdaLoading(false);
      }
    }

    loadBackendNdaNotifications();

    return () => {
      active = false;
    };
  }, [isOpen, currentUser, currentEmail, shreeOnly, carrieOnly, refreshKey]);

  const signedNdaList = carrieOnly ? backendCompletedNdas : [];
  const pendingShreeNdas = shreeOnly ? backendPendingShreeNdas : [];
  const pendingDocuments = getPendingDocumentsForUser(currentUser);
  const completedDocuments = getCompletedDocumentsForCarrie(currentUser);

  const showNdaCard = carrieOnly && signedNdaList.length > 0;

  const pendingShiftChanges = shiftChangeRequests.filter((r) => {
    if (dismissedShiftNoticeIds.includes(r.id)) return false;
    if (r.user_id === currentUser?.id) return false;
    if (hasSeenByUser(r, currentUser?.id)) return false;

    const type = currentUser?.type;
    const kind = r.request_kind || 'future_change';
    const st = r.status;

    if (kind === 'past_acknowledgement') {
      if (type === 'admin' || isHRorFinance || type === 'manager') return true;

      if (type === 'team_lead') {
        const requester = (allUsers || []).find((u) => u.id === r.user_id);
        return requester && (requester.team_lead_id === currentUser?.id || requester.id === currentUser?.id);
      }

      return false;
    }

    if ((r.approval_chain || []).some((a) => a.user_id === currentUser?.id || a.userId === currentUser?.id)) {
      return false;
    }

    if (type === 'admin' || isHRorFinance) {
      return ['pending_team_lead', 'pending_managers', 'pending_ceo'].includes(st);
    }

    const requester = (allUsers || []).find((u) => u.id === r.user_id);

    if (type === 'team_lead') {
      if (st !== 'pending_team_lead') return false;
      return requester && (requester.team_lead_id === currentUser?.id || requester.id === currentUser?.id);
    }

    if (type === 'manager') {
      if (st !== 'pending_managers') return false;
      return requester && (requester.manager_id === currentUser?.id || requester.id === currentUser?.id);
    }

    return false;
  });

  const unacknowledgedShiftChanges =
    currentUser?.type === 'admin' || isHRorFinance
      ? contextShifts.filter(
          (r) => r.status === 'approved' && !hasSeenByUser(r, currentUser?.id)
        )
      : [];

  const recentRejectedLeaves = (() => {
    if (!currentUser || !contextLeaves) return [];

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString();

    return contextLeaves.filter((r) => {
      if ((r.employeeId || r.employee_id) !== currentUser.id) return false;
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

  const isEmpty =
    pending.filter((r) => !dismissedIds.has(r.id)).length === 0 &&
    unacknowledged.length === 0 &&
    pendingShiftChanges.length === 0 &&
    unacknowledgedShiftChanges.length === 0 &&
    adminAlerts.length === 0 &&
    recentRejectedLeaves.length === 0 &&
    autoLogoutNotices.length === 0 &&
    pendingShreeNdas.length === 0 &&
    pendingDocuments.length === 0 &&
    completedDocuments.length === 0 &&
    !showNdaCard;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
      data-refresh-key={refreshKey}
    >
      <div
        ref={modalRef}
        className={`w-full max-w-md ${panelClass} border-l shadow-xl flex flex-col max-h-full overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-inherit flex justify-between items-center">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:opacity-80"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isEmpty ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No pending notifications.</p>
          ) : (
            <div className="space-y-4">
              {ndaLoading && (
                <p className="text-xs text-gray-500 dark:text-gray-400">Checking NDA notifications...</p>
              )}

              {shreeOnly && pendingShreeNdas.length > 0 && (
                <>
                  <p className="text-sm font-medium text-purple-600 dark:text-purple-400">
                    Pending NDA Review ({pendingShreeNdas.length})
                  </p>

                  {pendingShreeNdas.map((nda) => (
                    <div
                      key={nda.id || nda.email}
                      className={`relative rounded-lg border-2 p-3 ${
                        isDark ? 'border-purple-800/50 bg-purple-900/20' : 'border-purple-200 bg-purple-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          saveDismissedBackendShreeId(nda.id);
                          setBackendPendingShreeNdas((prev) => prev.filter((item) => item.id !== nda.id));
                          refreshNotifications();
                        }}
                        className={`absolute right-3 top-3 rounded p-1 ${
                          isDark ? 'text-purple-300 hover:text-red-300' : 'text-purple-700 hover:text-red-600'
                        }`}
                        title="Remove notification"
                      >
                        ✕
                      </button>

                      <p className="text-sm font-semibold text-purple-700 dark:text-purple-300 pr-7">
                        NDA Review Required
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Employee: {nda.employee_name || nda.fullName || nda.name || 'Employee'}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        {nda.employee_email || nda.email} {nda.title ? `• ${nda.title}` : ''}
                      </p>

                      <button
                        type="button"
                        onClick={() => {
                          window.location.href = `/shree-nda-review/${nda.id}`;
                        }}
                        className="mt-3 px-3 py-1.5 rounded-lg text-white text-xs font-medium bg-purple-600 hover:bg-purple-700"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                </>
              )}

              {showNdaCard && (
                <>
                  <p className="text-sm font-medium text-green-600 dark:text-green-400">
                    Completed NDA Documents ({signedNdaList.length})
                  </p>

                  {signedNdaList.map((nda) => (
                    <div
                      key={nda.id || nda.email}
                      className={`relative rounded-lg border-2 p-3 ${
                        isDark ? 'border-green-800/50 bg-green-900/20' : 'border-green-200 bg-green-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          api.nda.dismissCarrieNotification(nda.id)
                            .catch(() => {})
                            .finally(() => {
                              setBackendCompletedNdas((prev) => prev.filter((item) => item.id !== nda.id));
                              refreshNotifications();
                            });
                        }}
                        className={`absolute right-3 top-3 rounded p-1 ${
                          isDark ? 'text-green-300 hover:text-red-300' : 'text-green-700 hover:text-red-600'
                        }`}
                        title="Remove notification"
                      >
                        ✕
                      </button>

                      <p className="text-sm font-semibold text-green-700 dark:text-green-300 pr-7">
                        {nda.employee_name || nda.fullName || nda.name || 'Employee'}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        {nda.employee_email || nda.email} {nda.title ? `• ${nda.title}` : ''}
                      </p>

                      <button
                        type="button"
                        onClick={() => api.nda.downloadFinalPdf(nda.id)}
                        className="mt-3 px-3 py-1.5 rounded-lg text-white text-xs font-medium bg-green-600 hover:bg-green-700"
                      >
                        Download PDF
                      </button>
                    </div>
                  ))}
                </>
              )}

              {pendingDocuments.length > 0 && (
                <>
                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                    Documents to Complete ({pendingDocuments.length})
                  </p>

                  {pendingDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className={`relative rounded-lg border-2 p-3 ${
                        isDark ? 'border-blue-800/50 bg-blue-900/20' : 'border-blue-200 bg-blue-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          deleteDocumentRequest(doc.id);
                          refreshNotifications();
                        }}
                        className={`absolute right-3 top-3 rounded p-1 ${
                          isDark ? 'text-blue-300 hover:text-red-300' : 'text-blue-700 hover:text-red-600'
                        }`}
                        title="Remove notification"
                      >
                        ✕
                      </button>

                      <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 pr-7">
                        {doc.fileName || 'Document'}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Sent by {doc.senderName || 'Carrie Lu'}
                      </p>

                      <button
                        type="button"
                        onClick={() => {
                          setActiveDocumentRequest(doc.id);
                          window.location.href = '/document-form';
                        }}
                        className="mt-3 px-3 py-1.5 rounded-lg text-white text-xs font-medium bg-blue-600 hover:bg-blue-700"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                </>
              )}

              {carrieOnly && completedDocuments.length > 0 && (
                <>
                  <p className="text-sm font-medium text-green-600 dark:text-green-400">
                    Completed Documents ({completedDocuments.length})
                  </p>

                  {completedDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className={`relative rounded-lg border-2 p-3 ${
                        isDark ? 'border-green-800/50 bg-green-900/20' : 'border-green-200 bg-green-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          deleteDocumentRequest(doc.id);
                          refreshNotifications();
                        }}
                        className={`absolute right-3 top-3 rounded p-1 ${
                          isDark ? 'text-green-300 hover:text-red-300' : 'text-green-700 hover:text-red-600'
                        }`}
                        title="Remove notification"
                      >
                        ✕
                      </button>

                      <p className="text-sm font-semibold text-green-700 dark:text-green-300 pr-7">
                        {doc.employeeName || 'Employee'}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        {doc.fileName || 'Completed document'}
                      </p>

                      <button
                        type="button"
                        onClick={() => downloadCompletedDocument(doc)}
                        className="mt-3 px-3 py-1.5 rounded-lg text-white text-xs font-medium bg-green-600 hover:bg-green-700"
                      >
                        Download PDF
                      </button>
                    </div>
                  ))}
                </>
              )}

              {adminAlerts.length > 0 && (
                <>
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
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
                          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                            {alert.employee_name || 'Employee'}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            {alert.message}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => onDismissAlert?.(alert.id)}
                          className="p-1 rounded hover:opacity-80"
                          title="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {autoLogoutNotices.length > 0 && (
                <>
                  <p className="text-sm font-medium text-orange-600 dark:text-orange-400">
                    Auto-Logout Reminder ({autoLogoutNotices.length})
                  </p>

                  {autoLogoutNotices.map((notice) => {
                    const dateStr = notice.shift_date;
                    const dateObj = new Date(dateStr + 'T00:00:00');
                    const formattedDate = dateObj.toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    });

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
                            <p className="text-xs mt-1.5 text-gray-600 dark:text-gray-300">
                              Your shift ended, but you did not log out. The system auto-logged you out.
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => onDismissAutoLogout?.(dateStr)}
                            className="p-1 rounded hover:opacity-80"
                            title="Dismiss"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {pending.filter((r) => !dismissedIds.has(r.id)).length > 0 && (
                <>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Leave requests ({pending.filter((r) => !dismissedIds.has(r.id)).length})
                  </p>

                  {pending
                    .filter((r) => !dismissedIds.has(r.id))
                    .map((req) => {
                      const employeeId = req.employeeId || req.employee_id;
                      const ctx = getLeaveContext(employeeId, contextLeaves, contextShifts);
                      const isAdmin = currentUser?.type === 'admin' || isHRorFinance;

                      return (
                        <div
                          key={req.id}
                          className={`rounded-lg border-2 p-3 ${
                            isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-medium text-gray-900 dark:text-white">
                              {formatName(req.employeeName)}
                            </p>

                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => dismissNotification(req.id)}
                                title="Dismiss"
                                className="text-gray-400 hover:text-red-500"
                              >
                                ✕
                              </button>
                            )}
                          </div>

                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                            {[
                              req.employeeRole === 'employee'
                                ? 'Employee'
                                : req.employeeRole === 'team_lead'
                                  ? 'TL'
                                  : req.employeeRole === 'manager'
                                    ? 'Manager'
                                    : req.employeeRole,
                              req.clientName,
                              req.departmentName,
                            ]
                              .filter(Boolean)
                              .join(' · ')}{' '}
                            — {formatDateRange(req.start_date, req.end_date, req.total_days)}
                          </p>

                          {req.leave_type && (
                            <p className="text-sm text-gray-500 dark:text-gray-500 mt-1 capitalize">
                              {req.leave_type}
                            </p>
                          )}

                          {req.reason && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 italic">
                              {req.reason}
                            </p>
                          )}

                          <PretextTimeline
                            leaveDaySet={ctx.leaveDaySet}
                            swapDaySet={ctx.swapDaySet}
                            totalLeaveDays4w={ctx.totalDays}
                            totalSwaps4w={ctx.recentSwaps}
                            yearLeaveDays={ctx.yearLeaveDays}
                            compOff={compOffSummary ? compOffSummary[employeeId] : null}
                            isDark={isDark}
                          />

                          {rejectingId === req.id ? (
                            <div className="mt-3 space-y-2">
                              <textarea
                                className={`w-full rounded-lg border px-3 py-2 text-sm resize-none ${
                                  isDark
                                    ? 'bg-slate-600 border-slate-500 text-white placeholder-gray-400'
                                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                                }`}
                                rows={2}
                                placeholder="Rejection reason (optional)"
                                value={rejectNotes}
                                onChange={(e) => setRejectNotes(e.target.value)}
                              />

                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onReject?.(req.id, rejectNotes.trim() || undefined);
                                    setRejectingId(null);
                                    setRejectNotes('');
                                  }}
                                  className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium"
                                >
                                  Confirm Reject
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setRejectingId(null);
                                    setRejectNotes('');
                                  }}
                                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                                    isDark
                                      ? 'bg-slate-600 hover:bg-slate-500 text-gray-200'
                                      : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                                  }`}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex gap-2 mt-3">
                              <button
                                type="button"
                                onClick={() => onApprove?.(req.id)}
                                className="px-3 py-1.5 rounded-lg text-white text-sm font-medium bg-brand hover:bg-brand-hover"
                              >
                                Approve
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setRejectingId(req.id);
                                  setRejectNotes('');
                                }}
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
                    const employeeId = req.employeeId || req.employee_id;
                    const ctx = getLeaveContext(employeeId, contextLeaves, contextShifts);

                    return (
                      <div
                        key={req.id}
                        className={`rounded-lg border-2 p-3 ${
                          isDark ? 'border-green-800/50 bg-green-900/20' : 'border-green-200 bg-green-50'
                        }`}
                      >
                        <p className="font-medium text-gray-900 dark:text-white">
                          {formatName(req.employeeName)}
                        </p>

                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                          {formatDateRange(req.start_date, req.end_date, req.total_days)}
                        </p>

                        <PretextTimeline
                          leaveDaySet={ctx.leaveDaySet}
                          swapDaySet={ctx.swapDaySet}
                          totalLeaveDays4w={ctx.totalDays}
                          totalSwaps4w={ctx.recentSwaps}
                          yearLeaveDays={ctx.yearLeaveDays}
                          compOff={compOffSummary ? compOffSummary[employeeId] : null}
                          isDark={isDark}
                        />

                        <button
                          type="button"
                          onClick={() => onAcknowledge?.(req.id)}
                          className="mt-3 px-3 py-1.5 rounded-lg text-white text-sm font-medium bg-brand hover:bg-brand-hover"
                        >
                          OK
                        </button>
                      </div>
                    );
                  })}
                </>
              )}

              {unacknowledgedShiftChanges.length > 0 && (
                <>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Approved shift changes - awaiting acknowledgement ({unacknowledgedShiftChanges.length})
                  </p>

                  {unacknowledgedShiftChanges.map((req) => {
                    const fmtTime = (t) => (t ? t.split(':').slice(0, 2).join(':') : '—');

                    return (
                      <div
                        key={req.id}
                        className={`rounded-lg border-2 p-3 ${
                          isDark ? 'border-green-800/50 bg-green-900/20' : 'border-green-200 bg-green-50'
                        }`}
                      >
                        <p className="font-medium text-gray-900 dark:text-white">
                          {req.user_name || 'Employee'}
                        </p>

                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                          {formatShiftChangeDateLabel(req)}
                        </p>

                        <p className="text-sm text-gray-500 dark:text-gray-500 mt-0.5">
                          {fmtTime(req.original_start_time)}-{fmtTime(req.original_end_time)} →{' '}
                          <span className="font-medium text-blue-600 dark:text-blue-400">
                            {fmtTime(req.requested_start_time)}-{fmtTime(req.requested_end_time)}
                          </span>
                        </p>

                        <button
                          type="button"
                          onClick={() => onAcknowledgeShiftChange?.(req.id)}
                          className="mt-3 px-3 py-1.5 rounded-lg text-white text-sm font-medium bg-brand hover:bg-brand-hover"
                        >
                          OK
                        </button>
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
                    const fmtTime = (t) => (t ? t.split(':').slice(0, 2).join(':') : '—');
                    const kind = req.request_kind || 'future_change';
                    const isAcknowledgement = kind === 'past_acknowledgement';

                    return (
                      <div
                        key={req.id}
                        className={`rounded-lg border-2 p-3 ${
                          isAcknowledgement
                            ? isDark
                              ? 'border-purple-800/50 bg-purple-900/20'
                              : 'border-purple-200 bg-purple-50'
                            : isDark
                              ? 'border-blue-800/50 bg-blue-900/20'
                              : 'border-blue-200 bg-blue-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-gray-900 dark:text-white">
                            {req.user_name || 'Employee'}
                          </p>

                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${shiftKindBadgeClass(kind)}`}
                          >
                            {formatShiftKind(kind)}
                          </span>

                          {isAcknowledgement && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                              Informational
                            </span>
                          )}
                        </div>

                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                          {formatShiftChangeDateLabel(req)}
                        </p>

                        <p className="text-sm text-gray-500 dark:text-gray-500 mt-0.5">
                          {fmtTime(req.original_start_time)}-{fmtTime(req.original_end_time)} →{' '}
                          <span className="font-medium text-blue-600 dark:text-blue-400">
                            {fmtTime(req.requested_start_time)}-{fmtTime(req.requested_end_time)}
                          </span>
                        </p>

                        {req.reason && (
                          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                            Reason: {req.reason}
                          </p>
                        )}

                        {isAcknowledgement ? (
                          <div className="flex gap-2 mt-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                              No approval required
                            </span>

                            <button
                              type="button"
                              onClick={async () => {
                                setDismissedShiftNoticeIds((prev) => [...prev, req.id]);
                                try {
                                  await onAcknowledgeShiftNotice?.(req.id);
                                } catch {
                                  setDismissedShiftNoticeIds((prev) => prev.filter((x) => x !== req.id));
                                }
                              }}
                              className="px-3 py-1.5 rounded-lg text-white text-sm font-medium bg-brand hover:bg-brand-hover"
                            >
                              OK
                            </button>
                          </div>
                        ) : (
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
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {recentRejectedLeaves.length > 0 && (
                <>
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                    Rejected leave requests ({recentRejectedLeaves.length})
                  </p>

                  {recentRejectedLeaves.map((req) => (
                    <div
                      key={req.id}
                      className={`rounded-lg border-2 p-3 ${
                        isDark ? 'border-red-800/50 bg-red-900/20' : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <p className="font-medium text-gray-900 dark:text-white">
                        Leave request rejected
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                        {formatDateRange(req.start_date, req.end_date, req.total_days)}
                      </p>
                      {req.rejectionReason && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                          Reason: {req.rejectionReason}
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