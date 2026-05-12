import { useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef } from 'react';
import RoleBadge from './RoleBadge';

// ── Shift Presets (AGS default IST shifts — cover US business hours from India) ──
const QUICK_SHIFTS = [
  { value: '14:00-23:00', label: '2 PM - 11 PM IST',    short: '2-11' },
  { value: '13:00-22:00', label: '1 PM - 10 PM IST',    short: '1-10' },
  { value: '23:00-09:00', label: '11 PM - 9 AM IST',    short: '11-9' },
  { value: '19:30-04:30', label: '7:30 PM - 4:30 AM IST', short: '7:30-4:30' },
  { value: '19:00-04:00', label: '7 PM - 4 AM IST',     short: '7-4' },
];

const ALL_SHIFT_OPTIONS = [
  { value: '', label: '(empty)' },
  { value: 'OFF', label: 'OFF' },
  { value: 'LEAVE', label: 'Leave' },
  { value: '14:00-23:00', label: '14:00 - 23:00 (2 PM - 11 PM IST)' },
  { value: '13:00-22:00', label: '13:00 - 22:00 (1 PM - 10 PM IST)' },
  { value: '23:00-09:00', label: '23:00 - 09:00 (11 PM - 9 AM IST)' },
  { value: '19:30-04:30', label: '19:30 - 04:30 (7:30 PM - 4:30 AM IST)' },
  { value: '19:00-04:00', label: '19:00 - 04:00 (7 PM - 4 AM IST)' },
];

// Values that should not be overwritten by fill operations
const SKIP_ON_FILL = new Set(['OFF', 'LEAVE']);

// Common cycle: click a cell to cycle through the two most-used defaults, then OFF, then empty
const CYCLE_VALUES = ['14:00-23:00', '19:30-04:30', 'OFF', ''];

function parseShiftValue(val) {
  if (!val || val === 'OFF') return null;
  const m = val.match(/^(\d{2}:\d{2})(?::\d{2})?\s*[- ]\s*(\d{2}:\d{2})(?::\d{2})?$/);
  if (m) return [m[1], m[2]];
  return null;
}

function normalizeCellVal(v) {
  return typeof v === 'string' && v.includes('-') ? v.replace(/(\d{2}:\d{2}):\d{2}/g, '$1') : v;
}

// Convert IST HH:MM to CST (IST - 11:30)
function istToCst(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  let totalMin = h * 60 + m - 690; // IST is UTC+5:30, CST is UTC-6:00, diff = 11:30 = 690 min
  if (totalMin < 0) totalMin += 1440;
  const cH = Math.floor(totalMin / 60) % 24;
  const cM = totalMin % 60;
  return `${String(cH).padStart(2, '0')}:${String(cM).padStart(2, '0')}`;
}

function cellDisplay(val, showCst = false) {
  if (!val) return '';
  if (val === 'OFF') return 'OFF';
  if (val === 'LEAVE') return 'L';
  const times = parseShiftValue(val);
  if (times) {
    if (showCst) {
      return `${istToCst(times[0])}-${istToCst(times[1])}`;
    }
    return `${times[0]}-${times[1]}`;
  }
  return val;
}

function cellColor(val, isDark) {
  if (!val) return isDark ? 'bg-slate-800/50' : 'bg-gray-50';
  if (val === 'OFF') return isDark ? 'bg-amber-900/20 text-amber-300' : 'bg-amber-50 text-amber-700';
  if (val === 'LEAVE') return isDark ? 'bg-indigo-900/30 text-indigo-300' : 'bg-indigo-50 text-indigo-700';
  return isDark ? 'bg-brand/10 text-brand' : 'bg-brand/5 text-brand';
}

// ── Main Component ─────────────────────────────────────────────

const ScheduleBuildGridInner = forwardRef(function ScheduleBuildGridInner(
  { dates = [], rows = [], clientId, departmentId, onSave, isDark, saving = false, onSaveTemplate, templateName, onTemplateNameChange, templates = [], applyingTemplateId, onApplyTemplate, leaveMap = {} },
  ref
) {
  const [edits, setEdits] = useState({});
  const [showCst, setShowCst] = useState(false);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [editingCell, setEditingCell] = useState(null); // { userId, date }
  const [customStart, setCustomStart] = useState('09:00');
  const [customEnd, setCustomEnd] = useState('18:00');
  const [showCustom, setShowCustom] = useState(false);
  const selectRef = useRef(null);

  // ── Drag-to-fill state ──
  const [dragging, setDragging] = useState(null); // { userId, startDate, value }
  const [dragOverDate, setDragOverDate] = useState(null);

  const [dropdownPos, setDropdownPos] = useState(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!editingCell) return;
    const handleClick = (e) => {
      // Don't close if custom time modal is open (clicks inside modal should not clear editingCell)
      if (showCustom) return;
      if (selectRef.current && !selectRef.current.contains(e.target)) {
        setEditingCell(null);
        setDropdownPos(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [editingCell, showCustom]);

  const getCell = useCallback((userId, date) => {
    const raw = edits[`${userId}-${date}`] ?? rows.find((r) => r.user_id === userId)?.shifts?.[date] ?? '';
    return normalizeCellVal(raw);
  }, [edits, rows]);

  const setCell = useCallback((userId, date, value) => {
    setEdits((e) => ({ ...e, [`${userId}-${date}`]: value }));
  }, []);

  const setCellsForRow = useCallback((userId, value) => {
    setEdits((e) => {
      const next = { ...e };
      dates.forEach((d) => {
        const existing = next[`${userId}-${d}`] ?? rows.find((r) => r.user_id === userId)?.shifts?.[d] ?? '';
        const norm = normalizeCellVal(existing);
        if (value === 'OFF' || !SKIP_ON_FILL.has(norm)) {
          next[`${userId}-${d}`] = value;
        }
      });
      return next;
    });
  }, [dates, rows]);

  const setCellsForColumn = useCallback((date, value) => {
    setEdits((e) => {
      const next = { ...e };
      rows.forEach((r) => {
        const existing = next[`${r.user_id}-${date}`] ?? r.shifts?.[date] ?? '';
        const norm = normalizeCellVal(existing);
        if (value === 'OFF' || !SKIP_ON_FILL.has(norm)) {
          next[`${r.user_id}-${date}`] = value;
        }
      });
      return next;
    });
  }, [rows]);

  const setCellsForSelected = useCallback((value) => {
    if (selectedRows.size === 0) return;
    setEdits((e) => {
      const next = { ...e };
      selectedRows.forEach((userId) => {
        dates.forEach((d) => {
          const existing = next[`${userId}-${d}`] ?? rows.find((r) => r.user_id === userId)?.shifts?.[d] ?? '';
          const norm = normalizeCellVal(existing);
          if (value === 'OFF' || !SKIP_ON_FILL.has(norm)) {
            next[`${userId}-${d}`] = value;
          }
        });
      });
      return next;
    });
  }, [selectedRows, dates, rows]);

  const getCurrentGridData = useCallback(() => {
    const shiftsByUser = {};
    rows.forEach((row) => {
      shiftsByUser[row.user_id] = { ...row.shifts };
      dates.forEach((date) => {
        const val = getCell(row.user_id, date);
        if (val) shiftsByUser[row.user_id][date] = val;
      });
    });
    return { dates: [...dates], rows: rows.map((r) => ({ ...r, shifts: shiftsByUser[r.user_id] || {} })), timezone: 'IST' };
  }, [rows, dates, getCell]);

  const realRows = rows.filter((r) => r.user_id !== '_pattern');

  const [saveError, setSaveError] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveRepeatUntil, setSaveRepeatUntil] = useState('');

  // Helper: add N days to a date string
  const addDaysStr = (dateStr, n) => {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  // Build base week assignments from the grid
  // Priority: 1) If checkboxes are selected, save only those people
  //           2) Else if cells were edited, save only edited people
  //           3) Else save nothing (empty assignments triggers error)
  const buildBaseAssignments = useCallback(() => {
    // Determine which user_ids to include
    let targetUserIds;
    if (selectedRows.size > 0) {
      // Checkboxes are ticked — save only selected people
      targetUserIds = selectedRows;
    } else {
      // No checkboxes — fall back to only edited rows
      const editedUserIds = new Set();
      Object.keys(edits).forEach((key) => {
        const userId = key.split('-').slice(0, 5).join('-'); // UUID has 5 parts
        editedUserIds.add(userId);
      });
      targetUserIds = editedUserIds;
    }

    const assignments = [];
    const leaveEntries = [];
    realRows.forEach((row) => {
      // Skip rows not in target set — prevents overwriting unchanged schedules
      if (targetUserIds.size > 0 && !targetUserIds.has(row.user_id)) return;
      dates.forEach((date) => {
        const val = getCell(row.user_id, date);
        if (val === 'LEAVE') {
          assignments.push({ user_id: row.user_id, shift_date: date, is_off: true });
          leaveEntries.push({ user_id: row.user_id, date });
        } else {
          const isOff = !val || val === 'OFF';
          if (isOff) {
            assignments.push({ user_id: row.user_id, shift_date: date, is_off: true });
          } else {
            const times = parseShiftValue(val);
            if (times?.[0] && times?.[1]) {
              assignments.push({ user_id: row.user_id, shift_date: date, shift_start_time: times[0], shift_end_time: times[1], is_off: false });
            }
          }
        }
      });
    });
    return { assignments, leaveEntries };
  }, [realRows, dates, getCell, edits, selectedRows]);

  // Open save modal instead of saving directly
  const triggerSave = useCallback(() => {
    setSaveError('');
    if (!onSave) return;
    if (realRows.length === 0) {
      setSaveError('No employees to save schedules for.');
      return;
    }
    const { assignments } = buildBaseAssignments();
    if (assignments.length === 0) {
      setSaveError('No shift assignments to save.');
      return;
    }
    // Default repeat-until to end of current week
    if (dates.length > 0) {
      const lastDate = dates[dates.length - 1];
      setSaveRepeatUntil(lastDate);
    }
    setShowSaveModal(true);
  }, [onSave, realRows, dates, buildBaseAssignments]);

  // Confirm save: repeat the week pattern until the chosen date
  const confirmSave = useCallback(() => {
    const { assignments: baseAssignments, leaveEntries: baseLeaves } = buildBaseAssignments();
    if (baseAssignments.length === 0) return;

    const startDate = dates[0]; // Monday of current week
    const endDate = saveRepeatUntil || dates[dates.length - 1];

    // Calculate how many weeks to repeat
    const startMs = new Date(startDate + 'T00:00:00').getTime();
    const endMs = new Date(endDate + 'T00:00:00').getTime();
    const totalWeeks = Math.max(1, Math.ceil((endMs - startMs + 86400000) / (7 * 86400000)));

    // Build all assignments across all weeks
    const allAssignments = [];
    const allLeaves = [];
    for (let w = 0; w < totalWeeks; w++) {
      const offset = w * 7;
      baseAssignments.forEach((a) => {
        allAssignments.push({ ...a, shift_date: addDaysStr(a.shift_date, offset) });
      });
      baseLeaves.forEach((l) => {
        allLeaves.push({ ...l, date: addDaysStr(l.date, offset) });
      });
    }

    const body = { assignments: allAssignments };
    if (clientId) body.client_id = clientId;
    if (departmentId) body.department_id = departmentId;
    if (allLeaves.length > 0) body.leave_entries = allLeaves;

    // Also auto-save as template if name is provided
    if (saveName.trim() && onSaveTemplate) {
      onSaveTemplate(saveName.trim(), getCurrentGridData());
    }

    onSave(body);
    setShowSaveModal(false);
    setSaveName('');
  }, [buildBaseAssignments, dates, saveRepeatUntil, clientId, departmentId, saveName, onSaveTemplate, getCurrentGridData, onSave]);

  useImperativeHandle(ref, () => ({ getCurrentGridData, triggerSave }), [getCurrentGridData, triggerSave]);

  // Toggle row selection
  const toggleRow = (userId) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const selectAllRows = () => {
    if (selectedRows.size === realRows.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(realRows.map((r) => r.user_id)));
  };

  // Quick-fill weekdays (Mon-Fri) with a shift, Sat-Sun OFF — skips LEAVE days
  const fillWeekdayPattern = useCallback((userId, shift) => {
    setEdits((e) => {
      const next = { ...e };
      dates.forEach((d) => {
        const existing = next[`${userId}-${d}`] ?? rows.find((r) => r.user_id === userId)?.shifts?.[d] ?? '';
        const norm = normalizeCellVal(existing);
        if (norm === 'LEAVE') return; // don't overwrite leave
        const dayOfWeek = new Date(d + 'T12:00:00').getDay(); // 0=Sun, 6=Sat
        next[`${userId}-${d}`] = (dayOfWeek === 0 || dayOfWeek === 6) ? 'OFF' : shift;
      });
      return next;
    });
  }, [dates, rows]);

  // Cell click handler — single click opens inline dropdown
  const handleCellClick = (userId, date, e) => {
    // Don't open if already editing this cell
    if (editingCell?.userId === userId && editingCell?.date === date) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dropdownHeight = 360; // approximate max height of dropdown
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < dropdownHeight) {
      // Open upward
      setDropdownPos({ bottom: window.innerHeight - rect.top + 2, left: rect.left, openUp: true });
    } else {
      setDropdownPos({ top: rect.bottom + 2, left: rect.left, openUp: false });
    }
    setEditingCell({ userId, date });
  };

  // Cell double-click — quick cycle
  const handleCellDblClick = (userId, date) => {
    const current = getCell(userId, date);
    const idx = CYCLE_VALUES.indexOf(current);
    const next = CYCLE_VALUES[(idx + 1) % CYCLE_VALUES.length];
    setCell(userId, date, next);
    setEditingCell(null);
  };

  const handleCustomApply = () => {
    if (!editingCell) return;
    const s = (customStart || '09:00').slice(0, 5);
    const e = (customEnd || '18:00').slice(0, 5);
    setCell(editingCell.userId, editingCell.date, `${s}-${e}`);
    setShowCustom(false);
    setEditingCell(null);
  };

  // Fill from this cell to end of cycle for this user (skipping OFF/LEAVE days)
  const fillRemaining = useCallback((userId, fromDate, value) => {
    setEdits((e) => {
      const next = { ...e };
      let found = false;
      dates.forEach((d) => {
        if (d === fromDate) found = true;
        if (found) {
          const existing = next[`${userId}-${d}`] ?? rows.find((r) => r.user_id === userId)?.shifts?.[d] ?? '';
          const norm = normalizeCellVal(existing);
          if (!SKIP_ON_FILL.has(norm)) {
            next[`${userId}-${d}`] = value;
          }
        }
      });
      return next;
    });
  }, [dates, rows]);

  // ── Drag-to-fill handlers ──
  const handleDragStart = (userId, date) => {
    const val = getCell(userId, date);
    if (!val && val !== 'OFF') return;
    setDragging({ userId, startDate: date, value: val });
    setDragOverDate(date);
  };

  const handleDragOver = (userId, date) => {
    if (!dragging || dragging.userId !== userId) return;
    setDragOverDate(date);
  };

  const handleDragEnd = () => {
    if (!dragging || !dragOverDate) { setDragging(null); setDragOverDate(null); return; }
    const { userId, startDate, value } = dragging;
    setEdits((e) => {
      const next = { ...e };
      let inRange = false;
      const startIdx = dates.indexOf(startDate);
      const endIdx = dates.indexOf(dragOverDate);
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      for (let i = lo; i <= hi; i++) {
        next[`${userId}-${dates[i]}`] = value;
      }
      return next;
    });
    setDragging(null);
    setDragOverDate(null);
  };

  // Global mouseup to end drag
  useEffect(() => {
    if (!dragging) return;
    const up = () => handleDragEnd();
    document.addEventListener('mouseup', up);
    return () => document.removeEventListener('mouseup', up);
  }, [dragging, dragOverDate]);

  // ── Day names ────────────────────────────────────────────────
  const dayNames = dates.map((d) => {
    const day = new Date(d + 'T12:00:00');
    return { short: day.toLocaleDateString('en-US', { weekday: 'short' }), num: d.slice(8) };
  });

  // ── Styles ───────────────────────────────────────────────────
  const thClass = isDark ? 'bg-slate-700/80 text-slate-200 border-slate-600' : 'bg-gray-50 text-gray-700 border-gray-200';
  const tdClass = isDark ? 'border-slate-700' : 'border-gray-100';
  const btnSmall = isDark
    ? 'px-2 py-1 rounded text-[10px] font-medium bg-slate-600 hover:bg-slate-500 text-gray-200 transition-colors'
    : 'px-2 py-1 rounded text-[10px] font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors';
  const btnBrand = 'px-2 py-1 rounded text-[10px] font-medium bg-brand/15 hover:bg-brand/25 text-brand transition-colors';

  return (
    <div className="space-y-4">
      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div className={`flex flex-wrap items-center gap-3 p-3 rounded-lg border ${isDark ? 'bg-slate-800/50 border-slate-700' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-gray-500 dark:text-gray-400">TZ:</span>
          <button type="button" onClick={() => setShowCst(false)}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${!showCst ? 'bg-brand text-white' : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}>
            IST
          </button>
          <button type="button" onClick={() => setShowCst(true)}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${showCst ? 'bg-brand text-white' : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}>
            CST
          </button>
        </div>

        <div className="h-4 w-px bg-gray-300 dark:bg-slate-600" />

        <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-semibold">Quick fill:</span>
        {QUICK_SHIFTS.map((s) => (
          <button key={s.value} type="button" onClick={() => {
            if (selectedRows.size > 0) setCellsForSelected(s.value);
          }} disabled={selectedRows.size === 0} className={`${btnSmall} disabled:opacity-30`} title={`Set selected rows to ${s.label}`}>
            {s.short}
          </button>
        ))}
        <button type="button" onClick={() => { if (selectedRows.size > 0) setCellsForSelected('OFF'); }}
          disabled={selectedRows.size === 0} className={`${btnSmall} disabled:opacity-30`} title="Set selected rows to OFF">
          OFF
        </button>

        <div className="h-4 w-px bg-gray-300 dark:bg-slate-600" />

        <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-semibold">Mon-Fri pattern:</span>
        {QUICK_SHIFTS.map((s) => (
          <button key={`pattern-${s.value}`} type="button" onClick={() => {
            if (selectedRows.size > 0) selectedRows.forEach((uid) => fillWeekdayPattern(uid, s.value));
          }} disabled={selectedRows.size === 0} className={`${btnBrand} disabled:opacity-30`} title={`Mon-Fri ${s.label}, Sat-Sun OFF`}>
            M-F {s.short}
          </button>
        ))}

        {selectedRows.size > 0 && (
          <span className="ml-auto text-[10px] text-brand font-medium">{selectedRows.size} selected</span>
        )}
      </div>

      <p className="text-[10px] text-gray-400 dark:text-gray-500">
        Tip: Select rows with checkboxes, then use toolbar buttons. Click a cell to pick shift, double-click to quick-cycle (9-6 / OFF / empty). Ctrl+S to save.
      </p>

      {/* ── Grid Table ──────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr>
              <th className={`px-2 py-2 border-b ${thClass} w-8`}>
                <input type="checkbox" checked={selectedRows.size === realRows.length && realRows.length > 0}
                  onChange={selectAllRows} className="rounded border-gray-300 text-brand focus:ring-brand" />
              </th>
              <th className={`px-3 py-2 border-b font-medium ${thClass}`}>Employee</th>
              {dates.map((d, i) => (
                <th key={d} className={`px-2 py-2 border-b font-medium text-center ${thClass}`}>
                  <div className="text-xs">{dayNames[i].short}</div>
                  <div className="text-[10px] opacity-60">{dayNames[i].num}</div>
                </th>
              ))}
              <th className={`px-2 py-2 border-b font-medium text-center ${thClass} w-20`}>
                <span className="text-[10px]">Row Fill</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={dates.length + 3} className="px-3 py-8 text-center text-gray-500 dark:text-gray-400">
                  No employees assigned to this client.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const isPattern = row.user_id === '_pattern';
              const isSelected = selectedRows.has(row.user_id);
              return (
                <tr key={row.user_id} className={isSelected ? (isDark ? 'bg-brand/5' : 'bg-brand/5') : ''}>
                  <td className={`px-2 py-1.5 border-b ${tdClass}`}>
                    {!isPattern && (
                      <input type="checkbox" checked={isSelected} onChange={() => toggleRow(row.user_id)}
                        className="rounded border-gray-300 text-brand focus:ring-brand" />
                    )}
                  </td>
                  <td className={`px-3 py-1.5 border-b ${tdClass} font-medium text-sm whitespace-nowrap`}>
                    <span className="text-gray-900 dark:text-white">{row.employee_name}</span>
                    {!isPattern && <RoleBadge user={{ name: row.employee_name, role: row.role }} />}
                  </td>
                  {dates.map((date) => {
                    const val = getCell(row.user_id, date);
                    const isEditing = editingCell?.userId === row.user_id && editingCell?.date === date;
                    const hasLeave = row.leaves?.[date] === true || leaveMap[`${row.user_id}-${date}`] === true;

                    if (hasLeave) {
                      return (
                        <td key={date} className={`px-1 py-1 border-b ${tdClass}`}>
                          <div className={`rounded px-1.5 py-1 text-center text-xs font-medium select-none min-w-[60px] ${isDark ? 'bg-indigo-900/30' : 'bg-indigo-50'}`} title="Approved Leave">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-500 text-white text-[10px] font-bold">
                              L
                            </span>
                          </div>
                        </td>
                      );
                    }

                    {/* Compute drag highlight */}
                    const isDragHighlight = dragging && dragging.userId === row.user_id && (() => {
                      const si = dates.indexOf(dragging.startDate);
                      const ei = dates.indexOf(dragOverDate);
                      const ci = dates.indexOf(date);
                      return ci >= Math.min(si, ei) && ci <= Math.max(si, ei);
                    })();

                    return (
                      <td key={date} className={`px-1 py-1 border-b ${tdClass} relative`}
                        onClick={(e) => handleCellClick(row.user_id, date, e)}
                        onDoubleClick={() => handleCellDblClick(row.user_id, date)}
                        onMouseDown={(e) => { if (e.button === 0 && !isEditing) handleDragStart(row.user_id, date); }}
                        onMouseEnter={() => handleDragOver(row.user_id, date)}>
                        <div className={`rounded px-1.5 py-1 text-center text-xs font-medium cursor-pointer select-none min-w-[60px] transition-colors ${cellColor(val, isDark)} ${isEditing ? 'ring-2 ring-brand' : isDragHighlight ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/30' : 'hover:ring-1 hover:ring-brand/50'}`}>
                          {cellDisplay(val, showCst) || <span className="text-gray-300 dark:text-gray-600">--</span>}
                        </div>
                        {/* Inline dropdown — rendered via fixed position to escape overflow:auto parent */}
                        {isEditing && dropdownPos && (
                          <div ref={selectRef}
                            className={`fixed z-50 rounded-lg border shadow-lg min-w-[140px] max-h-[300px] overflow-y-auto ${isDark ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200'}`}
                            style={dropdownPos.openUp
                              ? { bottom: dropdownPos.bottom, left: dropdownPos.left }
                              : { top: dropdownPos.top, left: dropdownPos.left }}
                            onClick={(e) => e.stopPropagation()}>
                            {ALL_SHIFT_OPTIONS.map((opt) => (
                              <button key={opt.value || '__empty'} type="button"
                                onClick={() => { setCell(row.user_id, date, opt.value); setEditingCell(null); setDropdownPos(null); }}
                                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${val === opt.value ? 'bg-brand/10 text-brand font-semibold' : isDark ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-50'}`}>
                                {opt.label}
                              </button>
                            ))}
                            <div className={`border-t ${isDark ? 'border-slate-600' : 'border-gray-100'}`}>
                              <button type="button"
                                onClick={() => { setShowCustom(true); }}
                                className={`w-full text-left px-3 py-1.5 text-xs font-medium ${isDark ? 'text-brand hover:bg-slate-700' : 'text-brand hover:bg-gray-50'}`}>
                                Custom time...
                              </button>
                              {val && (
                                <button type="button"
                                  onClick={() => { fillRemaining(row.user_id, date, val); setEditingCell(null); setDropdownPos(null); }}
                                  className={`w-full text-left px-3 py-1.5 text-xs font-medium ${isDark ? 'text-green-400 hover:bg-slate-700' : 'text-green-600 hover:bg-gray-50'}`}>
                                  Fill remaining days →
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                    );
                  })}
                  {/* Row quick-fill buttons */}
                  <td className={`px-1 py-1 border-b ${tdClass}`}>
                    <div className="flex gap-0.5 justify-center">
                      <button type="button" onClick={() => fillWeekdayPattern(row.user_id, '14:00-23:00')}
                        className={btnSmall} title="Mon-Fri 14:00-23:00 (2 PM - 11 PM IST), weekends OFF">
                        M-F
                      </button>
                      <button type="button" onClick={() => setCellsForRow(row.user_id, 'OFF')}
                        className={`${btnSmall} text-amber-600 dark:text-amber-400`} title="All days OFF">
                        OFF
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* Column quick-fill row */}
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td className={`px-2 py-1.5 border-t ${thClass}`} />
                <td className={`px-3 py-1.5 border-t ${thClass}`}>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-semibold">Column fill</span>
                </td>
                {dates.map((date) => (
                  <td key={date} className={`px-1 py-1.5 border-t ${thClass}`}>
                    <div className="flex flex-col gap-0.5 items-stretch">
                      {QUICK_SHIFTS.map((s) => (
                        <button key={`col-${date}-${s.value}`} type="button"
                          onClick={() => setCellsForColumn(date, s.value)}
                          className={`${btnSmall} text-[9px] w-full text-center`}
                          title={`Column to ${s.label}`}>
                          {s.short}
                        </button>
                      ))}
                      <button type="button" onClick={() => setCellsForColumn(date, 'OFF')}
                        className={`${btnSmall} text-[9px] w-full text-center text-amber-600 dark:text-amber-400`}>OFF</button>
                    </div>
                  </td>
                ))}
                <td className={`px-1 py-1.5 border-t ${thClass}`} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Custom time modal */}
      {showCustom && editingCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => { setShowCustom(false); setEditingCell(null); }}>
          <div className={`rounded-lg border shadow-lg p-4 min-w-[220px] ${isDark ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200'}`}
            onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium mb-3 text-gray-900 dark:text-white">Custom Shift Time</p>
            <div className="flex items-center gap-2 mb-3">
              <input type="time" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                className={`py-1.5 px-2 rounded border text-sm ${isDark ? 'border-slate-600 bg-slate-700 text-white' : 'border-gray-300 bg-white text-gray-900'}`} />
              <span className="text-gray-400">to</span>
              <input type="time" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                className={`py-1.5 px-2 rounded border text-sm ${isDark ? 'border-slate-600 bg-slate-700 text-white' : 'border-gray-300 bg-white text-gray-900'}`} />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowCustom(false); setEditingCell(null); }}
                className="px-3 py-1.5 rounded border border-gray-300 dark:border-slate-600 text-sm text-gray-600 dark:text-gray-300">
                Cancel
              </button>
              <button type="button" onClick={handleCustomApply}
                className="px-3 py-1.5 rounded text-white text-sm bg-brand hover:bg-brand-hover">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Action Bar ──────────────────────────────────────── */}
      {saveError && <p className="text-sm text-red-600 dark:text-red-400 font-medium">{saveError}</p>}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {realRows.length > 0 && (
            <button type="button" onClick={triggerSave} disabled={saving}
              className="px-5 py-2.5 rounded-lg text-white font-medium disabled:opacity-60 bg-brand hover:bg-brand-hover text-sm">
              {saving ? 'Saving...' : 'Save Schedule'}
            </button>
          )}
          {templates.length > 0 && onApplyTemplate && (
            <select value={applyingTemplateId}
              onChange={(e) => { const id = e.target.value; if (id) onApplyTemplate(id); }}
              className={`rounded-lg px-3 py-2 text-sm border ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'} min-w-[160px]`}>
              <option value="">Load saved schedule...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} {t.clientName ? `(${t.clientName})` : ''}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* ── Save Schedule Modal ──────────────────────────────── */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowSaveModal(false)}>
          <div className={`rounded-xl border shadow-xl p-6 w-full max-w-md mx-4 ${isDark ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200'}`}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Save Schedule</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Schedule name (optional — saves as reusable template)</label>
                <input type="text" value={saveName} onChange={(e) => setSaveName(e.target.value)}
                  placeholder="e.g. April Night Shift Pattern"
                  className={`w-full rounded-lg px-3 py-2 text-sm border ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`} />
              </div>

              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Apply this weekly pattern until</label>
                <input type="date" value={saveRepeatUntil} onChange={(e) => setSaveRepeatUntil(e.target.value)}
                  min={dates[0] || ''}
                  className={`w-full rounded-lg px-3 py-2 text-sm border ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`} />
                {dates[0] && saveRepeatUntil && (() => {
                  const startMs = new Date(dates[0] + 'T00:00:00').getTime();
                  const endMs = new Date(saveRepeatUntil + 'T00:00:00').getTime();
                  const weeks = Math.max(1, Math.ceil((endMs - startMs + 86400000) / (7 * 86400000)));
                  const totalAssignments = realRows.length * dates.length * weeks;
                  return (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      <strong>{weeks} week{weeks > 1 ? 's' : ''}</strong> — {totalAssignments} shift assignments for {realRows.length} employees
                    </p>
                  );
                })()}
              </div>
            </div>

            <div className="flex gap-3 mt-6 justify-end">
              <button type="button" onClick={() => setShowSaveModal(false)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-slate-700 hover:bg-slate-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                Cancel
              </button>
              <button type="button" onClick={confirmSave} disabled={saving}
                className="px-5 py-2 rounded-lg text-white text-sm font-medium bg-green-600 hover:bg-green-700 disabled:opacity-60">
                {saving ? 'Saving...' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default ScheduleBuildGridInner;
