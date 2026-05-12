import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, hasApi } from '../api/client';

// ── Helpers ──────────────────────────────────────────────────────

function formatDate(d) {
  if (!d) return '--';
  const iso = String(d).slice(0, 10);
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(d) {
  if (!d) return '--';
  const iso = String(d).slice(0, 10);
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ── Main Component ───────────────────────────────────────────────

export default function DinnerTrackingView({ isDark, currentUser, allUsers, showToast }) {
  const [coupons, setCoupons] = useState([]);
  const [exclusions, setExclusions] = useState([]);
  const [excludedOpen, setExcludedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);

  // Date picker for viewing coupons
  const [selectedDate, setSelectedDate] = useState(todayISO());

  // History section (last 5 days + from/to filter)
  const [historyFrom, setHistoryFrom] = useState(daysAgoISO(4));
  const [historyTo, setHistoryTo] = useState(todayISO());
  const [historyCoupons, setHistoryCoupons] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Add extra form state
  const [extraMode, setExtraMode] = useState('employee'); // 'employee' or 'guest'
  const [extraUserId, setExtraUserId] = useState('');
  const [extraGuestName, setExtraGuestName] = useState('');
  const [extraReason, setExtraReason] = useState('');
  const [adding, setAdding] = useState(false);

  // Editable pricing state
  const [showPricingEdit, setShowPricingEdit] = useState(false);
  const [editRegular, setEditRegular] = useState(120);
  const [editWednesday, setEditWednesday] = useState(160);
  const [savingPricing, setSavingPricing] = useState(false);

  const userType = currentUser?.type;
  const isAdmin = userType === 'admin';
  const isManager = userType === 'manager';
  const isTeamLead = userType === 'team_lead';
  const canManage = isAdmin || isManager;
  const isPrivileged = isAdmin || isManager || isTeamLead;
  const isEmployee = !isPrivileged;

  // ── Styling ────────────────────────────────────────────────────
  const card = isDark ? 'bg-slate-800/80 border-slate-700 text-white' : 'bg-white border-gray-200 text-gray-900';
  const cardHover = isDark ? 'hover:border-slate-600' : 'hover:border-gray-300';
  const subtleText = isDark ? 'text-gray-400' : 'text-gray-500';
  const borderColor = isDark ? 'border-slate-700' : 'border-gray-100';
  const inputCls = `rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${
    isDark ? 'bg-slate-700 border-slate-600 text-white focus:border-brand' : 'bg-white border-gray-300 text-gray-900 focus:border-brand'
  }`;

  // ── Data fetching ──────────────────────────────────────────────
  const fetchCoupons = useCallback(async () => {
    if (!hasApi()) return;
    try {
      setLoading(true);
      if (isEmployee) {
        // Employees see their own coupons for the current month
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const data = await api.dinners.list({ from: monthStart, to: todayISO() });
        setCoupons(data.coupons || []);
        setExclusions([]);
      } else {
        // Privileged users see coupons for the selected date
        const data = await api.dinners.list({ date: selectedDate });
        setCoupons(data.coupons || []);
        setExclusions(data.exclusions || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedDate, isEmployee]);

  const fetchSummary = useCallback(async () => {
    if (!hasApi()) return;
    try {
      const data = await api.dinners.summary();
      setSummary(data);
    } catch {
      // ignore
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    if (!hasApi() || isEmployee) return;
    try {
      setHistoryLoading(true);
      const data = await api.dinners.list({ from: historyFrom, to: historyTo });
      setHistoryCoupons(data.coupons || []);
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  }, [historyFrom, historyTo, isEmployee]);

  useEffect(() => {
    fetchCoupons();
    fetchSummary();
  }, [fetchCoupons, fetchSummary]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // ── Add extra person ──────────────────────────────────────────
  const handleAddExtra = async (e) => {
    e.preventDefault();
    if (extraMode === 'employee' && !extraUserId) {
      showToast?.('Select an employee', 'error');
      return;
    }
    if (extraMode === 'guest' && !extraGuestName.trim()) {
      showToast?.('Enter a guest name', 'error');
      return;
    }
    setAdding(true);
    try {
      const payload = {
        coupon_date: selectedDate,
        reason: extraReason.trim() || undefined,
      };
      if (extraMode === 'employee') {
        payload.user_id = extraUserId;
      } else {
        payload.guest_name = extraGuestName.trim();
      }
      await api.dinners.addExtra(payload);
      showToast?.(extraMode === 'guest' ? 'Guest added to food coupon list' : 'Employee added to food coupon list');
      setExtraUserId('');
      setExtraGuestName('');
      setExtraReason('');
      fetchCoupons();
      fetchSummary();
      fetchHistory();
    } catch (err) {
      showToast?.(err.data?.error || err.message || 'Failed to add', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveExtra = async (extraId) => {
    if (!window.confirm('Remove this manually added coupon?')) return;
    try {
      await api.dinners.removeExtra(extraId);
      showToast?.('Manual coupon removed');
      fetchCoupons();
      fetchSummary();
      fetchHistory();
    } catch (err) {
      showToast?.(err.message || 'Failed to remove', 'error');
    }
  };

  const handleExclude = async (userId, couponDate) => {
    if (!window.confirm('Exclude this employee from the food coupon list for this date?')) return;
    try {
      await api.dinners.exclude({ user_id: userId, coupon_date: couponDate });
      showToast?.('Employee excluded from food coupon list');
      fetchCoupons();
      fetchSummary();
      fetchHistory();
    } catch (err) {
      showToast?.(err.data?.error || err.message || 'Failed to exclude', 'error');
    }
  };

  const handleRemoveExclusion = async (exclusionId) => {
    try {
      await api.dinners.removeExclusion(exclusionId);
      showToast?.('Employee re-added to food coupon list');
      fetchCoupons();
      fetchSummary();
      fetchHistory();
    } catch (err) {
      showToast?.(err.data?.error || err.message || 'Failed to remove exclusion', 'error');
    }
  };

  // ── Available users for "Add Extra" dropdown ──────────────────
  const availableUsers = useMemo(() => {
    if (!allUsers) return [];
    const couponUserIds = new Set(coupons.map((c) => c.user_id));
    return allUsers.filter((u) => !couponUserIds.has(u.id));
  }, [allUsers, coupons]);

  // ── Employee: monthly summary ─────────────────────────────────
  const myMonthlyCount = useMemo(() => {
    if (!isEmployee) return 0;
    return coupons.length;
  }, [isEmployee, coupons]);

  // Pricing from backend
  const WEDNESDAY_PRICE = summary?.wednesday_price || 160;
  const REGULAR_PRICE = summary?.regular_price || 120;

  // Sync edit fields when summary loads
  useEffect(() => {
    if (summary) {
      setEditRegular(summary.regular_price || 120);
      setEditWednesday(summary.wednesday_price || 160);
    }
  }, [summary]);

  const handleSavePricing = async () => {
    setSavingPricing(true);
    try {
      await api.dinners.updateSettings({ regular_price: editRegular, wednesday_price: editWednesday });
      showToast?.('Token prices updated');
      setShowPricingEdit(false);
      fetchSummary();
    } catch (err) {
      showToast?.(err.data?.error || err.message || 'Failed to update pricing', 'error');
    } finally {
      setSavingPricing(false);
    }
  };

  const handleDownloadFoodCSV = () => {
    if (!summary?.employee_breakdown?.length && !dailyCounts.length) return;
    // Build employee breakdown CSV
    const header = ['Employee', 'Tokens This Month'];
    const rows = (summary?.employee_breakdown || []).map(e => [e.user_name || '', e.coupon_count || 0]);

    // Daily breakdown section
    const dailyHeader = ['', '', '', 'Date', 'Tokens', 'Rate (₹)', 'Cost (₹)', 'Day'];
    const dailyRows = dailyCounts.map(d => {
      const dayName = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      return ['', '', '', d.date, d.count, d.price, d.dayTotal, dayName];
    });

    const allRows = [
      ['Food Coupon Report - ' + new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })],
      ['Regular Price: ₹' + REGULAR_PRICE, 'Wednesday Price: ₹' + WEDNESDAY_PRICE],
      ['Total Tokens: ' + (summary?.coupons_this_month || 0), 'Total Cost: ₹' + monthlyTotal],
      [],
      ['EMPLOYEE BREAKDOWN'],
      header,
      ...rows,
      [],
      ['DAILY BREAKDOWN'],
      ['Date', 'Tokens', 'Rate', 'Cost', 'Day'],
      ...dailyCounts.map(d => {
        const dayName = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
        return [d.date, d.count, d.price, d.dayTotal, dayName];
      }),
      [],
      ['TOTAL', summary?.coupons_this_month || 0, '', monthlyTotal],
    ];

    const csvContent = allRows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const monthName = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).replace(' ', '_');
    a.download = `Food_Coupons_${monthName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Monthly overview: daily counts with pricing ──────────────
  const dailyCounts = useMemo(() => {
    if (!summary?.daily_breakdown) return [];
    return summary.daily_breakdown.map((row) => {
      const dateStr = row.coupon_date instanceof Date
        ? row.coupon_date.toISOString().slice(0, 10)
        : String(row.coupon_date).slice(0, 10);
      const d = new Date(dateStr + 'T00:00:00');
      const isWed = d.getDay() === 3;
      const price = row.price_per_token || (isWed ? WEDNESDAY_PRICE : REGULAR_PRICE);
      const count = parseInt(row.count, 10);
      return { date: dateStr, count, price, dayTotal: row.day_total || (count * price), isWednesday: isWed };
    });
  }, [summary, WEDNESDAY_PRICE, REGULAR_PRICE]);

  const monthlyTotal = useMemo(() => {
    return dailyCounts.reduce((sum, d) => sum + d.dayTotal, 0);
  }, [dailyCounts]);

  // ── History grouped by date ─────────────────────────────────
  const historyByDate = useMemo(() => {
    const groups = {};
    for (const c of historyCoupons) {
      const d = String(c.coupon_date).slice(0, 10);
      if (!groups[d]) groups[d] = [];
      groups[d].push(c);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, items]) => ({ date, items, count: items.length }));
  }, [historyCoupons]);

  // ── RENDER ─────────────────────────────────────────────────────

  // Employee view: simple list of their coupon dates this month
  if (isEmployee) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto w-full">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Food Coupons</h1>
          <p className={`text-sm mt-0.5 ${subtleText}`}>Your food coupons this month</p>
        </div>

        {/* Monthly count */}
        <div className={`rounded-xl border p-5 ${card}`}>
          <h2 className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText} mb-3`}>This Month</h2>
          <p className="text-3xl font-bold text-green-500">{myMonthlyCount}</p>
          <p className={`text-xs mt-1 ${subtleText}`}>coupon{myMonthlyCount !== 1 ? 's' : ''} received</p>
        </div>

        {/* List of dates */}
        {loading ? (
          <div className={`rounded-xl border p-8 text-center ${card}`}>
            <p className={`text-sm ${subtleText}`}>Loading...</p>
          </div>
        ) : coupons.length === 0 ? (
          <div className={`rounded-xl border p-10 text-center ${card}`}>
            <svg className={`w-10 h-10 mx-auto mb-3 ${isDark ? 'text-gray-600' : 'text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
            <p className={`text-sm font-medium ${subtleText}`}>No food coupons this month</p>
          </div>
        ) : (
          <div className={`rounded-xl border overflow-hidden ${card}`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-full text-sm">
                <thead>
                  <tr className={isDark ? 'bg-slate-700/50' : 'bg-gray-50'}>
                    <th className={`text-left px-5 py-3 text-xs font-medium ${subtleText}`}>Date</th>
                    <th className={`text-left px-5 py-3 text-xs font-medium ${subtleText}`}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((coupon, i) => (
                    <tr key={`${coupon.user_id}-${coupon.coupon_date}-${i}`} className={`border-t ${borderColor} ${isDark ? 'hover:bg-slate-700/40' : 'hover:bg-gray-50/80'} transition-colors`}>
                      <td className="px-5 py-3 whitespace-nowrap">{formatDate(coupon.coupon_date)}</td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {coupon.source === 'manual' ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            isDark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-50 text-blue-700'
                          }`}>Manually Added</span>
                        ) : (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            isDark ? 'bg-green-900/40 text-green-300' : 'bg-green-50 text-green-700'
                          }`}>Clocked In</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Admin / Manager / Team Lead view ──────────────────────────

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Food Coupons</h1>
        <p className={`text-sm mt-0.5 ${subtleText}`}>
          View attendance-based food coupons and manage manual additions
        </p>
      </div>

      {/* Monthly Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>This Month</p>
          <p className="text-2xl font-bold mt-1 text-green-500">{summary?.coupons_this_month || 0}</p>
          <p className={`text-[11px] mt-0.5 ${subtleText}`}>total tokens</p>
        </div>
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Today</p>
          <p className="text-2xl font-bold mt-1">{summary?.coupons_today || 0}</p>
          <p className={`text-[11px] mt-0.5 ${subtleText}`}>tokens issued</p>
        </div>
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Monthly Cost</p>
          <p className="text-2xl font-bold mt-1 text-amber-500">{'\u20B9'}{monthlyTotal.toLocaleString('en-IN')}</p>
          <p className={`text-[11px] mt-0.5 ${subtleText}`}>vendor billing</p>
        </div>
        <div className={`rounded-xl border p-4 ${card}`}>
          <div className="flex items-center justify-between">
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Token Price</p>
            {isAdmin && (
              <button type="button" onClick={() => setShowPricingEdit(!showPricingEdit)}
                className={`text-[10px] font-medium ${showPricingEdit ? 'text-red-500' : 'text-brand'}`}>
                {showPricingEdit ? 'Cancel' : 'Edit'}
              </button>
            )}
          </div>
          {showPricingEdit ? (
            <div className="mt-1.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] w-12 ${subtleText}`}>Regular</span>
                <input type="number" value={editRegular} onChange={(e) => setEditRegular(Number(e.target.value))}
                  className={`w-20 rounded px-2 py-1 text-sm border ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300'}`} />
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] w-12 ${subtleText}`}>Wed</span>
                <input type="number" value={editWednesday} onChange={(e) => setEditWednesday(Number(e.target.value))}
                  className={`w-20 rounded px-2 py-1 text-sm border ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300'}`} />
              </div>
              <button type="button" onClick={handleSavePricing} disabled={savingPricing}
                className="w-full mt-1 px-2 py-1 rounded text-xs font-medium text-white bg-brand hover:bg-brand-hover disabled:opacity-50">
                {savingPricing ? 'Saving...' : 'Save'}
              </button>
            </div>
          ) : (
            <>
              <div className="mt-1">
                <span className="text-sm font-bold">{'\u20B9'}{REGULAR_PRICE}</span>
                <span className={`text-[11px] ${subtleText}`}> / day</span>
              </div>
              <div>
                <span className="text-sm font-bold text-amber-500">{'\u20B9'}{WEDNESDAY_PRICE}</span>
                <span className={`text-[11px] ${subtleText}`}> / Wed</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Download Button */}
      {isPrivileged && summary && (
        <div className="flex justify-end">
          <button type="button" onClick={handleDownloadFoodCSV}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-brand text-white hover:bg-brand-hover transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download Monthly Report
          </button>
        </div>
      )}

      {/* Top: date picker + count */}
      <div className={`flex flex-wrap items-end gap-4 p-4 rounded-xl border ${card}`}>
        <div>
          <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${subtleText}`}>Date</label>
          <input
            type="date"
            value={selectedDate}
            max={todayISO()}
            onChange={(e) => setSelectedDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            Food Coupons for {formatDate(selectedDate)}
          </p>
          <p className={`text-xs ${subtleText}`}>
            {loading ? 'Loading...' : `${coupons.length} token${coupons.length !== 1 ? 's' : ''} | ${'\u20B9'}${(() => {
              const d = new Date(selectedDate + 'T00:00:00');
              const price = d.getDay() === 3 ? WEDNESDAY_PRICE : REGULAR_PRICE;
              return (coupons.length * price).toLocaleString('en-IN');
            })()}`}
          </p>
        </div>
      </div>

      {/* Main coupon table */}
      {loading ? (
        <div className={`rounded-xl border p-8 text-center ${card}`}>
          <p className={`text-sm ${subtleText}`}>Loading food coupons...</p>
        </div>
      ) : coupons.length === 0 ? (
        <div className={`rounded-xl border p-10 text-center ${card}`}>
          <svg className={`w-10 h-10 mx-auto mb-3 ${isDark ? 'text-gray-600' : 'text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
          </svg>
          <p className={`text-sm font-medium ${subtleText}`}>No food coupons for this date</p>
          <p className={`text-xs mt-1 ${subtleText}`}>Employees who clock in will automatically appear here</p>
        </div>
      ) : (
        <div className={`rounded-xl border overflow-hidden ${card}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-full text-sm">
              <thead>
                <tr className={isDark ? 'bg-slate-700/50' : 'bg-gray-50'}>
                  <th className={`text-left px-5 py-3 text-xs font-medium ${subtleText}`}>Employee</th>
                  <th className={`text-left px-5 py-3 text-xs font-medium ${subtleText}`}>Source</th>
                  <th className={`text-left px-5 py-3 text-xs font-medium ${subtleText}`}>Reason</th>
                  <th className={`text-left px-5 py-3 text-xs font-medium ${subtleText}`}>Added By</th>
                  {canManage && <th className={`text-right px-5 py-3 text-xs font-medium ${subtleText}`}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon, i) => (
                  <tr key={`${coupon.user_id}-${coupon.coupon_date}-${i}`} className={`border-t ${borderColor} ${isDark ? 'hover:bg-slate-700/40' : 'hover:bg-gray-50/80'} transition-colors`}>
                    <td className="px-5 py-3 whitespace-nowrap font-medium">
                      {coupon.user_name}
                      {coupon.guest_name && (
                        <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          isDark ? 'bg-purple-900/40 text-purple-300' : 'bg-purple-50 text-purple-700'
                        }`}>Guest</span>
                      )}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {coupon.source === 'manual' ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          isDark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-50 text-blue-700'
                        }`}>Manually Added</span>
                      ) : (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          isDark ? 'bg-green-900/40 text-green-300' : 'bg-green-50 text-green-700'
                        }`}>Clocked In</span>
                      )}
                    </td>
                    <td className={`px-5 py-3 ${subtleText} max-w-[200px] truncate`}>
                      {coupon.reason || '--'}
                    </td>
                    <td className={`px-5 py-3 whitespace-nowrap ${subtleText}`}>
                      {coupon.source === 'manual' ? (coupon.added_by_name || '--') : '--'}
                    </td>
                    {canManage && (
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {/* Exclude button: available for any coupon with a user_id */}
                          {coupon.user_id && (
                            <button
                              type="button"
                              onClick={() => handleExclude(coupon.user_id, coupon.coupon_date)}
                              className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-orange-900/30 text-gray-400 hover:text-orange-400' : 'hover:bg-orange-50 text-gray-400 hover:text-orange-500'}`}
                              title="Exclude from coupon list"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                          {/* Remove manual entry button: admin only */}
                          {isAdmin && coupon.source === 'manual' && coupon.extra_id && (
                            <button
                              type="button"
                              onClick={() => handleRemoveExtra(coupon.extra_id)}
                              className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-red-900/30 text-gray-400 hover:text-red-400' : 'hover:bg-red-50 text-gray-400 hover:text-red-500'}`}
                              title="Remove manual entry"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Excluded employees section */}
      {canManage && exclusions.length > 0 && (
        <div className={`rounded-xl border overflow-hidden ${card}`}>
          <button
            type="button"
            onClick={() => setExcludedOpen((v) => !v)}
            className={`w-full flex items-center justify-between px-5 py-3 text-left transition-colors ${
              isDark ? 'hover:bg-slate-700/40' : 'hover:bg-gray-50/80'
            }`}
          >
            <span className="text-sm font-medium">
              Excluded ({exclusions.length})
            </span>
            <svg
              className={`w-4 h-4 transition-transform ${excludedOpen ? 'rotate-180' : ''} ${subtleText}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {excludedOpen && (
            <div className={`border-t ${borderColor}`}>
              <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                <table className="w-full min-w-full text-sm">
                  <thead>
                    <tr className={isDark ? 'bg-slate-700/50' : 'bg-gray-50'}>
                      <th className={`text-left px-5 py-2.5 text-xs font-medium ${subtleText}`}>Employee</th>
                      <th className={`text-left px-5 py-2.5 text-xs font-medium ${subtleText}`}>Reason</th>
                      <th className={`text-left px-5 py-2.5 text-xs font-medium ${subtleText}`}>Excluded By</th>
                      <th className={`text-right px-5 py-2.5 text-xs font-medium ${subtleText}`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exclusions.map((excl) => (
                      <tr key={excl.id} className={`border-t ${borderColor} ${isDark ? 'hover:bg-slate-700/40' : 'hover:bg-gray-50/80'} transition-colors`}>
                        <td className="px-5 py-2.5 whitespace-nowrap font-medium">{excl.user_name}</td>
                        <td className={`px-5 py-2.5 ${subtleText} max-w-[200px] truncate`}>
                          {excl.reason || '--'}
                        </td>
                        <td className={`px-5 py-2.5 whitespace-nowrap ${subtleText}`}>
                          {excl.excluded_by_name || '--'}
                        </td>
                        <td className="px-5 py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleRemoveExclusion(excl.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50"
                            title="Re-add to coupon list"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Re-add
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Extra Person form (admin/manager only) */}
      {canManage && (
        <div className={`rounded-xl border p-5 ${card}`}>
          <div className="flex items-center gap-4 mb-3">
            <h2 className="text-sm font-semibold">Add Extra Person</h2>
            <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-600 text-xs">
              <button
                type="button"
                onClick={() => setExtraMode('employee')}
                className={`px-3 py-1 font-medium transition-colors ${
                  extraMode === 'employee'
                    ? 'bg-brand text-white'
                    : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                Employee
              </button>
              <button
                type="button"
                onClick={() => setExtraMode('guest')}
                className={`px-3 py-1 font-medium transition-colors ${
                  extraMode === 'guest'
                    ? 'bg-brand text-white'
                    : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                Guest / Visitor
              </button>
            </div>
          </div>
          <form onSubmit={handleAddExtra} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              {extraMode === 'employee' ? (
                <>
                  <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${subtleText}`}>Employee</label>
                  <select
                    value={extraUserId}
                    onChange={(e) => setExtraUserId(e.target.value)}
                    className={`w-full ${inputCls}`}
                  >
                    <option value="">Select employee...</option>
                    {availableUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${subtleText}`}>Guest Name</label>
                  <input
                    type="text"
                    value={extraGuestName}
                    onChange={(e) => setExtraGuestName(e.target.value)}
                    className={`w-full ${inputCls}`}
                    placeholder="e.g. John from TechCorp, CEO's guest..."
                  />
                </>
              )}
            </div>
            <div className="min-w-[200px] flex-1">
              <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${subtleText}`}>Reason (optional)</label>
              <input
                type="text"
                value={extraReason}
                onChange={(e) => setExtraReason(e.target.value)}
                className={`w-full ${inputCls}`}
                placeholder="e.g. Client visit, stayed late..."
              />
            </div>
            <button
              type="submit"
              disabled={adding || (extraMode === 'employee' ? !extraUserId : !extraGuestName.trim())}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand hover:bg-brand-hover disabled:opacity-50 transition-colors"
            >
              {adding ? 'Adding...' : 'Add'}
            </button>
          </form>
        </div>
      )}

      {/* History: Recent days with from/to filter */}
      {isPrivileged && (
        <div className={`rounded-xl border overflow-hidden ${card}`}>
          <div className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b ${borderColor}`}>
            <h2 className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Coupon History</h2>
            <div className="flex items-center gap-2">
              <label className={`text-[10px] font-medium ${subtleText}`}>From</label>
              <input
                type="date"
                value={historyFrom}
                max={historyTo}
                onChange={(e) => setHistoryFrom(e.target.value)}
                className={`${inputCls} text-xs py-1`}
              />
              <label className={`text-[10px] font-medium ${subtleText}`}>To</label>
              <input
                type="date"
                value={historyTo}
                max={todayISO()}
                min={historyFrom}
                onChange={(e) => setHistoryTo(e.target.value)}
                className={`${inputCls} text-xs py-1`}
              />
            </div>
          </div>
          {historyLoading ? (
            <div className="px-5 py-8 text-center">
              <p className={`text-xs ${subtleText}`}>Loading...</p>
            </div>
          ) : historyByDate.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className={`text-xs ${subtleText}`}>No coupons in this date range</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-full text-sm">
                <thead>
                  <tr className={isDark ? 'bg-slate-700/50' : 'bg-gray-50'}>
                    <th className={`text-left px-5 py-2.5 text-xs font-medium ${subtleText}`}>Date</th>
                    <th className={`text-left px-5 py-2.5 text-xs font-medium ${subtleText}`}>Tokens</th>
                    <th className={`text-left px-5 py-2.5 text-xs font-medium ${subtleText}`}>Rate</th>
                    <th className={`text-left px-5 py-2.5 text-xs font-medium ${subtleText}`}>Cost</th>
                    <th className={`text-left px-5 py-2.5 text-xs font-medium ${subtleText}`}>Employees</th>
                    <th className={`text-right px-5 py-2.5 text-xs font-medium ${subtleText}`}></th>
                  </tr>
                </thead>
                <tbody>
                  {historyByDate.map((row) => {
                    const d = new Date(row.date + 'T00:00:00');
                    const isWed = d.getDay() === 3;
                    const price = isWed ? WEDNESDAY_PRICE : REGULAR_PRICE;
                    const dayCost = row.count * price;
                    return (
                    <tr
                      key={row.date}
                      className={`border-t ${borderColor} cursor-pointer ${
                        row.date === selectedDate
                          ? isDark ? 'bg-brand/10' : 'bg-brand/5'
                          : isDark ? 'hover:bg-slate-700/40' : 'hover:bg-gray-50/80'
                      } transition-colors`}
                      onClick={() => setSelectedDate(row.date)}
                    >
                      <td className="px-5 py-2.5 whitespace-nowrap font-medium">
                        {formatDate(row.date)}
                        {isWed && <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${isDark ? 'bg-amber-900/30 text-amber-400' : 'bg-amber-50 text-amber-600'}`}>Wed</span>}
                      </td>
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-bold">
                          {row.count}
                        </span>
                      </td>
                      <td className={`px-5 py-2.5 whitespace-nowrap ${isWed ? 'text-amber-500 font-medium' : subtleText}`}>
                        {'\u20B9'}{price}
                      </td>
                      <td className="px-5 py-2.5 whitespace-nowrap font-medium">
                        {'\u20B9'}{dayCost.toLocaleString('en-IN')}
                      </td>
                      <td className={`px-5 py-2.5 ${subtleText} text-xs`}>
                        {row.items.slice(0, 3).map((c) => c.user_name).join(', ')}
                        {row.items.length > 3 && ` +${row.items.length - 3} more`}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <span className={`text-[11px] font-medium text-brand`}>View</span>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className={`px-5 py-2.5 border-t ${borderColor} flex justify-between`}>
                <p className={`text-xs font-medium ${subtleText}`}>
                  Total: {historyCoupons.length} tokens across {historyByDate.length} day{historyByDate.length !== 1 ? 's' : ''}
                </p>
                <p className="text-xs font-semibold">
                  {'\u20B9'}{historyByDate.reduce((sum, row) => {
                    const d = new Date(row.date + 'T00:00:00');
                    const price = d.getDay() === 3 ? WEDNESDAY_PRICE : REGULAR_PRICE;
                    return sum + row.count * price;
                  }, 0).toLocaleString('en-IN')}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
