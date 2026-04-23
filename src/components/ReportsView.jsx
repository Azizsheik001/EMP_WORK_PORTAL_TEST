import { useState, useCallback, useMemo } from 'react';
import { api } from '../api/client';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getMonthRange(year, month) {
  // month is 0-based
  const y = year || new Date().getFullYear();
  const m = month != null ? month : new Date().getMonth();
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

function getYearRange(year) {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

const STATUS_COLORS = {
  Present: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  Absent: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  Off: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  Leave: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
};

export default function ReportsView({ isDark, clients = [], showToast }) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const defaults = getMonthRange(currentYear, currentMonth);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [clientId, setClientId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth); // 0-based, -1 = full year
  const [rangeMode, setRangeMode] = useState('month'); // 'month', 'year', 'custom'

  const years = useMemo(() => {
    const maxYear = Math.max(currentYear, 2026);
    const arr = [];
    for (let y = maxYear; y >= maxYear - 3; y--) arr.push(y);
    return arr;
  }, [currentYear]);

  const handleMonthSelect = (monthIdx) => {
    setSelectedMonth(monthIdx);
    setRangeMode('month');
    const range = getMonthRange(selectedYear, monthIdx);
    setFrom(range.from);
    setTo(range.to);
  };

  const handleYearSelect = (yr) => {
    setSelectedYear(yr);
    if (rangeMode === 'year') {
      const range = getYearRange(yr);
      setFrom(range.from);
      setTo(range.to);
    } else if (rangeMode === 'month') {
      const range = getMonthRange(yr, selectedMonth);
      setFrom(range.from);
      setTo(range.to);
    }
  };

  const handleFullYear = () => {
    setRangeMode('year');
    setSelectedMonth(-1);
    const range = getYearRange(selectedYear);
    setFrom(range.from);
    setTo(range.to);
  };

  const fetchReport = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    try {
      const params = { from, to };
      if (clientId) params.client_id = clientId;
      const data = await api.reports.hr(params);
      setRows(data.rows || []);
      setFetched(true);
    } catch (err) {
      if (showToast) showToast(err.message || 'Failed to load report', 'error');
      setRows([]);
      setFetched(true);
    } finally {
      setLoading(false);
    }
  }, [from, to, clientId, showToast]);

  const downloadCSV = useCallback(() => {
    if (!rows.length) return;
    const headers = ['Employee ID', 'Employee Name', 'Date', 'Shift Start', 'Shift End', 'Login Time', 'Logout Time', 'Status'];
    const csvRows = [headers.join(',')];
    for (const r of rows) {
      csvRows.push([
        `"${(r.employee_no || '').replace(/"/g, '""')}"`,
        `"${(r.employee_name || '').replace(/"/g, '""')}"`,
        r.date,
        r.shift_start,
        r.shift_end,
        r.login_time,
        r.logout_time,
        r.status,
      ].join(','));
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `HR_Report_${from}_to_${to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (showToast) showToast('CSV downloaded');
  }, [rows, from, to, showToast]);

  const inputClass = isDark
    ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400 focus:border-brand focus:ring-brand'
    : 'bg-white border-gray-300 text-gray-900 focus:border-brand focus:ring-brand';
  const thClass = isDark ? 'bg-slate-700 text-slate-200 border-slate-600' : 'bg-gray-100 text-gray-800 border-gray-300';
  const tdClass = isDark ? 'border-slate-600' : 'border-gray-200';
  const cardClass = isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200';

  // Summary counts
  const presentCount = rows.filter((r) => r.status === 'Present').length;
  const absentCount = rows.filter((r) => r.status === 'Absent').length;
  const leaveCount = rows.filter((r) => r.status === 'Leave').length;
  const offCount = rows.filter((r) => r.status === 'Off').length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">HR Reports</h2>
          <p className={`text-sm mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Generate monthly attendance and shift reports
          </p>
        </div>
      </div>

      {/* Quick Presets: Year + Month */}
      <div className={`rounded-xl border p-4 ${cardClass}`}>
        {/* Year selector */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Year</span>
          {years.map(yr => (
            <button key={yr} type="button" onClick={() => handleYearSelect(yr)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                selectedYear === yr
                  ? 'bg-brand text-white'
                  : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>{yr}</button>
          ))}
          <button type="button" onClick={handleFullYear}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              rangeMode === 'year'
                ? 'bg-amber-500 text-white'
                : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>Full Year</button>
        </div>
        {/* Month selector */}
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className={`text-xs font-semibold uppercase tracking-wider mr-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Month</span>
          {MONTH_NAMES.map((m, i) => (
            <button key={i} type="button" onClick={() => handleMonthSelect(i)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                rangeMode === 'month' && selectedMonth === i
                  ? 'bg-brand text-white'
                  : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>{m}</button>
          ))}
        </div>
        {/* Custom date range + actions */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setRangeMode('custom'); }}
              className={`rounded-lg border px-3 py-2 text-sm ${inputClass}`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); setRangeMode('custom'); }}
              className={`rounded-lg border px-3 py-2 text-sm ${inputClass}`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Client</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={`rounded-lg border px-3 py-2 text-sm min-w-[160px] ${inputClass}`}
            >
              <option value="">All Clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={fetchReport}
            disabled={loading || !from || !to}
            className="px-5 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Loading...' : 'Generate Report'}
          </button>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={downloadCSV}
              className={`px-5 py-2 rounded-lg text-sm font-medium border transition-colors ${
                isDark
                  ? 'border-slate-600 text-gray-200 hover:bg-slate-700'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download CSV
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {fetched && rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Present', count: presentCount, color: 'text-green-600 dark:text-green-400', bg: isDark ? 'bg-green-900/20' : 'bg-green-50' },
            { label: 'Absent', count: absentCount, color: 'text-red-600 dark:text-red-400', bg: isDark ? 'bg-red-900/20' : 'bg-red-50' },
            { label: 'Leave', count: leaveCount, color: 'text-indigo-600 dark:text-indigo-400', bg: isDark ? 'bg-indigo-900/20' : 'bg-indigo-50' },
            { label: 'Off', count: offCount, color: 'text-amber-600 dark:text-amber-400', bg: isDark ? 'bg-amber-900/20' : 'bg-amber-50' },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border p-4 ${cardClass} ${s.bg}`}>
              <div className={`text-2xl font-bold ${s.color}`}>{s.count}</div>
              <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{s.label} entries</div>
            </div>
          ))}
        </div>
      )}

      {/* Data table */}
      {fetched && (
        <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
          {rows.length === 0 ? (
            <div className={`p-10 text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="font-medium">No data found</p>
              <p className="text-sm mt-1">Try adjusting the date range or client filter.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-full text-sm">
                <thead>
                  <tr>
                    {['Employee ID', 'Employee Name', 'Date', 'Shift Start', 'Shift End', 'Login Time', 'Logout Time', 'Status'].map((h) => (
                      <th key={h} className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider border-b ${thClass}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`${i % 2 === 0 ? '' : isDark ? 'bg-slate-800/50' : 'bg-gray-50/50'} hover:${isDark ? 'bg-slate-700/50' : 'bg-blue-50/30'} transition-colors`}>
                      <td className={`px-4 py-2.5 border-b ${tdClass} font-mono text-xs`}>{r.employee_no || '-'}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass} font-medium`}>{r.employee_name}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass}`}>{r.date}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass} font-mono`}>{r.shift_start || '-'}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass} font-mono`}>{r.shift_end || '-'}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass} font-mono`}>{r.login_time || '-'}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass} font-mono`}>{r.logout_time || '-'}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass}`}>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[r.status] || ''}`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && (
            <div className={`px-4 py-3 text-xs border-t ${isDark ? 'border-slate-700 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
              Showing {rows.length} record{rows.length !== 1 ? 's' : ''} &middot; Times displayed in 24-hour IST format
            </div>
          )}
        </div>
      )}
    </div>
  );
}
