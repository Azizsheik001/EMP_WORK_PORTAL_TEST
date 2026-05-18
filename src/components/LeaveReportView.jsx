import { useState, useEffect, useMemo, useCallback } from 'react';
import { api, hasApi } from '../api/client';

function leaveTypeLabel(type) {
  const map = { casual: 'CL', sick: 'SL', comp: 'Comp', loss_of_pay: 'LOP' };
  return map[type] || type || '--';
}

// Format a leave number: show integers without decimals, fractions with up to 1 dp
function fmtLeave(v) {
  if (v == null) return '0';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function LeaveReportView({ isDark, currentUser }) {
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(0); // 0 = all months, 1-12 = specific month
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('employee_name');
  const [sortDir, setSortDir] = useState('asc');
  const [adjustModal, setAdjustModal] = useState(null);
  const [adjusting, setAdjusting] = useState(false);

  const isHRorFinance = currentUser?.department_name === 'HR' || currentUser?.department_name === 'Human Resources' || currentUser?.department_name === 'Finance';
  const isAdmin = currentUser?.role === 'admin';
  const isManager = currentUser?.role === 'manager';
  const canAdjust = isAdmin || isHRorFinance || isManager;

  const card = isDark ? 'bg-slate-800/80 border-slate-700 text-white' : 'bg-white border-gray-200 text-gray-900';
  const subtleText = isDark ? 'text-gray-400' : 'text-gray-500';
  const borderColor = isDark ? 'border-slate-700' : 'border-gray-100';
  const inputCls = `rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${
    isDark ? 'bg-slate-700 border-slate-600 text-white focus:border-brand' : 'bg-white border-gray-300 text-gray-900 focus:border-brand'
  }`;

  const fetchBalances = useCallback(async () => {
    if (!hasApi()) return;
    setLoading(true);
    try {
      const data = await api.leaveRequests.balanceAll(year, month || undefined);
      setBalances(data.balances || []);
    } catch {
      setBalances([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const filteredBalances = useMemo(() => {
    let list = balances;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(b =>
        (b.employee_name || '').toLowerCase().includes(q) ||
        (b.department_name || '').toLowerCase().includes(q) ||
        (b.designation || '').toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      let va, vb;
      if (sortField === 'employee_name') { va = a.employee_name || ''; vb = b.employee_name || ''; }
      else if (sortField === 'cl_used') { va = a.casual?.used || 0; vb = b.casual?.used || 0; }
      else if (sortField === 'cl_rem') { va = a.casual?.remaining || 0; vb = b.casual?.remaining || 0; }
      else if (sortField === 'sl_used') { va = a.sick?.used || 0; vb = b.sick?.used || 0; }
      else if (sortField === 'sl_rem') { va = a.sick?.remaining || 0; vb = b.sick?.remaining || 0; }
      else if (sortField === 'comp') { va = a.comp?.used || 0; vb = b.comp?.used || 0; }
      else if (sortField === 'lop') { va = a.loss_of_pay?.used || 0; vb = b.loss_of_pay?.used || 0; }
      else if (sortField === 'total') { va = a.total_used || 0; vb = b.total_used || 0; }
      else { va = a.employee_name || ''; vb = b.employee_name || ''; }
      if (typeof va === 'string') {
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return list;
  }, [balances, searchQuery, sortField, sortDir]);

  const totals = useMemo(() => {
    const t = { clUsed: 0, clRem: 0, slUsed: 0, slRem: 0, compUsed: 0, compAvail: 0, lop: 0, nhc: 0, totalUsed: 0, totalRem: 0 };
    filteredBalances.forEach(b => {
      t.clUsed += parseFloat(b.casual?.used || 0);
      t.clRem += parseFloat(b.casual?.remaining || 0);
      t.slUsed += parseFloat(b.sick?.used || 0);
      t.slRem += parseFloat(b.sick?.remaining || 0);
      t.compUsed += parseFloat(b.comp?.used || 0);
      t.compAvail += parseFloat(b.comp?.available || 0);
      t.lop += parseFloat(b.loss_of_pay?.used || 0);
      t.nhc += parseFloat(b.nhco?.remaining || b.stored_balances?.national_holiday_comp_off || 0);
      t.totalUsed += parseFloat(b.total_used || 0);
      t.totalRem += parseFloat(b.total_remaining || 0);
    });
    return t;
  }, [filteredBalances]);

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className={`ml-0.5 ${subtleText}`}>{'↕'}</span>;
    return <span className="ml-0.5 text-brand">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const years = [];
  const currentYear = new Date().getFullYear();
  const maxYear = Math.max(currentYear, 2026);
  for (let y = maxYear; y >= maxYear - 3; y--) years.push(y);

  const handleDownloadCSV = () => {
    if (filteredBalances.length === 0) return;
    const header = ['Employee', 'Designation', 'Department', 'CL Used', 'CL Allocated', 'CL Remaining', 'SL Used', 'SL Allocated', 'SL Remaining', 'Comp Used', 'Comp Available', 'NHC Remaining', 'LOP', 'Total Used', 'Total Remaining'];
    const rows = filteredBalances.map(b => [
      b.employee_name || '',
      b.designation || '',
      b.department_name || '',
      b.casual?.used || 0,
      b.casual?.allocated || 0,
      b.casual?.remaining || 0,
      b.sick?.used || 0,
      b.sick?.allocated || 0,
      b.sick?.remaining || 0,
      b.comp?.used || 0,
      b.comp?.available || 0,
      b.nhco?.remaining || b.stored_balances?.national_holiday_comp_off || 0,
      b.loss_of_pay?.used || 0,
      b.total_used || 0,
      b.total_remaining || 0,
    ]);
    rows.push(['TOTAL (' + filteredBalances.length + ' employees)', '', '', totals.clUsed, '', totals.clRem, totals.slUsed, '', totals.slRem, totals.compUsed, totals.compAvail, totals.nhc, totals.lop, totals.totalUsed, totals.totalRem]);

    const csvContent = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Leave_Report_${year}${month ? '_' + MONTH_NAMES[month] : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAdjustSave = async (e) => {
    e.preventDefault();
    setAdjusting(true);
    try {
      await api.leaveRequests.adjustBalance(adjustModal.employee_id, {
        year,
        casual: adjustModal.cl_left !== '' ? parseFloat(adjustModal.cl_left) : null,
        casual_used: adjustModal.cl_used !== '' ? parseFloat(adjustModal.cl_used) : null,
        sick: adjustModal.sl_left !== '' ? parseFloat(adjustModal.sl_left) : null,
        sick_used: adjustModal.sl_used !== '' ? parseFloat(adjustModal.sl_used) : null,
        comp: adjustModal.comp !== '' ? parseFloat(adjustModal.comp) : null,
        nhco: adjustModal.nhco !== '' ? parseFloat(adjustModal.nhco) : null,
        lop: adjustModal.lop !== '' ? parseFloat(adjustModal.lop) : null,
      });
      setAdjustModal(null);
      fetchBalances();
    } catch (err) {
      alert(err.message || 'Failed to adjust balance');
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Leave Report</h1>
          <p className={`text-sm mt-0.5 ${subtleText}`}>
            Employee leave balance breakdown{month ? ` for ${MONTH_NAMES[month]} ${year}` : ` for ${year}`} - CL (1/mo), SL (1/qtr), Comp, LOP
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} className={inputCls}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10))} className={inputCls}>
            <option value={0}>All Months</option>
            {MONTH_NAMES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <input type="text" placeholder="Search employee..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className={`${inputCls} min-w-[180px]`} />
          <button type="button" onClick={handleDownloadCSV} disabled={filteredBalances.length === 0} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${isDark ? 'bg-brand text-white hover:bg-brand-hover' : 'bg-brand text-white hover:bg-brand-hover'}`}>
            Download CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className={`rounded-xl border p-8 text-center ${card}`}><p className={`text-sm ${subtleText}`}>Loading leave balances...</p></div>
      ) : filteredBalances.length === 0 ? (
        <div className={`rounded-xl border p-10 text-center ${card}`}><p className={`text-sm font-medium ${subtleText}`}>No employees found</p></div>
      ) : (
        <div className={`rounded-xl border overflow-hidden ${card}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-full text-sm">
              <thead>
                <tr className={isDark ? 'bg-slate-700/50' : 'bg-gray-50'}>
                  <th className={`text-left px-4 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('employee_name')}>Employee <SortIcon field="employee_name" /></th>
                  <th className={`text-left px-4 py-3 text-xs font-medium ${subtleText}`}>Dept</th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('cl_used')}>CL Used <SortIcon field="cl_used" /></th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('cl_rem')}>CL Left <SortIcon field="cl_rem" /></th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('sl_used')}>SL Used <SortIcon field="sl_used" /></th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('sl_rem')}>SL Left <SortIcon field="sl_rem" /></th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('comp')}>Comp <SortIcon field="comp" /></th>
                  <th className={`text-center px-3 py-3 text-xs font-medium ${subtleText}`}>NHC</th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('lop')}>LOP <SortIcon field="lop" /></th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('total')}>Total Used <SortIcon field="total" /></th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('total_rem')}>Total Rem <SortIcon field="total_rem" /></th>
                  {canAdjust && <th className={`text-center px-3 py-3 text-xs font-medium ${subtleText}`}>Action</th>}
                </tr>
              </thead>
              <tbody>
                {filteredBalances.map((b) => (
                  <tr key={b.employee_id} className={`border-t ${borderColor} ${isDark ? 'hover:bg-slate-700/40' : 'hover:bg-gray-50/80'} transition-colors`}>
                    <td className="px-4 py-3 whitespace-nowrap"><div><p className="font-medium">{b.employee_name}</p>{b.designation && <p className={`text-[11px] ${subtleText}`}>{b.designation}</p>}</div></td>
                    <td className={`px-4 py-3 whitespace-nowrap text-xs ${subtleText}`}>{b.department_name || '--'}</td>
                    <td className="px-3 py-3 text-center"><span className={`font-semibold ${b.casual?.used > 0 ? 'text-amber-500' : ''}`}>{fmtLeave(b.casual?.used)}</span></td>
                    <td className="px-3 py-3 text-center"><span className={`font-semibold ${(b.casual?.remaining ?? 0) <= 2 ? 'text-red-500' : 'text-green-500'}`}>{fmtLeave(b.casual?.remaining)}</span></td>
                    <td className="px-3 py-3 text-center"><span className={`font-semibold ${b.sick?.used > 0 ? 'text-amber-500' : ''}`}>{fmtLeave(b.sick?.used)}</span></td>
                    <td className="px-3 py-3 text-center"><span className={`font-semibold ${(b.sick?.remaining ?? 0) <= 1 ? 'text-red-500' : 'text-green-500'}`}>{fmtLeave(b.sick?.remaining)}</span></td>
                    <td className="px-3 py-3 text-center">
                      {b.comp?.used > 0 && <span className="font-semibold text-blue-500">{fmtLeave(b.comp.used)} used</span>}
                      {b.comp?.available > 0 && <span className={`${b.comp?.used > 0 ? ' / ' : ''}font-semibold text-green-500`}>{fmtLeave(b.comp.available)} avail</span>}
                      {(!b.comp?.used && !b.comp?.available) && <span className={subtleText}>0</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`font-semibold ${(b.nhco?.remaining ?? b.stored_balances?.national_holiday_comp_off ?? 0) > 0 ? 'text-purple-500' : subtleText}`}>
                        {fmtLeave(b.nhco?.remaining ?? b.stored_balances?.national_holiday_comp_off ?? 0)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center"><span className={`font-semibold ${b.loss_of_pay?.used > 0 ? 'text-red-500' : ''}`}>{fmtLeave(b.loss_of_pay?.used)}</span></td>
                    <td className="px-3 py-3 text-center font-bold text-gray-700 dark:text-gray-300">{fmtLeave(b.total_used)}</td>
                    <td className="px-3 py-3 text-center font-bold text-green-600 dark:text-green-400">{fmtLeave(b.total_remaining)}</td>
                    {canAdjust && (
                      <td className="px-3 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => setAdjustModal({
                            employee_id: b.employee_id,
                            name: b.employee_name,
                            cl_used: b.casual?.used ?? '',
                            cl_left: b.casual?.remaining ?? '',
                            sl_used: b.sick?.used ?? '',
                            sl_left: b.sick?.remaining ?? '',
                            comp: b.comp?.available ?? '',
                            nhco: b.nhco?.remaining ?? b.stored_balances?.national_holiday_comp_off ?? '',
                            lop: b.loss_of_pay?.used ?? ''
                          })}
                          className="text-xs font-medium text-brand hover:underline"
                        >
                          Adjust
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={`border-t-2 ${isDark ? 'border-slate-500 bg-slate-700/30' : 'border-gray-300 bg-gray-50'}`}>
                  <td className="px-4 py-3 font-semibold" colSpan={2}>Totals ({filteredBalances.length} employees)</td>
                  <td className="px-3 py-3 text-center font-bold text-amber-500">{totals.clUsed}</td>
                  <td className="px-3 py-3 text-center font-bold text-green-500">{totals.clRem}</td>
                  <td className="px-3 py-3 text-center font-bold text-amber-500">{totals.slUsed}</td>
                  <td className="px-3 py-3 text-center font-bold text-green-500">{totals.slRem}</td>
                  <td className="px-3 py-3 text-center font-bold text-blue-500">{totals.compUsed}</td>
                  <td className="px-3 py-3 text-center font-bold text-purple-500">{totals.nhc}</td>
                  <td className="px-3 py-3 text-center font-bold text-red-500">{totals.lop}</td>
                  <td className="px-3 py-3 text-center font-bold text-gray-700 dark:text-gray-300">{totals.totalUsed}</td>
                  <td className="px-3 py-3 text-center font-bold text-green-600 dark:text-green-400">{totals.totalRem}</td>
                  {canAdjust && <td className="px-3 py-3"></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {adjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className={`w-full max-w-sm rounded-xl shadow-xl p-5 ${isDark ? 'bg-slate-800 border border-slate-700 text-white' : 'bg-white text-gray-900'}`}>
            <h3 className="text-lg font-semibold mb-1">Adjust Balances</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Manually override leave data for {adjustModal.name} ({year})</p>
            <form onSubmit={handleAdjustSave} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">CL Used</label>
                  <input type="number" step="0.5" value={adjustModal.cl_used} onChange={e => setAdjustModal({...adjustModal, cl_used: e.target.value})} className={inputCls + ' w-full'} placeholder="Auto" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">CL Left</label>
                  <input type="number" step="0.5" value={adjustModal.cl_left} onChange={e => setAdjustModal({...adjustModal, cl_left: e.target.value})} className={inputCls + ' w-full'} placeholder="Auto" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">SL Used</label>
                  <input type="number" step="0.5" value={adjustModal.sl_used} onChange={e => setAdjustModal({...adjustModal, sl_used: e.target.value})} className={inputCls + ' w-full'} placeholder="Auto" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">SL Left</label>
                  <input type="number" step="0.5" value={adjustModal.sl_left} onChange={e => setAdjustModal({...adjustModal, sl_left: e.target.value})} className={inputCls + ' w-full'} placeholder="Auto" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Comp</label>
                  <input type="number" step="0.5" value={adjustModal.comp} onChange={e => setAdjustModal({...adjustModal, comp: e.target.value})} className={inputCls + ' w-full'} placeholder="Auto" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">NHC</label>
                  <input type="number" step="0.5" value={adjustModal.nhco} onChange={e => setAdjustModal({...adjustModal, nhco: e.target.value})} className={inputCls + ' w-full'} placeholder="Auto" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">LOP</label>
                  <input type="number" step="0.5" value={adjustModal.lop} onChange={e => setAdjustModal({...adjustModal, lop: e.target.value})} className={inputCls + ' w-full'} placeholder="Auto" />
                </div>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 italic mt-2 text-center">Leave blank to use system defaults.</p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" onClick={() => setAdjustModal(null)} className={`px-4 py-2 rounded-lg text-sm font-medium border ${isDark ? 'border-slate-600 text-gray-300 hover:bg-slate-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>Cancel</button>
                <button type="submit" disabled={adjusting} className="px-4 py-2 rounded-lg text-sm font-medium bg-brand text-white hover:bg-brand-hover disabled:opacity-50">
                  {adjusting ? 'Saving...' : 'Save Balances'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
