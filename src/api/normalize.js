/**
 * Normalize API responses to the shape the UI (mock-based) expects.
 * API uses snake_case and role; UI uses type (admin/manager/team_lead/employee) and some camelCase.
 */

export function normalizeUser(apiUser) {
  if (!apiUser) return null;
  return {
    id: apiUser.id,
    name: apiUser.name,
    email: apiUser.email,
    type: apiUser.role,
    role: apiUser.role,
    client_id: apiUser.client_id,
    manager_id: apiUser.manager_id,
    team_lead_id: apiUser.team_lead_id,
    date_of_birth: apiUser.date_of_birth ?? null,
    phone: apiUser.phone ?? null,
    designation: apiUser.designation ?? null,
    department_id: apiUser.department_id ?? null,
    department_name: apiUser.department_name ?? null,
    work_timezone: apiUser.work_timezone ?? null,
    work_hours: apiUser.work_hours ?? null,
    work_location_default: apiUser.work_location_default ?? null,
  };
}

export function normalizeLeaveRequest(lr) {
  if (!lr || typeof lr !== 'object') return null;
  try {
  const normD = (d) => d ? String(d).slice(0, 10) : d;
  const sd = normD(lr.start_date);
  const ed = normD(lr.end_date);
  const leaveDate = sd === ed ? sd : `${sd} to ${ed}`;
  return {
    id: lr.id,
    employeeId: lr.employee_id,
    employeeName: lr.employee_name,
    clientId: lr.client_id,
    clientName: lr.client_name || null,
    employeeRole: lr.employee_role || null,
    employeeDesignation: lr.employee_designation || null,
    departmentName: lr.department_name || null,
    leaveDate,
    start_date: normD(lr.start_date),
    end_date: normD(lr.end_date),
    total_days: lr.total_days,
    reason: lr.reason || null,
    leave_type: lr.leave_type,
    status: lr.status,
    approvalChain: Array.isArray(lr.approval_chain) ? lr.approval_chain.map((s) => ({
      userId: s.user_id,
      userName: s.user_name,
      role: s.role,
      approvedAt: s.at,
    })) : [],
    rejectedBy: lr.rejected_by ? { userId: lr.rejected_by, userName: lr.rejected_by_name || null } : null,
    rejectedAt: lr.rejected_at,
    rejectionNotes: lr.rejection_notes || null,
    rejectedByName: lr.rejected_by_name || null,
    requestedAt: lr.requested_at,
    acknowledgedBy: lr.acknowledged_by || null,
    acknowledgedAt: lr.acknowledged_at || null,
  };
  } catch {
    return null;
  }
}

/** Build shift table rows from API shifts list (one row per user per shift_date; optionally filter by search and pick "today") */
export function buildShiftRowsFromApi(apiShifts, options = {}) {
  // Use IST date as "today" — before 5 AM, overnight shifts are still active so use yesterday
  const nowISTDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  let todayIST;
  if (nowISTDate.getHours() < 5) {
    const y = new Date(nowISTDate); y.setDate(y.getDate() - 1);
    todayIST = `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
  } else {
    todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }
  const { searchQuery = '', clientId = null, today = todayIST, adminIds = null, leaveRequests = [] } = options;
  
  // Build a fast lookup map for leaves for 'today'
  const leaveMap = new Map();
  leaveRequests.forEach((lr) => {
    if (lr.status === 'approved') {
      const eid = lr.employeeId || lr.employee_id;
      const sd = String(lr.start_date || lr.leaveDate || '').slice(0, 10);
      const ed = String(lr.end_date || lr.leaveDate || '').slice(0, 10);
      if (today >= sd && today <= (ed || sd)) {
        leaveMap.set(eid, lr.leave_type || 'Leave');
      }
    }
  });

  // Admins (e.g. CEO) never get marked "absent" — they have flexible hours.
  const adminIdSet = adminIds instanceof Set ? adminIds : (Array.isArray(adminIds) ? new Set(adminIds) : null);
  let list = apiShifts || [];
  if (clientId) list = list.filter((s) => s.client_id === clientId);
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    list = list.filter((s) => (s.employee_name || '').toLowerCase().includes(q));
  }
  const byUser = {};
  list.forEach((s) => {
    const uid = s.user_id;
    if (!byUser[uid]) byUser[uid] = { user_id: uid, employee_name: s.employee_name, department_id: s.department_id || null, shifts: [], work_timezone: s.work_timezone };
    byUser[uid].shifts.push(s);
  });
  const actualTodayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const isViewingPastDate = today < actualTodayIST;

  // Strip seconds from time strings: "19:30:00" → "19:30"
  const fmtShiftTime = (t) => t ? t.split(':').slice(0, 2).join(':') : null;

  return Object.values(byUser).map(({ user_id, employee_name, department_id, shifts, work_timezone }) => {
    const forToday = shifts.find((s) => s.shift_date === today);
    const s = forToday || shifts[0];
    let clockInAt = s.clock_in_at;
    let clockOutAt = s.clock_out_at;

    // If we fell back to a different date's shift, don't use its clock data for today's display
    if (!forToday && s.shift_date !== today) {
      clockInAt = null;
      clockOutAt = null;
    }

    // If clock_out is BEFORE clock_in, it's a stale event from a previous shift — ignore it
    // Also glitch detection: if clock-in and clock-out are < 2 minutes apart, ignore the clock-out
    if (clockInAt && clockOutAt) {
      const inTime = new Date(clockInAt).getTime();
      const outTime = new Date(clockOutAt).getTime();
      if (outTime <= inTime) {
        // Stale clock-out from before the current clock-in — person is still clocked in
        clockOutAt = null;
      } else if (outTime - inTime < 2 * 60 * 1000) {
        // Accidental clock-out (< 2 min gap) — treat as still clocked in
        clockOutAt = null;
      }
    }

    // Also check if user has an active clock-in from a previous shift (overnight / forgot to logout)
    const activeFromOtherShift = !clockInAt && shifts.find((sh) => sh.shift_date !== today && sh.clock_in_at && !sh.clock_out_at);

    // Get current time in user's timezone
    const tz = work_timezone || 'Asia/Kolkata';
    const nowTz = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
    const nowMin = nowTz.getHours() * 60 + nowTz.getMinutes();

    const startTime = s.shift_start_time;
    const endTime = s.shift_end_time;
    const isValidShiftTime = (t) => t && String(t).toUpperCase() !== 'OFF';
    const hasShiftToday = s.shift_date === today && !s.is_off && isValidShiftTime(startTime) && isValidShiftTime(endTime);

    // Pre-compute shift timing info (reused in multiple places)
    let shiftStartMin = 0, shiftEndMin = 0, currentMin = nowMin;
    let isOvernightShift = false;
    if (isValidShiftTime(startTime) && isValidShiftTime(endTime)) {
      const [sh, sm] = startTime.split(':').map(Number);
      shiftStartMin = sh * 60 + (sm || 0);
      const [eh, em] = endTime.split(':').map(Number);
      shiftEndMin = eh * 60 + (em || 0);
      if (shiftEndMin <= shiftStartMin) {
        shiftEndMin += 24 * 60; // overnight
        isOvernightShift = true;
      }
      currentMin = nowMin;
      // For overnight shifts, only adjust currentMin if we're ACTUALLY in the tail of YESTERDAY's
      // overnight shift (i.e. early morning on the calendar day after the shift started).
      // Previously this adjustment also fired for TODAY's overnight shift that hasn't started yet,
      // wrongly marking employees as "absent" in the morning when their shift starts that evening.
      if (isOvernightShift && currentMin < shiftStartMin && currentMin < (shiftEndMin - 24 * 60)) {
        // Are we viewing YESTERDAY's shift? Only then are we "in the tail" of this overnight shift.
        const selDateMs = new Date(s.shift_date + 'T00:00:00').getTime();
        const actualTodayMs = new Date(actualTodayIST + 'T00:00:00').getTime();
        const diffDays = Math.round((actualTodayMs - selDateMs) / (24 * 60 * 60 * 1000));
        if (diffDays === 1) {
          // Viewing yesterday, and we're in the early-morning tail — adjust currentMin into +24h range
          currentMin += 24 * 60;
        }
        // Otherwise (viewing today or the future), the overnight shift hasn't started yet — leave currentMin alone
      }
    }

    // For overnight shifts on a "past" date, check if the shift actually extends into today
    // e.g., March 25 shift 7:30 PM - 4:30 AM → shift is still active until 4:30 AM on March 26
    const isOvernightStillActive = isOvernightShift && isViewingPastDate && s.shift_date === today && (() => {
      // Only applies if the selected date is exactly yesterday
      const selDate = new Date(today + 'T00:00:00');
      const todayDate = new Date(actualTodayIST + 'T00:00:00');
      const diffDays = (todayDate - selDate) / (24 * 60 * 60 * 1000);
      if (diffDays !== 1) return false; // more than 1 day ago — definitely over
      // Check if current time is before the overnight shift end
      return nowMin < (shiftEndMin - 24 * 60); // shiftEndMin includes +24h, subtract to get real end hour
    })();

    const isAdminUser = adminIdSet && adminIdSet.has(user_id);

    const wasAutoLoggedOut = s.clock_out_device === 'system';
    let status = 'off';
    if (s.shift_date === today && isViewingPastDate && !isOvernightStillActive) {
      // ── Past date: shift is over, determine status from clock events ──
      if (clockInAt && clockOutAt) {
        status = wasAutoLoggedOut ? 'auto_logged_out' : 'completed';
      } else if (clockInAt && !clockOutAt) {
        // Clocked in but never clocked out — keep as logged in so admin can manually clock out
        status = 'current_logged_in';
      } else if (!hasShiftToday) {
        status = 'off';
      } else {
        // Had a shift, never clocked in — but admins are never marked "absent"
        status = isAdminUser ? 'current_not_logged_in' : 'absent';
      }
    } else if (s.shift_date === today) {
      // ── Current date (today) ──
      if (clockInAt && clockOutAt) {
        // Has both clock-in and clock-out — they're done for the day
        status = wasAutoLoggedOut ? 'auto_logged_out' : 'completed';
      } else if (clockInAt && !clockOutAt) {
        // For overnight shifts: if it's the next calendar day and shift end has passed, treat as completed
        if (isOvernightShift && hasShiftToday && currentMin >= shiftEndMin) {
          status = 'completed';
        } else {
          status = 'current_logged_in';
        }
      } else if (activeFromOtherShift) {
        status = 'current_logged_in';
      } else if (!hasShiftToday) {
        status = 'off';
      } else {
        // Has a shift today, not clocked in — determine if buffer/absent
        if (currentMin < shiftStartMin) {
          status = 'not_started';
        } else if (currentMin <= shiftStartMin + 60) {
          status = 'current_not_logged_in';
        } else {
          // Admins are never marked "absent" — they have flexible hours
          status = isAdminUser ? 'current_not_logged_in' : 'absent';
        }
      }
    } else if (clockInAt && !clockOutAt) {
      status = 'current_logged_in';
    } else if (clockInAt && clockOutAt) {
      // Different date but has clock data (edge case)
      status = 'completed';
    }

    // For display, prefer the active clock-in data if from another shift
    const displayClockIn = clockInAt || (activeFromOtherShift?.clock_in_at);
    const displayClockOut = clockOutAt;

    const formatTime = (ts) => {
      if (!ts) return '—';
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
    };

    // Build shift time display
    let shiftTime;
    const leaveType = leaveMap.get(user_id);
    if (leaveType) {
      if (leaveType === 'work_from_home') shiftTime = 'Work From Home';
      else if (leaveType === 'half_day') shiftTime = 'Half Day Leave';
      else shiftTime = 'On Leave';
    } else if (s.is_off === true || !isValidShiftTime(startTime) || !isValidShiftTime(endTime)) {
      shiftTime = 'Off';
    } else if (fmtShiftTime(startTime) && fmtShiftTime(endTime)) {
      shiftTime = `${fmtShiftTime(startTime)}-${fmtShiftTime(endTime)}`;
    } else {
      shiftTime = 'Off';
    }

    return {
      employeeId: user_id,
      employeeName: employee_name,
      employeeRole: s.role || 'employee',
      department_id: department_id,
      department_name: s.department_name || null,
      shiftTime,
      shiftStartTime: fmtShiftTime(startTime) || null,
      shiftEndTime: fmtShiftTime(endTime) || null,
      shiftDate: s.shift_date || today,
      status,
      loginTime: displayClockIn ? formatTime(displayClockIn) : '—',
      logoutTime: (displayClockOut && typeof displayClockOut === 'string' && displayClockOut.length > 4) ? formatTime(displayClockOut) : (status === 'completed' && isViewingPastDate ? 'Auto' : '—'),
      client_id: s.client_id,
      clockInBy: s.clock_in_by || null,
      clockOutBy: s.clock_out_by || null,
      clockInDevice: s.clock_in_device || null,
      clockOutDevice: s.clock_out_device || null,
    };
  });
}

