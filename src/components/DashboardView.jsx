import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api, hasApi } from '../api/client';
import { buildShiftRowsFromApi } from '../api/normalize';
import { resolveTimezone } from '../utils/timezone';

// ── Helpers ─────────────────────────────────────────────────────

function formatTodayDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function roleLabel(role) {
  const map = { admin: 'CEO / Admin', manager: 'Manager', team_lead: 'Team Lead', employee: 'Employee' };
  return map[role] || role;
}

function roleBadgeClasses(role, isDark) {
  const map = {
    admin: isDark ? 'bg-purple-900/40 text-purple-300 border-purple-700/50' : 'bg-purple-50 text-purple-700 border-purple-200',
    manager: isDark ? 'bg-blue-900/40 text-blue-300 border-blue-700/50' : 'bg-blue-50 text-blue-700 border-blue-200',
    team_lead: isDark ? 'bg-amber-900/40 text-amber-300 border-amber-700/50' : 'bg-amber-50 text-amber-700 border-amber-200',
    employee: isDark ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50' : 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return map[role] || map.employee;
}

function formatLeaveDate(startDate, endDate) {
  if (!startDate) return '--';
  const fmt = (d) => {
    const iso = String(d).slice(0, 10);
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  return startDate === endDate ? fmt(startDate) : `${fmt(startDate)} - ${fmt(endDate)}`;
}

function formatBirthdayDate(dateStr) {
  if (!dateStr) return '';
  const iso = String(dateStr).slice(0, 10);
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function todayISO() {
  // Before 5 AM IST, overnight shifts from yesterday are still active — treat yesterday as "today"
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  if (nowIST.getHours() < 5) {
    const y = new Date(nowIST); y.setDate(y.getDate() - 1);
    return `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
  }
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

const DOT_COLORS = ['bg-brand', 'bg-blue-500', 'bg-amber-500', 'bg-purple-500', 'bg-pink-500'];

// ── Donut Chart (conic-gradient) ────────────────────────────────

function DonutChart({ segments, size = 160, strokeWidth = 24, isDark }) {
  // segments: [{ value, color, label }]
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const total = segments.reduce((s, seg) => s + seg.value, 0);

  if (total === 0) {
    return (
      <div
        className="relative rounded-full flex items-center justify-center"
        style={{
          width: size,
          height: size,
          background: isDark ? '#334155' : '#e5e7eb',
        }}
      >
        <div
          className="rounded-full flex items-center justify-center"
          style={{
            width: size - strokeWidth * 2,
            height: size - strokeWidth * 2,
            background: isDark ? '#1e293b' : '#ffffff',
          }}
        >
          <span className={`text-sm font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>No data</span>
        </div>
      </div>
    );
  }

  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // Build segment arc paths
  let cumAngle = -Math.PI / 2; // start at 12 o'clock
  const arcs = segments
    .map((seg, i) => {
      if (seg.value <= 0) return null;
      const frac = seg.value / total;
      const angle = frac * Math.PI * 2;
      const start = cumAngle;
      const end = cumAngle + angle;
      cumAngle = end;

      const x1 = cx + radius * Math.cos(start);
      const y1 = cy + radius * Math.sin(start);
      const x2 = cx + radius * Math.cos(end);
      const y2 = cy + radius * Math.sin(end);
      const largeArc = angle > Math.PI ? 1 : 0;

      // Full circle hack: if only one segment = 100%, use two half-arcs
      let d;
      if (segments.filter((s) => s.value > 0).length === 1) {
        const mx = cx + radius * Math.cos(start + Math.PI);
        const my = cy + radius * Math.sin(start + Math.PI);
        d = `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${mx} ${my} A ${radius} ${radius} 0 1 1 ${x1} ${y1}`;
      } else {
        d = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
      }

      return {
        idx: i,
        d,
        color: seg.color,
        label: seg.label,
        value: seg.value,
        pct: Math.round(frac * 1000) / 10,
      };
    })
    .filter(Boolean);

  const hovered = hoveredIdx != null ? arcs.find((a) => a.idx === hoveredIdx) : null;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="overflow-visible"
      >
        {/* Background ring */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={isDark ? '#334155' : '#e5e7eb'}
          strokeWidth={strokeWidth}
        />
        {/* Segments */}
        {arcs.map((arc) => (
          <path
            key={arc.idx}
            d={arc.d}
            fill="none"
            stroke={arc.color}
            strokeWidth={hoveredIdx === arc.idx ? strokeWidth + 4 : strokeWidth}
            strokeLinecap="butt"
            style={{ cursor: 'pointer', transition: 'stroke-width 0.15s ease' }}
            onMouseEnter={() => setHoveredIdx(arc.idx)}
            onMouseLeave={() => setHoveredIdx(null)}
          />
        ))}
      </svg>

      {/* Center label */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <div className="text-center">
          {hovered ? (
            <>
              <span className="text-2xl font-bold" style={{ color: hovered.color }}>{hovered.value}</span>
              <p className={`text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'} leading-tight`}>{hovered.label}</p>
              <p className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{hovered.pct}%</p>
            </>
          ) : (
            <>
              <span className="text-2xl font-bold">{total}</span>
              <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Total</p>
            </>
          )}
        </div>
      </div>

      {/* Floating tooltip */}
      {hovered && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 -top-2 -translate-y-full px-2.5 py-1.5 rounded-lg shadow-lg text-xs whitespace-nowrap pointer-events-none z-10 ${
            isDark ? 'bg-slate-900 border border-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-900'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hovered.color }} />
            <span className="font-semibold">{hovered.label}</span>
          </div>
          <div className={`text-[11px] mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {hovered.value} · {hovered.pct}%
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────

// ── Pretext helpers (shared with LeavesView/NotificationsPanel) ──
function buildLeaveDaySet(employeeId, leaveRequests) {
  const set = new Set();
  (leaveRequests || []).forEach(r => {
    if (r.employeeId !== employeeId || r.status !== 'approved') return;
    const sd = String(r.start_date || '').slice(0, 10);
    const ed = String(r.end_date || r.start_date || '').slice(0, 10);
    if (!sd) return;
    let current = new Date(sd + 'T00:00:00');
    const end = new Date(ed + 'T00:00:00');
    while (current <= end) { set.add(current.toISOString().slice(0, 10)); current.setDate(current.getDate() + 1); }
  });
  return set;
}
function buildSwapDaySet(employeeId, shiftChangeRequests) {
  const set = new Set();
  (shiftChangeRequests || []).forEach(r => {
    if (r.user_id !== employeeId || r.status !== 'approved') return;
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
    if (sd && sd.startsWith(String(year))) total += Number(r.total_days) || 1;
  });
  return total;
}
function getRecentSwapCount(employeeId, shiftChangeRequests) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 28);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return (shiftChangeRequests || []).filter(r => {
    if (r.user_id !== employeeId) return false;
    const cd = String(r.created_at || '').slice(0, 10);
    return cd >= cutoffStr;
  }).length;
}

function DashboardPretext({ employeeId, allLeaveRequests, allShiftChangeRequests, compOffSummary, isDark }) {
  const ANNUAL = 16;
  const leaveDaySet = buildLeaveDaySet(employeeId, allLeaveRequests);
  const swapDaySet = buildSwapDaySet(employeeId, allShiftChangeRequests);
  const yearDays = getYearLeaveDays(employeeId, allLeaveRequests);
  const remaining = ANNUAL - Math.round(yearDays);
  const swaps4w = getRecentSwapCount(employeeId, allShiftChangeRequests);
  const compOff = compOffSummary ? compOffSummary[employeeId] : null;

  // Taken in last 4 weeks
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 28);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  let taken4w = 0;
  (allLeaveRequests || []).forEach(r => {
    if (r.employeeId !== employeeId || r.status !== 'approved') return;
    const sd = String(r.start_date || '').slice(0, 10);
    if (sd >= cutoffStr) taken4w += Number(r.total_days) || 1;
  });
  taken4w = Math.round(taken4w);

  const weeks = [];
  for (let w = 3; w >= 0; w--) {
    const weekDays = [];
    const ws = new Date(); ws.setDate(ws.getDate() - (w * 7 + 6));
    for (let d = 0; d < 7; d++) {
      const day = new Date(ws); day.setDate(ws.getDate() + d);
      const ds = day.toISOString().slice(0, 10);
      weekDays.push({ ds, isWe: day.getDay() === 0 || day.getDay() === 6, isL: leaveDaySet.has(ds), isS: swapDaySet.has(ds) });
    }
    weeks.push({ label: ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), days: weekDays });
  }

  const sub = isDark ? 'text-gray-400' : 'text-gray-500';
  const bdr = isDark ? 'border-slate-600' : 'border-gray-200';
  return (
    <div className={`mt-1.5 rounded-lg border ${bdr} ${isDark ? 'bg-slate-700/50' : 'bg-gray-50'} p-2`}>
      <div className="flex items-center gap-2 mb-1.5 text-[10px]">
        <span className={sub}><b className={`text-sm ${remaining <= 3 ? 'text-red-500' : ''}`}>{remaining >= 0 ? remaining : 0}</b> left</span>
        <span className={`border-l ${bdr} pl-2 ${sub}`}><b className="text-sm">{taken4w}</b> taken</span>
        <span className={`border-l ${bdr} pl-2 ${sub}`}><b className="text-sm">{swaps4w}</b> swaps</span>
        {compOff && Number(compOff.available) > 0 && (
          <span className={`border-l ${bdr} pl-2 text-green-600 dark:text-green-400`}><b className="text-sm">{compOff.available}</b> comp</span>
        )}
      </div>
      <div className="flex gap-0">
        {weeks.map((wk, wi) => (
          <div key={wi} className={`flex-1 px-1 ${wi < weeks.length - 1 ? `border-r ${bdr}` : ''}`}>
            <p className={`text-[8px] ${sub} mb-0.5 truncate`}>{wk.label}</p>
            <div className="flex gap-px">
              {wk.days.map((d, di) => {
                let bg, tx, lb;
                if (d.isL) { bg = 'bg-red-400 dark:bg-red-500'; tx = 'text-white'; lb = 'L'; }
                else if (d.isS) { bg = 'bg-blue-400 dark:bg-blue-500'; tx = 'text-white'; lb = 'S'; }
                else if (d.isWe) { bg = isDark ? 'bg-slate-600' : 'bg-gray-200'; tx = isDark ? 'text-slate-500' : 'text-gray-400'; lb = '-'; }
                else { bg = isDark ? 'bg-green-900/40' : 'bg-green-200'; tx = isDark ? 'text-green-400' : 'text-green-600'; lb = '\u00b7'; }
                return <span key={di} title={d.ds} className={`w-2.5 h-2.5 rounded-sm ${bg} ${tx} text-[6px] font-bold flex items-center justify-center`}>{lb}</span>;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardView({
  isDark, currentUser, onNavigate, leaveRequests, allLeaveRequests, onApprove, onReject,
  myClockStatus, pendingLeaveCount, allUsers, shiftChangeRequests, allShiftChangeRequests, compOffSummary,
}) {
  const [upcomingBirthdays, setUpcomingBirthdays] = useState([]);
  const [todayBirthdays, setTodayBirthdays] = useState([]);
  const [actionLoading, setActionLoading] = useState(null);
  const [expandedApproval, setExpandedApproval] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [todayShifts, setTodayShifts] = useState([]);
  const [dinnerSummary, setDinnerSummary] = useState(null);

  const userType = currentUser?.type;
  const firstName = currentUser?.name?.split(' ')[0] || 'there';
  const canApprove = userType === 'team_lead' || userType === 'manager' || userType === 'admin';

  // ── Team-scoped users: TL sees own department, employee via myTeam, admin/manager sees all ──
  const teamUsers = useMemo(() => {
    if (!allUsers || allUsers.length === 0) return [];
    if (userType === 'admin' || userType === 'manager') return allUsers;
    if (userType === 'team_lead') {
      const deptId = currentUser?.department_id;
      if (deptId) return allUsers.filter(u => u.department_id === deptId || u.id === currentUser.id);
      // Fallback: show users assigned to this team lead
      return allUsers.filter(u => u.team_lead_id === currentUser.id || u.id === currentUser.id);
    }
    return allUsers; // employee — already filtered by myTeam API
  }, [allUsers, userType, currentUser?.department_id, currentUser?.id]);

  const teamUserIdSet = useMemo(() => new Set(teamUsers.map(u => u.id)), [teamUsers]);

  // ── Stats source filtered by team scope ──
  const statsSource = useMemo(() => {
    const src = allLeaveRequests && allLeaveRequests.length > 0 ? allLeaveRequests : leaveRequests;
    if (!src || !Array.isArray(src)) return [];
    if (userType === 'admin' || userType === 'manager') return src;
    // For team_lead and employee, filter leave requests to team members only
    return src.filter(r => {
      const eid = r.employeeId || r.employee_id;
      return teamUserIdSet.has(eid);
    });
  }, [allLeaveRequests, leaveRequests, userType, teamUserIdSet]);

  // ── Styling ───────────────────────────────────────────────────
  const card = isDark ? 'bg-slate-800/80 border-slate-700 text-white' : 'bg-white border-gray-200 text-gray-900';
  const cardHover = isDark ? 'hover:border-slate-600' : 'hover:border-gray-300';
  const subtleText = isDark ? 'text-gray-400' : 'text-gray-500';
  const sectionHeader = `text-xs font-semibold uppercase tracking-wider ${subtleText}`;
  const dividerColor = isDark ? 'divide-slate-700' : 'divide-gray-100';
  const borderColor = isDark ? 'border-slate-700' : 'border-gray-100';

  // ── Fetch data ────────────────────────────────────────────────
  useEffect(() => {
    if (!hasApi()) return;
    // Fetch today's and upcoming birthdays
    api.celebrations?.today?.()
      ?.then((data) => setTodayBirthdays(data?.birthdays || []))
      ?.catch(() => setTodayBirthdays([]));
    api.celebrations?.upcoming?.()
      ?.then((data) => setUpcomingBirthdays((data?.celebrations || data?.birthdays || []).slice(0, 5)))
      ?.catch(() => setUpcomingBirthdays([]));

    // Fetch departments
    api.departments?.()
      ?.then((data) => setDepartments(data?.departments || []))
      ?.catch(() => {});

    // Fetch today's shifts for attendance overview
    const today = todayISO();
    api.shifts?.({ from: today, to: today })
      ?.then((data) => setTodayShifts(data?.shifts || []))
      ?.catch(() => {});

    // Fetch dinner summary for admin/manager
    api.dinners?.summary?.()
      ?.then((data) => setDinnerSummary(data))
      ?.catch(() => {});

  }, [currentUser]);

  // Use team-scoped users, exclude admins and inactive (matches UserManagement "Total Employees")
  const teamSize = useMemo(() => {
    if (teamUsers && teamUsers.length > 0) {
      return teamUsers.filter((u) => u.role !== 'admin' && u.is_active !== false).length;
    }
    return '--';
  }, [teamUsers]);

  // ── Derived data ──────────────────────────────────────────────
  const today = todayISO();
  // For leave calculations, always use actual calendar date (not overnight-shifted)
  const actualToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const isClockedIn = myClockStatus?.clocked_in === true;

  const [expandedCard, setExpandedCard] = useState(null);

  // ── Today's Attendance from shifts ────────────────────────────
  const shouldFilterShifts = userType === 'employee' || userType === 'team_lead';

  // Set of admin user IDs to exclude from attendance rollups (CEO, etc. should never show as "absent")
  const adminIdSet = useMemo(() => {
    const s = new Set();
    (allUsers || []).forEach((u) => { if (u.role === 'admin') s.add(u.id); });
    return s;
  }, [allUsers]);

  const todayRows = useMemo(() => {
    let rows = buildShiftRowsFromApi(todayShifts, { today, adminIds: adminIdSet });
    // Always exclude admins from attendance rollups — they're not counted in team totals either
    if (adminIdSet.size > 0) rows = rows.filter((r) => !adminIdSet.has(r.employeeId));
    // For employees and team leads, only show their team members
    if (shouldFilterShifts && teamUserIdSet.size > 0) return rows.filter(r => teamUserIdSet.has(r.employeeId));
    return rows;
  }, [todayShifts, today, shouldFilterShifts, teamUserIdSet, adminIdSet]);

  const attendanceCounts = useMemo(() => {
    let loggedIn = 0;
    let completed = 0;
    let notLoggedIn = 0;
    let absent = 0;
    let off = 0;
    todayRows.forEach((r) => {
      if (r.status === 'current_logged_in') loggedIn++;
      else if (r.status === 'completed') completed++;
      else if (r.status === 'current_not_logged_in' || r.status === 'not_started') notLoggedIn++;
      else if (r.status === 'absent') absent++;
      else off++;
    });
    const totalTeam = typeof teamSize === 'number' ? teamSize : todayRows.length;
    const unaccounted = Math.max(0, totalTeam - todayRows.length);
    off += unaccounted;
    return { loggedIn, completed, notLoggedIn, absent, off, total: totalTeam };
  }, [todayRows, teamSize]);

  // ── Employee lists per category (for card drill-down) ──────────
  const onDutyList = useMemo(() =>
    todayRows.filter((r) => r.status === 'current_logged_in')
      .map((r) => ({ name: r.employeeName, detail: r.loginTime !== '—' ? `In: ${r.loginTime}` : '', extra: r.shiftTime })),
    [todayRows]);

  const completedList = useMemo(() =>
    todayRows.filter((r) => r.status === 'completed')
      .map((r) => ({ name: r.employeeName, detail: r.loginTime !== '—' ? `In: ${r.loginTime}` : '', extra: r.shiftTime })),
    [todayRows]);

  const absentList = useMemo(() =>
    todayRows.filter((r) => r.status === 'absent')
      .map((r) => ({ name: r.employeeName, detail: r.shiftTime, extra: 'No clock-in' })),
    [todayRows]);

  // ── On leave today (deduplicated by employee, excludes those who clocked in) ──
  const onLeaveTodayList = useMemo(() => {
    if (!statsSource || !Array.isArray(statsSource)) return [];
    // Build set of employee IDs who actually clocked in today — they override leave status
    const clockedInIds = new Set();
    todayRows.forEach((r) => {
      if (r.status === 'current_logged_in' || r.status === 'completed') {
        clockedInIds.add(r.employeeId);
      }
    });
    // Use actualToday (real calendar date) for leave matching, not overnight-shifted today
    const onLeaveRequests = statsSource.filter((r) => {
      const st = (r.status || '').toLowerCase();
      if (st !== 'approved') return false;
      const start = String(r.start_date || '').slice(0, 10);
      const end = String(r.end_date || r.start_date || '').slice(0, 10);
      if (!(start <= actualToday && end >= actualToday)) return false;
      const eid = r.employeeId || r.employee_id;
      // For employees and team leads, only show their team members
      if (shouldFilterShifts && teamUserIdSet.size > 0 && !teamUserIdSet.has(eid)) return false;
      // If employee actually clocked in today, they're present — not on leave
      if (clockedInIds.has(eid)) return false;
      return true;
    });
    // Deduplicate by employeeId — same person with multiple overlapping leaves counts once
    const seen = new Set();
    return onLeaveRequests.filter((r) => {
      const eid = r.employeeId || r.employee_id;
      if (seen.has(eid)) return false;
      seen.add(eid);
      return true;
    }).map((r) => ({
      name: r.employeeName,
      detail: { casual: 'CL', sick: 'SL', comp: 'Comp', loss_of_pay: 'LOP' }[r.leave_type] || r.leave_type || r.reason || '',
      extra: `${String(r.start_date || '').slice(5)} → ${String(r.end_date || '').slice(5)}`
    }));
  }, [statsSource, actualToday, todayRows]);

  const onLeaveToday = onLeaveTodayList.length;

  const totalEmployeesList = useMemo(() => {
    if (!teamUsers || teamUsers.length === 0) return [];
    return teamUsers.filter((u) => u.role !== 'admin').map((u) => ({
      name: u.name, detail: u.role === 'team_lead' ? 'TL' : u.role === 'manager' ? 'Manager' : 'Employee', extra: u.designation || ''
    }));
  }, [teamUsers]);

  const myLeaveCount = useMemo(() => {
    if (!leaveRequests || !Array.isArray(leaveRequests)) return 0;
    return leaveRequests.filter((r) => r.employeeId === currentUser?.id || r.user_id === currentUser?.id).length;
  }, [leaveRequests, currentUser?.id]);


  // ── Department summary ────────────────────────────────────────
  const departmentCounts = useMemo(() => {
    if (!teamUsers || teamUsers.length === 0 || departments.length === 0) return [];
    const counts = {};
    departments.forEach((d) => { counts[d.id] = { name: d.name, count: 0 }; });
    let unassigned = 0;
    teamUsers.forEach((u) => {
      if (u.role === 'admin') return;
      if (u.department_id && counts[u.department_id]) {
        counts[u.department_id].count++;
      } else {
        unassigned++;
      }
    });
    const result = Object.values(counts).filter((d) => d.count > 0).sort((a, b) => b.count - a.count);
    if (unassigned > 0) result.push({ name: 'Unassigned', count: unassigned });
    return result;
  }, [teamUsers, departments]);

  const maxDeptCount = useMemo(() => Math.max(...departmentCounts.map((d) => d.count), 1), [departmentCounts]);

  // ── Leave request summary (use allLeaveRequests for full stats) ──
  const leaveStats = useMemo(() => {
    if (!statsSource || !Array.isArray(statsSource)) return { pending: 0, approvedMonth: 0, rejectedMonth: 0 };
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const nextMonth = now.getMonth() === 11
      ? `${now.getFullYear() + 1}-01-01`
      : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}-01`;

    let pending = 0;
    let approvedMonth = 0;
    let rejectedMonth = 0;
    statsSource.forEach((r) => {
      const st = (r.status || '').toLowerCase();
      if (st.startsWith('pending')) pending++;
      const reqDate = String(r.requested_at || r.requestedAt || r.start_date || '').slice(0, 10);
      if (reqDate >= monthStart && reqDate < nextMonth) {
        if (st === 'approved') approvedMonth++;
        if (st === 'rejected') rejectedMonth++;
      }
    });
    return { pending, approvedMonth, rejectedMonth };
  }, [statsSource]);

  const pendingApprovalList = useMemo(() => {
    if (!canApprove || !leaveRequests || !Array.isArray(leaveRequests)) return [];
    return leaveRequests
      .filter((r) => {
        if (r.employeeId === currentUser?.id) return false;
        if ((r.approvalChain || []).some((a) => a.userId === currentUser?.id)) return false;
        if (userType === 'team_lead') return r.status === 'pending_team_lead';
        if (userType === 'manager') return r.status === 'pending_managers';
        if (userType === 'admin') return r.status === 'pending_ceo';
        return false;
      })
      .slice(0, 5);
  }, [canApprove, leaveRequests, currentUser?.id, userType]);

  const recentActivity = useMemo(() => {
    if (!canApprove || !leaveRequests || !Array.isArray(leaveRequests)) return [];
    return leaveRequests
      .filter((r) => r.status === 'approved' || r.status === 'rejected')
      .sort((a, b) => (b.rejectedAt || b.requestedAt || '').localeCompare(a.rejectedAt || a.requestedAt || ''))
      .slice(0, 5);
  }, [canApprove, leaveRequests]);

  // Upcoming approved leaves (today and future)
  const upcomingApprovedLeaves = useMemo(() => {
    if (!canApprove || !statsSource || !Array.isArray(statsSource)) return [];
    return statsSource
      .filter((r) => {
        if (r.status !== 'approved') return false;
        if (r.employeeId === currentUser?.id) return false;
        const end = String(r.end_date || r.start_date || '').slice(0, 10);
        return end >= actualToday;
      })
      .sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')))
      .slice(0, 8);
  }, [canApprove, statsSource, currentUser?.id, actualToday]);

  // ── Leave actions ─────────────────────────────────────────────
  const handleApprove = useCallback(async (id) => {
    setActionLoading(id);
    try { await onApprove?.(id); } finally { setActionLoading(null); }
  }, [onApprove]);

  const handleReject = useCallback(async (id) => {
    setActionLoading(id);
    try { await onReject?.(id); } finally { setActionLoading(null); }
  }, [onReject]);

  // ── Quick actions ─────────────────────────────────────────────
  const quickActions = useMemo(() => {
    const actions = [];
    if (!isClockedIn) {
      actions.push({ label: 'Clock In', tab: 'my-work', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      )});
    }
    actions.push({ label: 'Request Leave', tab: 'my-work', icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
    )});
    // Schedules tab is admin/manager/team_lead only — employees shouldn't see "View Schedule"
    if (canApprove) {
      actions.push({ label: 'View Schedule', tab: 'schedules', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
      )});
    }
    if (canApprove && (pendingLeaveCount || 0) > 0) {
      actions.push({ label: 'Review Approvals', tab: 'approvals', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      )});
    }
    return actions;
  }, [isClockedIn, canApprove, pendingLeaveCount]);

  // ── Donut chart colors ────────────────────────────────────────
  const donutSegments = [
    { value: attendanceCounts.loggedIn, color: '#22c55e', label: 'Logged In' },
    { value: attendanceCounts.completed, color: '#3b82f6', label: 'Completed' },
    { value: attendanceCounts.notLoggedIn, color: '#f59e0b', label: 'Not Logged In' },
    { value: attendanceCounts.absent, color: '#ef4444', label: 'Absent' },
    { value: attendanceCounts.off, color: isDark ? '#475569' : '#9ca3af', label: 'Off / Not Scheduled' },
  ];

  // ── Department donut segments ─────────────────────────────────
  const DEPT_PALETTE = ['#86bb46', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#eab308', '#8b5cf6'];
  const departmentSegments = departmentCounts.map((dept, i) => ({
    value: dept.count,
    color: DEPT_PALETTE[i % DEPT_PALETTE.length],
    label: dept.name,
  }));

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
          <p className={`text-sm mt-0.5 ${subtleText}`}>{formatTodayDate()}</p>
        </div>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border self-start ${roleBadgeClasses(userType, isDark)}`}>
          {roleLabel(userType)}
        </span>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        {quickActions.map((action) => (
          <button key={action.tab + action.label} type="button" onClick={() => onNavigate?.(action.tab)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 sm:px-3 sm:py-1.5 rounded-lg text-sm sm:text-xs font-medium border transition-colors min-h-[44px] sm:min-h-0 ${
              isDark ? 'border-slate-600 text-gray-300 hover:bg-slate-700 hover:text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}>
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>

      {/* ── Row 1: Quick Stats ──────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {[
          { key: 'total', label: 'Total Employees', value: teamSize, sub: 'Active team members', color: '', list: totalEmployeesList },
          { key: 'duty', label: 'On Duty', value: attendanceCounts.loggedIn, sub: 'Currently clocked in', color: 'text-green-500', list: onDutyList },
          { key: 'completed', label: 'Completed', value: attendanceCounts.completed, sub: 'Shift done today', color: 'text-blue-500', list: completedList },
          { key: 'leave', label: 'On Leave', value: onLeaveToday, sub: onLeaveToday === 1 ? '1 person out' : `${onLeaveToday} people out`, color: 'text-amber-500', list: onLeaveTodayList },
          { key: 'absent', label: 'Absent', value: attendanceCounts.absent, sub: 'Missed clock-in', color: 'text-red-500', list: absentList },
        ].map((stat) => (
          <div key={stat.key} className="relative">
            <button
              type="button"
              onClick={() => setExpandedCard(expandedCard === stat.key ? null : stat.key)}
              className={`w-full text-left rounded-xl border p-3 sm:p-3.5 ${card} ${cardHover} transition-colors ${expandedCard === stat.key ? (isDark ? 'ring-2 ring-brand/50' : 'ring-2 ring-brand/30') : ''}`}
            >
              <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText} truncate`}>{stat.label}</p>
              <div className="flex items-end justify-between gap-1">
                <p className={`mt-1 text-2xl font-bold ${stat.color} leading-none`}>{stat.value}</p>
                <svg className={`w-4 h-4 ${subtleText} transition-transform flex-shrink-0 ${expandedCard === stat.key ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              <p className={`text-[10px] mt-1 ${subtleText} truncate`}>{stat.sub}</p>
            </button>
            {expandedCard === stat.key && (
              <div className={`absolute z-20 left-0 right-0 mt-1 rounded-xl border shadow-lg max-h-64 overflow-y-auto ${isDark ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200'}`}>
                {stat.list.length === 0 ? (
                  <p className={`px-4 py-3 text-xs ${subtleText}`}>No data available</p>
                ) : (
                  <ul className={`divide-y ${isDark ? 'divide-slate-700' : 'divide-gray-100'}`}>
                    {stat.list.map((item, i) => (
                      <li key={i} className={`px-4 py-2 flex items-center justify-between gap-2 ${isDark ? 'hover:bg-slate-700/50' : 'hover:bg-gray-50'}`}>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{item.name}</p>
                          {item.detail && <p className={`text-[11px] ${subtleText} truncate`}>{item.detail}</p>}
                        </div>
                        {item.extra && <span className={`text-[11px] flex-shrink-0 ${subtleText}`}>{item.extra}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Row 2: Attendance Donut + Department Donut + Clock Status ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Attendance Donut */}
        <div className={`rounded-xl border p-5 ${card}`}>
          <h2 className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText} mb-4`}>Today's Attendance</h2>
          <div className="flex flex-col items-center gap-4">
            <DonutChart segments={donutSegments} size={140} strokeWidth={20} isDark={isDark} />
            <div className="w-full grid grid-cols-2 gap-x-4 gap-y-1.5">
              {donutSegments.map((seg) => (
                <div key={seg.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
                    <span className={`text-[11px] ${subtleText} truncate`}>{seg.label}</span>
                  </div>
                  <span className="text-xs font-semibold flex-shrink-0">{seg.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Department Donut */}
        <div className={`rounded-xl border p-5 ${card}`}>
          <h2 className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText} mb-4`}>Departments</h2>
          {departmentSegments.length === 0 ? (
            <div className="py-6 text-center"><p className={`text-xs ${subtleText}`}>No data</p></div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <DonutChart segments={departmentSegments} size={140} strokeWidth={20} isDark={isDark} />
              <div className="w-full grid grid-cols-2 gap-x-4 gap-y-1.5">
                {departmentSegments.map((seg) => (
                  <div key={seg.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
                      <span className={`text-[11px] ${subtleText} truncate`}>{seg.label}</span>
                    </div>
                    <span className="text-xs font-semibold flex-shrink-0">{seg.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Clock Status + Leave Stats stacked */}
        <div className="space-y-5">
          <div className={`rounded-xl border p-4 ${card}`}>
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Clock Status</p>
            <div className="mt-3 flex items-center gap-3">
              <div className={`relative w-10 h-10 rounded-full flex items-center justify-center ${
                isClockedIn ? isDark ? 'bg-green-900/30' : 'bg-green-50' : isDark ? 'bg-slate-700' : 'bg-gray-100'
              }`}>
                {isClockedIn && <span className="absolute inset-0 rounded-full animate-ping bg-green-500/20" />}
                <span className={`w-2.5 h-2.5 rounded-full ${isClockedIn ? 'bg-green-500' : isDark ? 'bg-gray-600' : 'bg-gray-300'}`} />
              </div>
              <div>
                <p className="text-sm font-semibold">{isClockedIn ? 'Clocked In' : 'Not Clocked In'}</p>
                <p className={`text-[11px] ${subtleText}`}>
                  {isClockedIn && myClockStatus?.clocked_in_at
                    ? (() => {
                        const userTz = resolveTimezone(currentUser?.work_timezone);
                        const tzLabel = userTz === 'Asia/Kolkata' ? 'IST'
                          : userTz === 'America/Chicago' ? 'CT'
                          : userTz === 'America/New_York' ? 'ET'
                          : userTz === 'America/Los_Angeles' ? 'PT'
                          : userTz.split('/').pop().replace(/_/g,' ');
                        const t = new Date(myClockStatus.clocked_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: userTz });
                        return `Since ${t} ${tzLabel}`;
                      })()
                    : isClockedIn ? 'Active session' : 'Go to My Work to clock in'}
                </p>
              </div>
            </div>
          </div>

          <div className={`rounded-xl border p-4 ${card}`}>
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText} mb-3`}>Leave Requests</p>
            <div className="grid grid-cols-3 gap-2">
              <div
                className={`rounded-lg py-3 text-center cursor-pointer transition-colors ${isDark ? 'bg-amber-900/20 hover:bg-amber-900/30' : 'bg-amber-50 hover:bg-amber-100'}`}
                onClick={() => onNavigate?.('approvals')}
                role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onNavigate?.('approvals')}
              >
                <p className="text-xl font-bold text-amber-500">{leaveStats.pending}</p>
                <p className={`text-[9px] font-medium mt-0.5 uppercase tracking-wide ${isDark ? 'text-amber-400/70' : 'text-amber-600/70'}`}>Pending</p>
              </div>
              <div className={`rounded-lg py-3 text-center ${isDark ? 'bg-green-900/20' : 'bg-green-50'}`}>
                <p className="text-xl font-bold text-green-500">{leaveStats.approvedMonth}</p>
                <p className={`text-[9px] font-medium mt-0.5 uppercase tracking-wide ${isDark ? 'text-green-400/70' : 'text-green-600/70'}`}>Approved</p>
              </div>
              <div className={`rounded-lg py-3 text-center ${isDark ? 'bg-red-900/20' : 'bg-red-50'}`}>
                <p className="text-xl font-bold text-red-500">{leaveStats.rejectedMonth}</p>
                <p className={`text-[9px] font-medium mt-0.5 uppercase tracking-wide ${isDark ? 'text-red-400/70' : 'text-red-600/70'}`}>Rejected</p>
              </div>
            </div>
            <div className={`mt-3 pt-2.5 border-t ${borderColor} space-y-1`}>
              <div className="flex items-center justify-between">
                <span className={`text-[11px] ${subtleText}`}>On leave today</span>
                <span className="text-xs font-semibold text-blue-500">{onLeaveToday}</span>
              </div>
              {canApprove && (
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] ${subtleText}`}>Awaiting review</span>
                  <span className="text-xs font-semibold text-amber-500">{pendingLeaveCount ?? 0}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 3: Pending Approvals + Upcoming Leaves ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pending Approvals */}
        <div className={`rounded-xl border overflow-hidden ${card}`}>
          <div className={`flex items-center justify-between px-4 py-3 border-b ${borderColor}`}>
            <h2 className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Pending Approvals</h2>
            <button type="button" onClick={() => onNavigate?.('approvals')}
              className="text-[11px] font-medium text-brand hover:text-brand-hover transition-colors">View all</button>
          </div>
          {!canApprove || pendingApprovalList.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <svg className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className={`text-xs ${subtleText}`}>No pending leave requests</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-full text-xs">
                <thead>
                  <tr className={isDark ? 'bg-slate-700/50' : 'bg-gray-50'}>
                    <th className={`text-left px-4 py-2.5 font-medium ${subtleText}`}>Employee</th>
                    <th className={`text-left px-4 py-2.5 font-medium ${subtleText}`}>Dates</th>
                    <th className={`text-left px-2 py-2.5 font-medium ${subtleText}`}>Type</th>
                    <th className={`text-left px-2 py-2.5 font-medium ${subtleText}`}>Days</th>
                    <th className={`text-right px-4 py-2.5 font-medium ${subtleText}`}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingApprovalList.map((req) => (
                    <React.Fragment key={req.id}>
                      <tr
                        className={`border-t ${borderColor} ${isDark ? 'hover:bg-slate-700/40' : 'hover:bg-gray-50/80'} transition-colors cursor-pointer`}
                        onClick={() => setExpandedApproval(expandedApproval === req.id ? null : req.id)}
                      >
                        <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                          {req.employeeName || 'Employee'}
                          <svg className={`w-3 h-3 inline ml-1 ${subtleText} transition-transform ${expandedApproval === req.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </td>
                        <td className={`px-4 py-2.5 whitespace-nowrap ${subtleText}`}>{formatLeaveDate(req.start_date, req.end_date)}</td>
                        <td className="px-2 py-2.5 whitespace-nowrap">{{ casual: 'CL', sick: 'SL', comp: 'Comp', loss_of_pay: 'LOP' }[req.leave_type] || req.leave_type || req.reason || '--'}</td>
                        <td className={`px-2 py-2.5 ${subtleText}`}>{Number(req.total_days) || '--'}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex gap-1.5">
                            <button type="button" disabled={actionLoading === req.id} onClick={() => handleApprove(req.id)}
                              className="px-2.5 py-1 rounded-md text-xs font-medium text-white bg-brand hover:bg-brand-hover disabled:opacity-50 transition-colors">Approve</button>
                            <button type="button" disabled={actionLoading === req.id} onClick={() => handleReject(req.id)}
                              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50 ${isDark ? 'text-red-400 bg-red-900/30 hover:bg-red-900/50' : 'text-red-600 bg-red-50 hover:bg-red-100'}`}>Reject</button>
                          </div>
                        </td>
                      </tr>
                      {expandedApproval === req.id && (
                        <tr>
                          <td colSpan={5} className={`px-4 pb-3 ${isDark ? 'bg-slate-800/50' : 'bg-gray-50/50'}`}>
                            <DashboardPretext
                              employeeId={req.employeeId}
                              allLeaveRequests={allLeaveRequests}
                              allShiftChangeRequests={allShiftChangeRequests}
                              compOffSummary={compOffSummary}
                              isDark={isDark}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Upcoming Approved Leaves */}
        <div className={`rounded-xl border overflow-hidden ${card}`}>
          <div className={`flex items-center justify-between px-4 py-3 border-b ${borderColor}`}>
            <h2 className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Upcoming Leaves</h2>
            <button type="button" onClick={() => onNavigate?.('approvals')}
              className="text-[11px] font-medium text-brand hover:text-brand-hover transition-colors">View all</button>
          </div>
          {!canApprove || upcomingApprovedLeaves.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <svg className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className={`text-xs ${subtleText}`}>No upcoming leaves</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-full text-xs">
                <thead>
                  <tr className={isDark ? 'bg-slate-700/50' : 'bg-gray-50'}>
                    <th className={`text-left px-4 py-2.5 font-medium ${subtleText}`}>Employee</th>
                    <th className={`text-left px-4 py-2.5 font-medium ${subtleText}`}>Dates</th>
                    <th className={`text-left px-2 py-2.5 font-medium ${subtleText}`}>Type</th>
                    <th className={`text-left px-2 py-2.5 font-medium ${subtleText}`}>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingApprovedLeaves.map((req) => {
                    const startStr = String(req.start_date || '').slice(0, 10);
                    const endStr = String(req.end_date || req.start_date || '').slice(0, 10);
                    const isOnLeaveToday = startStr && endStr && startStr <= actualToday && endStr >= actualToday;
                    const rowBase = `border-t ${borderColor} transition-colors`;
                    const rowColor = isOnLeaveToday
                      ? (isDark ? 'bg-amber-900/30 hover:bg-amber-900/40' : 'bg-amber-100 hover:bg-amber-200')
                      : (isDark ? 'hover:bg-slate-700/40' : 'hover:bg-gray-50/80');
                    return (
                      <tr key={req.id} className={`${rowBase} ${rowColor}`}>
                        <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                          {req.employeeName || 'Employee'}
                          {isOnLeaveToday && (
                            <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${isDark ? 'bg-amber-800 text-amber-100' : 'bg-amber-500 text-white'}`}>
                              On leave today
                            </span>
                          )}
                        </td>
                        <td className={`px-4 py-2.5 whitespace-nowrap ${isOnLeaveToday ? (isDark ? 'text-amber-200' : 'text-amber-800') : subtleText}`}>
                          {formatLeaveDate(req.start_date, req.end_date)}
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap">
                          {{ casual: 'CL', sick: 'SL', comp: 'Comp', loss_of_pay: 'LOP' }[req.leave_type] || req.leave_type || '--'}
                        </td>
                        <td className={`px-2 py-2.5 ${isOnLeaveToday ? (isDark ? 'text-amber-200' : 'text-amber-800') : subtleText}`}>
                          {req.total_days || '--'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Birthdays (compact) ─────────────────────────────────── */}
      {(todayBirthdays.length > 0 || upcomingBirthdays.length > 0) && (
        <div className={`rounded-xl border overflow-hidden ${card}`}>
          <div className={`flex items-center justify-between px-5 py-3 border-b ${borderColor}`}>
            <h2 className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>
              {todayBirthdays.length > 0 ? '🎂 Today\'s Birthdays' : 'Upcoming Birthdays'}
            </h2>
            <button type="button" onClick={() => onNavigate?.('celebrations')}
              className="text-[11px] font-medium text-brand hover:text-brand-hover transition-colors">View all</button>
          </div>
          <div className="p-4 flex flex-wrap gap-2">
            {todayBirthdays.map((b) => (
              <div key={b.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${isDark ? 'bg-pink-900/30 text-pink-200 border border-pink-700/40' : 'bg-pink-100 text-pink-800 border border-pink-200'}`}>
                <span>🎉</span>
                <span>{b.name}</span>
                <span className="opacity-70">• Today</span>
              </div>
            ))}
            {upcomingBirthdays.slice(0, 5).map((b) => (
              <div key={b.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${isDark ? 'bg-slate-700/50 text-gray-200 border border-slate-600' : 'bg-gray-50 text-gray-700 border border-gray-200'}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold ${isDark ? 'bg-slate-600' : 'bg-brand/10 text-brand'}`}>
                  {(b.name || '?').charAt(0).toUpperCase()}
                </span>
                <span className="font-medium">{b.name}</span>
                <span className={subtleText}>• {formatBirthdayDate(b.date_of_birth)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Food Coupons Widget (admin/manager only) ──────────── */}
      {canApprove && dinnerSummary && (
        <div className={`rounded-xl border overflow-hidden ${card}`}>
          <div className={`flex items-center justify-between px-5 py-3 border-b ${borderColor}`}>
            <h2 className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Food Coupons</h2>
            <button type="button" onClick={() => onNavigate?.('dinner-tracker')}
              className="text-[11px] font-medium text-brand hover:text-brand-hover transition-colors">View Details</button>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-4">
              <div className={`rounded-lg py-3 text-center ${isDark ? 'bg-brand/10' : 'bg-brand/5'}`}>
                <p className="text-xl font-bold text-brand">{dinnerSummary.coupons_today ?? 0}</p>
                <p className={`text-[9px] font-medium mt-0.5 uppercase tracking-wide ${subtleText}`}>Today</p>
              </div>
              <div className={`rounded-lg py-3 text-center ${isDark ? 'bg-green-900/20' : 'bg-green-50'}`}>
                <p className="text-xl font-bold text-green-500">{dinnerSummary.coupons_this_month}</p>
                <p className={`text-[9px] font-medium mt-0.5 uppercase tracking-wide ${subtleText}`}>This Month</p>
              </div>
              <div className={`rounded-lg py-3 text-center ${isDark ? 'bg-amber-900/20' : 'bg-amber-50'}`}>
                <p className="text-xl font-bold text-amber-500">{'\u20B9'}{(dinnerSummary.total_amount || 0).toLocaleString('en-IN')}</p>
                <p className={`text-[9px] font-medium mt-0.5 uppercase tracking-wide ${subtleText}`}>Cost</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Row 4: Quick Links (compact) ───────────────────────── */}
      {/* Schedules and Assets are admin/manager/team_lead only — plain employees can't open them so we hide the tiles entirely. */}
      <div className={`rounded-xl border overflow-hidden ${card}`}>
        <div className={`grid ${userType === 'employee' ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
          {[
            { label: 'My Work', tab: 'my-work', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
            ...(userType !== 'employee' ? [{ label: 'Schedules', tab: 'schedules', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' }] : []),
            { label: 'Team', tab: 'team', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
            ...(userType !== 'employee' ? [{ label: 'Assets', tab: 'asset-management', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' }] : []),
          ].map((link, i) => (
            <button key={link.tab} type="button" onClick={() => onNavigate?.(link.tab)}
              className={`flex items-center justify-center sm:justify-start gap-2.5 px-4 sm:px-5 py-4 sm:py-3.5 text-sm font-medium transition-colors min-h-[48px] sm:min-h-0 ${
                isDark ? 'hover:bg-slate-700/50' : 'hover:bg-gray-50'
              } ${i % 2 !== 0 ? (isDark ? 'border-l border-slate-700' : 'border-l border-gray-100') : ''} ${i >= 2 ? (isDark ? 'border-t border-slate-700 sm:border-t-0' : 'border-t border-gray-100 sm:border-t-0') : ''} ${i >= 2 && i % 2 === 0 ? '' : ''} ${i > 0 ? (isDark ? 'sm:border-l sm:border-slate-700' : 'sm:border-l sm:border-gray-100') : ''}`}>
              <svg className={`w-4 h-4 flex-shrink-0 ${subtleText}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={link.icon} />
              </svg>
              {link.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
