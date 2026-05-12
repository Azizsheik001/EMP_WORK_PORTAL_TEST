import { useState } from 'react';
import RoleBadge from './RoleBadge';

// Convert IST HH:MM to CST (IST - 11:30)
function istToCst(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  let totalMin = h * 60 + m - 690; // IST is UTC+5:30, CST is UTC-6:00, diff = 11:30 = 690 min
  if (totalMin < 0) totalMin += 1440;
  const cH = Math.floor(totalMin / 60) % 24;
  const cM = totalMin % 60;
  return `${String(cH).padStart(2, '0')}:${String(cM).padStart(2, '0')}`;
}

function convertShiftDisplay(cell, showCst) {
  if (!cell || cell === 'OFF') return cell || 'OFF';
  if (!showCst) return cell;
  const m = cell.match(/^(\d{2}:\d{2})(?::\d{2})?-(\d{2}:\d{2})(?::\d{2})?$/);
  if (m) return `${istToCst(m[1])}-${istToCst(m[2])}`;
  return cell;
}

/**
 * Weekly schedule grid: employees (rows) x dates (columns). Cells show shift time, OFF, or L (leave).
 * Rows may have role for RoleBadge (M, TL, CEO).
 */
export default function ScheduleGridView({ dates = [], rows = [], isDark, scheduleInfo }) {
  const [showCst, setShowCst] = useState(false);

  const dayNames = dates.map((d) => {
    const day = new Date(d + 'T12:00:00');
    return day.toLocaleDateString('en-US', { weekday: 'short' });
  });

  const thClass = isDark ? 'bg-slate-700 text-slate-200 border-slate-600' : 'bg-gray-100 text-gray-800 border-gray-300';
  const tdClass = isDark ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white';
  const offClass = isDark ? 'bg-amber-900/30 text-amber-200' : 'bg-amber-100 text-amber-800';
  const leaveClass = isDark ? 'bg-indigo-900/30' : 'bg-indigo-50';

  return (
    <div className="space-y-3">
      {/* Schedule info bar + timezone toggle */}
      <div className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border ${isDark ? 'bg-slate-800/50 border-slate-700' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-center gap-3 text-sm">
          {scheduleInfo?.last_date && (
            <span className="text-gray-600 dark:text-gray-400">
              Schedule runs till <strong className="text-gray-900 dark:text-white">{new Date(scheduleInfo.last_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
              {scheduleInfo.employee_count > 0 && <> for <strong className="text-gray-900 dark:text-white">{scheduleInfo.employee_count}</strong> employees</>}
            </span>
          )}
          {!scheduleInfo?.last_date && rows.length > 0 && (
            <span className="text-gray-500 dark:text-gray-400">Showing schedule for selected date range</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-gray-500 dark:text-gray-400 mr-1">Timezone:</span>
          <button type="button" onClick={() => setShowCst(false)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${!showCst ? 'bg-brand text-white' : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}>
            IST
          </button>
          <button type="button" onClick={() => setShowCst(true)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${showCst ? 'bg-brand text-white' : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}>
            CST
          </button>
        </div>
      </div>

      {showCst && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Times shown in CST (Central Standard Time). All schedules are stored in IST.</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr>
              <th className={`px-3 py-2 border font-medium ${thClass}`}>Employee</th>
              {dates.map((d, i) => (
                <th key={d} className={`px-3 py-2 border font-medium ${thClass}`}>
                  {dayNames[i]} {d.slice(8)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={dates.length + 1} className="px-3 py-8 text-center text-gray-500 dark:text-gray-400">
                  No schedule for this date range. Use Upload or Build schedule.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.user_id}>
                <td className={`px-3 py-2 border font-medium ${tdClass}`}>
                  <span>{row.employee_name}</span>
                  <RoleBadge user={{ name: row.employee_name, role: row.role }} />
                </td>
                {dates.map((date) => {
                  const cell = row.shifts?.[date];
                  const hasLeave = row.leaves?.[date] === true;
                  const isOff = cell === 'OFF' || !cell;

                  if (hasLeave) {
                    return (
                      <td key={date} className={`px-3 py-2 border ${tdClass} ${leaveClass}`}>
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-500 text-white text-xs font-bold" title="Approved Leave">
                          L
                        </span>
                      </td>
                    );
                  }

                  return (
                    <td key={date} className={`px-3 py-2 border ${tdClass} ${isOff ? offClass : ''}`}>
                      {convertShiftDisplay(cell, showCst) || 'OFF'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
