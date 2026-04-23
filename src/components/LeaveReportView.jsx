import { useState, useEffect, useMemo, useCallback } from 'react';
import { api, hasApi } from '../api/client';

function leaveTypeLabel(type) {
  const map = { casual: 'CL', sick: 'SL', comp: 'Comp', loss_of_pay: 'LOP' };
  return map[type] || type || '--';
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
    // Sort
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

  // Summary totals
  const totals = useMemo(() => {
    const t = { clUsed: 0, clRem: 0, slUsed: 0, slRem: 0, compUsed: 0, compAvail: 0, lop: 0, total: 0 };
    filteredBalances.forEach(b => {
      t.clUsed += b.casual?.used || 0;
      t.clRem += b.casual?.remaining || 0;
      t.slUsed += b.sick?.used || 0;
      t.slRem += b.sick?.remaining || 0;
      t.compUsed += b.comp?.used || 0;
      t.compAvail += b.comp?.available || 0;
      t.lop += b.loss_of_pay?.used || 0;
      t.total += b.total_used || 0;
    });
    return t;
  }, [filteredBalances]);

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className={`ml-0.5 ${subtleText}`}>{'\u2195'}</span>;
    return <span className="ml-0.5 text-brand">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>;
  };

  const years = [];
  const currentYear = new Date().getFullYear();
  const maxYear = Math.max(currentYear, 2026);
  for (let y = maxYear; y >= maxYear - 3; y--) years.push(y);

  const handleDownloadCSV = () => {
    if (filteredBalances.length === 0) return;
    const header = ['Employee', 'Designation', 'Department', 'CL Used', 'CL Total', 'CL Remaining', 'SL Used', 'SL Total', 'SL Remaining', 'Comp Used', 'Comp Available', 'LOP', 'Total Used'];
    const rows = filteredBalances.map(b => [
      b.employee_name || '',
      b.designation || '',
      b.department_name || '',
      b.casual?.used || 0,
      b.casual?.total || 12,
      b.casual?.remaining || 0,
      b.sick?.used || 0,
      b.sick?.total || 4,
      b.sick?.remaining || 0,
      b.comp?.used || 0,
      b.comp?.available || 0,
      b.loss_of_pay?.used || 0,
      b.total_used || 0,
    ]);
    // Totals row
    rows.push(['TOTAL (' + filteredBalances.length + ' employees)', '', '', totals.clUsed, '', totals.clRem, totals.slUsed, '', totals.slRem, totals.compUsed, totals.compAvail, totals.lop, totals.total]);

    const csvContent = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Leave_Report_${year}${month ? '_' + MONTH_NAMES[month] : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Leave Report</h1>
          <p className={`text-sm mt-0.5 ${subtleText}`}>
            Employee leave balance breakdown{month ? ` for ${MONTH_NAMES[month]} ${year}` : ` for ${year}`} - CL (12/yr), SL (4/yr), Comp, LOP
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10))}
            className={inputCls}
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value, 10))}
            className={inputCls}
          >
            <option value={0}>All Months</option>
            {MONTH_NAMES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <input
            type="text"
            placeholder="Search employee..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`${inputCls} min-w-[180px]`}
          />
          <button
            type="button"
            onClick={handleDownloadCSV}
            disabled={filteredBalances.length === 0}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${
              isDark ? 'bg-brand text-white hover:bg-brand-hover' : 'bg-brand text-white hover:bg-brand-hover'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download CSV
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Employees</p>
          <p className="text-2xl font-bold mt-1">{filteredBalances.length}</p>
        </div>
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>CL Used / Remaining</p>
          <p className="text-2xl font-bold mt-1"><span className="text-amber-500">{totals.clUsed}</span> / <span className="text-green-500">{totals.clRem}</span></p>
        </div>
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>SL Used / Remaining</p>
          <p className="text-2xl font-bold mt-1"><span className="text-amber-500">{totals.slUsed}</span> / <span className="text-green-500">{totals.slRem}</span></p>
        </div>
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Comp Used / Available</p>
          <p className="text-2xl font-bold mt-1"><span className="text-blue-500">{totals.compUsed}</span> / <span className="text-green-500">{totals.compAvail}</span></p>
        </div>
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Loss of Pay</p>
          <p className="text-2xl font-bold mt-1 text-red-500">{totals.lop}</p>
        </div>
      </div>

      {/* Main table */}
      {loading ? (
        <div className={`rounded-xl border p-8 text-center ${card}`}>
          <p className={`text-sm ${subtleText}`}>Loading leave balances...</p>
        </div>
      ) : filteredBalances.length === 0 ? (
        <div className={`rounded-xl border p-10 text-center ${card}`}>
          <p className={`text-sm font-medium ${subtleText}`}>No employees found</p>
        </div>
      ) : (
        <div className={`rounded-xl border overflow-hidden ${card}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-full text-sm">
              <thead>
                <tr className={isDark ? 'bg-slate-700/50' : 'bg-gray-50'}>
                  <th className={`text-left px-4 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('employee_name')}>
                    Employee <SortIcon field="employee_name" />
                  </th>
                  <th className={`text-left px-4 py-3 text-xs font-medium ${subtleText}`}>Dept</th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('cl_used')}>
                    CL Used <SortIcon field="cl_used" />
                  </th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('cl_rem')}>
                    CL Left <SortIcon field="cl_rem" />
                  </th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('sl_used')}>
                    SL Used <SortIcon field="sl_used" />
                  </th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('sl_rem')}>
                    SL Left <SortIcon field="sl_rem" />
                  </th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('comp')}>
                    Comp <SortIcon field="comp" />
                  </th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('lop')}>
                    LOP <SortIcon field="lop" />
                  </th>
                  <th className={`text-center px-3 py-3 text-xs font-medium cursor-pointer select-none ${subtleText}`} onClick={() => handleSort('total')}>
                    Total <SortIcon field="total" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredBalances.map((b) => (
                  <tr key={b.employee_id} className={`border-t ${borderColor} ${isDark ? 'hover:bg-slate-700/40' : 'hover:bg-gray-50/80'} transition-colors`}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div>
                        <p className="font-medium">{b.employee_name}</p>
                        {b.designation && <p className={`text-[11px] ${subtleText}`}>{b.designation}</p>}
                      </div>
                    </td>
                    <td className={`px-4 py-3 whitespace-nowrap text-xs ${subtleText}`}>{b.department_name || '--'}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={`font-semibold ${b.casual?.used > 0 ? 'text-amber-500' : ''}`}>{b.casual?.used || 0}</span>
                      <span className={`text-[11px] ${subtleText}`}> / {b.casual?.total || 12}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`font-semibold ${b.casual?.remaining <= 2 ? 'text-red-500' : 'text-green-500'}`}>{b.casual?.remaining || 0}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`font-semibold ${b.sick?.used > 0 ? 'text-amber-500' : ''}`}>{b.sick?.used || 0}</span>
                      <span className={`text-[11px] ${subtleText}`}> / {b.sick?.total || 4}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`font-semibold ${b.sick?.remaining <= 1 ? 'text-red-500' : 'text-green-500'}`}>{b.sick?.remaining || 0}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      {b.comp?.used > 0 && <span className="font-semibold text-blue-500">{b.comp.used} used</span>}
                      {b.comp?.available > 0 && <span className={`${b.comp?.used > 0 ? ' / ' : ''}font-semibold text-green-500`}>{b.comp.available} avail</span>}
                      {(!b.comp?.used && !b.comp?.available) && <span className={subtleText}>0</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`font-semibold ${b.loss_of_pay?.used > 0 ? 'text-red-500' : ''}`}>{b.loss_of_pay?.used || 0}</span>
                    </td>
                    <td className="px-3 py-3 text-center font-bold">{b.total_used || 0}</td>
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
                  <td className="px-3 py-3 text-center font-bold text-red-500">{totals.lop}</td>
                  <td className="px-3 py-3 text-center font-bold">{totals.total}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
