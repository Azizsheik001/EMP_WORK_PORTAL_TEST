import { useState, useCallback, useMemo, useEffect } from 'react';
import { api } from '../api/client';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
import { getStoredUser } from '../api/client';
import ManageShiftCodesModal from './ManageShiftCodesModal';

function getShiftCode(start, end, shiftCodeMap) {
  if (!start || !end || start === 'OFF' || end === 'OFF' || start === '-' || end === '-') return null;
  const key = `${start.slice(0, 5)}-${end.slice(0, 5)}`;
  return shiftCodeMap[key] || key;
}

function formatName(name) {
  if (!name) return '';
  return String(name).toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function getMonthRange(year, month) {
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

function calculateWorkingHours(loginTime, logoutTime) {
  if (!loginTime || !logoutTime || loginTime === '-' || logoutTime === '-') return '-';
  const [loginH, loginM] = loginTime.split(':').map(Number);
  const [logoutH, logoutM] = logoutTime.split(':').map(Number);
  let loginTotalMins = loginH * 60 + loginM;
  let logoutTotalMins = logoutH * 60 + logoutM;
  if (logoutTotalMins < loginTotalMins) logoutTotalMins += 24 * 60;
  const rawDiffMins = logoutTotalMins - loginTotalMins;
  const diffMins = Math.max(0, rawDiffMins - 60); // Deduct 1 hour break
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function calculateRawWorkingHours(loginTime, logoutTime) {
  if (!loginTime || !logoutTime || loginTime === '-' || logoutTime === '-') return '-';
  const [loginH, loginM] = loginTime.split(':').map(Number);
  const [logoutH, logoutM] = logoutTime.split(':').map(Number);
  let loginTotalMins = loginH * 60 + loginM;
  let logoutTotalMins = logoutH * 60 + logoutM;
  if (logoutTotalMins < loginTotalMins) logoutTotalMins += 24 * 60;
  const diffMins = logoutTotalMins - loginTotalMins;
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

const STATUS_COLORS = {
  Present: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  Absent: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  Off: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  Leave: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  'Half Day Leave': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  Holiday: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
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
  const [currentDateIndex, setCurrentDateIndex] = useState(0);

  const uniqueDates = useMemo(() => Array.from(new Set(rows.map(r => r.date))).sort(), [rows]);

  useEffect(() => { setCurrentDateIndex(0); }, [uniqueDates]);

  const currentRows = useMemo(() => {
    if (uniqueDates.length === 0) return [];
    const date = uniqueDates[currentDateIndex];
    return rows.filter(r => r.date === date);
  }, [rows, uniqueDates, currentDateIndex]);

  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [rangeMode, setRangeMode] = useState('month'); 
  
  const [shiftCodeMap, setShiftCodeMap] = useState({});
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const currentUser = getStoredUser();
  const canManageShiftCodes = currentUser && (currentUser.type === 'admin' || currentUser.type === 'manager');

  const fetchShiftCodes = useCallback(async () => {
    try {
      const data = await api.shiftCodes.list();
      const map = {};
      data.forEach(c => { map[`${c.start_time.slice(0, 5)}-${c.end_time.slice(0, 5)}`] = c.shift_code; });
      setShiftCodeMap(map);
    } catch (e) { console.error('Failed to load shift codes', e); }
  }, []);

  useEffect(() => { fetchShiftCodes(); }, [fetchShiftCodes]);

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

  const downloadExcel = useCallback(async () => {
    if (!rows.length) return;

    const toLocalDateStr = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const todayNow = new Date();
    const todayStr = toLocalDateStr(todayNow);

    const fromD = new Date(from + 'T00:00:00');
    const toD = new Date(to + 'T00:00:00');
    const dateStrs = [];
    const dateLabels = [];
    const year = fromD.getFullYear();
    const monthName = fromD.toLocaleString('en-US', { month: 'long' });
    for (let d = new Date(fromD); d <= toD; d.setDate(d.getDate() + 1)) {
      const dStr = toLocalDateStr(d);
      dateStrs.push(dStr);
      dateLabels.push(d.getDate());
    }

    const empMap = {};
    for (const r of rows) {
      const key = r.employee_no || r.employee_name;
      if (!empMap[key]) {
        empMap[key] = { name: formatName(r.employee_name) || '', no: r.employee_no || '', data: {} };
      }
      
      const incoming = r.raw_status || r.status;
      const current = empMap[key].data[r.date];
      
      const isBetter = !current || (incoming?.hasClockIn) || (incoming?.leave) || (typeof incoming === 'string' && (incoming === 'Present' || incoming === 'Leave'));
      
      if (isBetter) {
        empMap[key].data[r.date] = { raw: incoming, shift_start: r.shift_start, shift_end: r.shift_end, login_time: r.login_time, logout_time: r.logout_time };
      }
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('HR Report');

    const headerRow = worksheet.addRow([
      'Employee Name', 'Employee No', 'Year', 'Month',
      ...dateLabels,
      'Present', 'Leave', 'Holiday', 'Absent', 'Off Day', 'Status Error', 'Total', 'Working Hrs'
    ]);
    headerRow.font = { bold: true };

    for (const emp of Object.values(empMap)) {
      let p = 0, l = 0, h = 0, a = 0, off = 0, lop = 0, se = 0;
      let totalWorkingMinutes = 0;
      
      const rowValues = [emp.name, emp.no, year, monthName];
      const cellMeta = [];
      
      for (const dStr of dateStrs) {
        if (dStr > todayStr) { se += 1; rowValues.push('-'); cellMeta.push(null); continue; }

        const dataObj = emp.data[dStr];
        if (!dataObj) { se += 1; rowValues.push(''); cellMeta.push(null); continue; }

        const raw = dataObj.raw;
        
        if (dataObj.login_time && dataObj.logout_time && dataObj.login_time !== '-' && dataObj.logout_time !== '-') {
          const [lh, lm] = dataObj.login_time.split(':').map(Number);
          const [outH, outM] = dataObj.logout_time.split(':').map(Number);
          let inTotal = lh * 60 + lm;
          let outTotal = outH * 60 + outM;
          if (outTotal < inTotal) outTotal += 24 * 60;
          totalWorkingMinutes += (outTotal - inTotal);
        }

        let shiftCode = getShiftCode(dataObj.shift_start, dataObj.shift_end, shiftCodeMap);

        let cellValue = '';
        let cellColor = null;
        let cellNote = '';

        if (typeof raw === 'object') {
          if (raw.holidayType === 'national') { 
            h += 1; cellValue = 'NH'; cellColor = 'FF9966CC'; cellNote = 'National Holiday';
          } else if (raw.leave && raw.leave.isHalf) {
            l += 0.5;
            if (raw.hasClockIn) p += 0.5; else a += 0.5;
            cellValue = 'HL';
            let halfLeaveLabel = 'Half Day Leave';
            if (raw.leave.type === 'casual') { halfLeaveLabel = 'Half Day Leave (Casual Leave)'; cellColor = 'FF6EB3D6'; }
            else if (raw.leave.type === 'sick') { halfLeaveLabel = 'Half Day Leave (Sick Leave)'; cellColor = 'FF6EB3D6'; }
            else if (raw.leave.type === 'loss_of_pay') { halfLeaveLabel = 'Half Day Leave (Loss Of Pay)'; lop += 0.5; cellColor = 'FF9E9E9E'; }
            else if (raw.leave.type === 'comp_off' || raw.leave.type === 'nhc') { halfLeaveLabel = 'Half Day Leave (NHC)'; cellColor = 'FF9966CC'; }
            else cellColor = 'FF6EB3D6';
            cellNote = halfLeaveLabel;
          } else if (raw.leave) {
            l += 1;
            if (raw.leave.type === 'casual' || raw.leave.type === 'sick') { cellValue = raw.leave.type === 'sick' ? 'SL' : 'CL'; cellColor = 'FF6EB3D6'; cellNote = raw.leave.type === 'sick' ? 'Sick Leave' : 'Casual Leave'; }
            else if (raw.leave.type === 'loss_of_pay') { lop += 1; cellValue = 'LOP'; cellColor = 'FF9E9E9E'; cellNote = 'Loss Of Pay'; }
            else if (raw.leave.type === 'comp_off' || raw.leave.type === 'nhc') { cellValue = 'NHC'; cellColor = 'FF9966CC'; cellNote = 'National Holiday Compository (NHC)'; }
            else { cellValue = 'CL'; cellColor = 'FF6EB3D6'; cellNote = 'Casual Leave'; }
          } else if (raw.hasClockIn) { 
            p += 1; cellValue = shiftCode || 'P'; cellColor = 'FF5BA85C';
            const loginStr = dataObj.login_time && dataObj.login_time !== '-' ? dataObj.login_time : null;
            const logoutStr = dataObj.logout_time && dataObj.logout_time !== '-' ? dataObj.logout_time : null;
            const rawHrs = loginStr && logoutStr ? calculateRawWorkingHours(loginStr, logoutStr) : null;
            const shiftStr = dataObj.shift_start && dataObj.shift_start !== 'OFF' ? `\nS: ${dataObj.shift_start}-${dataObj.shift_end}` : '';
            cellNote = loginStr && logoutStr ? `Present${shiftStr}\nIn: ${loginStr} Out: ${logoutStr}\nHrs: ${rawHrs}` : loginStr ? `Present${shiftStr}\nIn: ${loginStr}` : `Present${shiftStr}`;
          } else if (raw.isOff) { 
            off += 1; cellValue = 'OFF'; cellColor = 'FFCFB900'; cellNote = 'Week Off';
          } else {
            a += 1; cellValue = 'A'; cellColor = 'FFD9534F'; cellNote = 'Absent';
          }
        } else {
          const loginStr = dataObj?.login_time && dataObj.login_time !== '-' ? dataObj.login_time : null;
          const logoutStr = dataObj?.logout_time && dataObj.logout_time !== '-' ? dataObj.logout_time : null;
          const rawHrs = loginStr && logoutStr ? calculateRawWorkingHours(loginStr, logoutStr) : null;
          const shiftStr = dataObj?.shift_start && dataObj.shift_start !== 'OFF' ? `\nS: ${dataObj.shift_start}-${dataObj.shift_end}` : '';
          if (raw === 'Present') { p += 1; cellValue = shiftCode || 'P'; cellColor = 'FF5BA85C'; cellNote = loginStr && logoutStr ? `Present${shiftStr}\nIn: ${loginStr} Out: ${logoutStr}\nHrs: ${rawHrs}` : loginStr ? `Present${shiftStr}\nIn: ${loginStr}` : `Present${shiftStr}`; }
          else if (raw === 'Absent') { a += 1; cellValue = 'A'; cellColor = 'FFD9534F'; cellNote = 'Absent'; }
          else if (raw === 'Off') { off += 1; cellValue = 'OFF'; cellColor = 'FFCFB900'; cellNote = 'Week Off'; }
          else if (raw === 'Leave') { l += 1; cellValue = 'CL'; cellColor = 'FF6EB3D6'; cellNote = 'Casual Leave'; }
          else { se += 1; cellValue = ''; cellNote = ''; }
        }

        rowValues.push(cellValue);
        cellMeta.push({ color: cellColor, note: cellNote });
      }

      const total = p + l + h + a + off + se;
      const totalHours = Math.floor(totalWorkingMinutes / 60);
      const totalMins = totalWorkingMinutes % 60;
      const formattedWorkingHrs = `${String(totalHours).padStart(2, '0')}:${String(totalMins).padStart(2, '0')}`;
      
      rowValues.push(p, l, h, a, off, se, total, formattedWorkingHrs);
      
      const addedRow = worksheet.addRow(rowValues);
      
      cellMeta.forEach((meta, index) => {
        if (meta) {
          const cell = addedRow.getCell(5 + index);
          if (meta.color) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: meta.color } };
            if (['FFD9534F', 'FF9966CC', 'FF5BA85C', 'FF9E9E9E'].includes(meta.color)) {
               cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
            } else {
               cell.font = { color: { argb: 'FF1A1A1A' }, bold: true }; 
            }
          }
          if (meta.note) { cell.note = { texts: [{ font: { size: 9 }, text: meta.note }] }; }
        }
      });
    }

    worksheet.columns.forEach((column, i) => {
      if (i === 0) column.width = 25;
      else if (i === 1) column.width = 15;
      else column.width = 11;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `HR_Report_${from}_to_${to}.xlsx`);

    if (showToast) showToast('Excel downloaded successfully');
  }, [rows, from, to, showToast]);

  const inputClass = isDark ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400 focus:border-brand focus:ring-brand' : 'bg-white border-gray-300 text-gray-900 focus:border-brand focus:ring-brand';
  const thClass = isDark ? 'bg-slate-700 text-slate-200 border-slate-600' : 'bg-gray-100 text-gray-800 border-gray-300';
  const tdClass = isDark ? 'border-slate-600' : 'border-gray-200';
  const cardClass = isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200';

  const presentCount = rows.filter((r) => r.status === 'Present').length;
  const absentCount = rows.filter((r) => r.status === 'Absent').length;
  const leaveCount = rows.filter((r) => r.status === 'Leave').length;
  const offCount = rows.filter((r) => r.status === 'Off').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">HR Reports</h2>
          <p className={`text-sm mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Generate monthly attendance and shift reports</p>
        </div>
        {canManageShiftCodes && (
          <button onClick={() => setIsManageModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium transition-colors border border-slate-200 dark:border-slate-700">
            Manage Shift Codes
          </button>
        )}
      </div>

      <div className={`rounded-xl border p-4 ${cardClass}`}>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Year</span>
          {years.map(yr => (
            <button key={yr} type="button" onClick={() => handleYearSelect(yr)} className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${selectedYear === yr ? 'bg-brand text-white' : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{yr}</button>
          ))}
          <button type="button" onClick={handleFullYear} className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${rangeMode === 'year' ? 'bg-amber-500 text-white' : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Full Year</button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className={`text-xs font-semibold uppercase tracking-wider mr-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Month</span>
          {MONTH_NAMES.map((m, i) => (
            <button key={i} type="button" onClick={() => handleMonthSelect(i)} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${rangeMode === 'month' && selectedMonth === i ? 'bg-brand text-white' : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{m}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>From</label>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setRangeMode('custom'); }} className={`rounded-lg border px-3 py-2 text-sm ${inputClass}`} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>To</label>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setRangeMode('custom'); }} className={`rounded-lg border px-3 py-2 text-sm ${inputClass}`} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Client</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={`rounded-lg border px-3 py-2 text-sm min-w-[160px] ${inputClass}`}>
              <option value="">All Clients</option>
              {clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </div>
          <button type="button" onClick={fetchReport} disabled={loading || !from || !to} className="px-5 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {loading ? 'Loading...' : 'Generate Report'}
          </button>
          {rows.length > 0 && (
            <button type="button" onClick={downloadExcel} className={`px-5 py-2 rounded-lg text-sm font-medium border transition-colors ${isDark ? 'border-slate-600 text-gray-200 hover:bg-slate-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
              Download Excel
            </button>
          )}
        </div>
      </div>

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

      {fetched && (
        <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
          {rows.length === 0 ? (
            <div className={`p-10 text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              <p className="font-medium">No data found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className={`px-4 py-3 border-b flex flex-wrap gap-3 items-center justify-between ${isDark ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-gray-50/50'}`}>
                <button onClick={() => setCurrentDateIndex(prev => Math.max(0, prev - 1))} disabled={currentDateIndex === 0} className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors border ${currentDateIndex === 0 ? (isDark ? 'border-slate-600 text-slate-500 cursor-not-allowed' : 'border-gray-200 text-gray-400 cursor-not-allowed') : (isDark ? 'border-slate-600 hover:bg-slate-700 text-slate-200' : 'border-gray-300 hover:bg-gray-100 text-gray-700')}`}>&larr; Previous Day</button>
                <div className={`text-sm font-semibold px-4 py-1.5 rounded-lg ${isDark ? 'bg-slate-700 text-white' : 'bg-white shadow-sm border border-gray-200 text-gray-800'}`}>
                  {uniqueDates[currentDateIndex]} <span className="opacity-60 ml-2 font-normal text-xs">({currentDateIndex + 1} of {uniqueDates.length})</span>
                </div>
                <button onClick={() => setCurrentDateIndex(prev => Math.min(uniqueDates.length - 1, prev + 1))} disabled={currentDateIndex === uniqueDates.length - 1} className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors border ${currentDateIndex === uniqueDates.length - 1 ? (isDark ? 'border-slate-600 text-slate-500 cursor-not-allowed' : 'border-gray-200 text-gray-400 cursor-not-allowed') : (isDark ? 'border-slate-600 hover:bg-slate-700 text-slate-200' : 'border-gray-300 hover:bg-gray-100 text-gray-700')}`}>Next Day &rarr;</button>
              </div>
              <table className="w-full min-w-full text-sm">
                <thead>
                  <tr>
                    {['Employee ID', 'Employee Name', 'Date', 'Shift Start', 'Shift End', 'Login Time', 'Logout Time', 'Working Hrs (−1h break)', 'Status'].map((h) => (
                      <th key={h} className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider border-b ${thClass}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {currentRows.map((r, i) => (
                    <tr key={i} className={`${i % 2 === 0 ? '' : isDark ? 'bg-slate-800/50' : 'bg-gray-50/50'} hover:${isDark ? 'bg-slate-700/50' : 'bg-blue-50/30'} transition-colors`}>
                      <td className={`px-4 py-2.5 border-b ${tdClass} font-mono text-xs`}>{r.employee_no || '-'}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass} font-medium`}>{formatName(r.employee_name)}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass}`}>{r.date}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass} font-mono`}>{r.shift_start || '-'}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass} font-mono`}>{r.shift_end || '-'}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass} font-mono`}>{r.login_time || '-'}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass} font-mono`}>{r.logout_time || '-'}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass} font-mono`}>{calculateWorkingHours(r.login_time, r.logout_time)}</td>
                      <td className={`px-4 py-2.5 border-b ${tdClass}`}>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[r.status] || ''}`}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <ManageShiftCodesModal isOpen={isManageModalOpen} onClose={() => setIsManageModalOpen(false)} isDark={isDark} showToast={showToast} onCodesUpdated={fetchShiftCodes} />
    </div>
  );
}
