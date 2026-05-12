import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api/client';

// -- Helpers ------------------------------------------------------------------

function formatDate(d) {
  if (!d) return '--';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(v) {
  if (v == null) return '₹0.00';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(v);
}

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function currentMonthISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const STATUS_BADGE = {
  pending:  'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const TYPE_BADGE = {
  food: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  cab:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

// -- Circular Progress Ring ---------------------------------------------------

function ProgressRing({ used, total, label, days, isDark }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const r = 40, stroke = 6, circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#10b981';

  return (
    <div className="flex items-center gap-5">
      <svg width="100" height="100" className="shrink-0">
        <circle cx="50" cy="50" r={r} fill="none" stroke={isDark ? '#334155' : '#e5e7eb'} strokeWidth={stroke} />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          transform="rotate(-90 50 50)" className="transition-all duration-500" />
        <text x="50" y="46" textAnchor="middle" className="fill-current text-gray-900 dark:text-white text-sm font-bold">{pct.toFixed(0)}%</text>
        <text x="50" y="62" textAnchor="middle" className="fill-gray-400 text-[10px]">used</text>
      </svg>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {formatCurrency(used)} of {formatCurrency(total)} used
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{days} day{days !== 1 ? 's' : ''} claimed this month</p>
      </div>
    </div>
  );
}

// -- Policy Card --------------------------------------------------------------

function PolicyCard({ policy, isDark, onEdit }) {
  const cardBg = isDark ? 'bg-slate-700/50 border-slate-600' : 'bg-gray-50 border-gray-200';
  return (
    <div className={`rounded-lg border p-4 ${cardBg}`}>
      <div className="flex items-start justify-between">
        <div>
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[policy.type] || TYPE_BADGE.food}`}>
            {policy.type === 'food' ? 'Food' : 'Transport'}
          </span>
          <div className="mt-2 text-sm text-gray-900 dark:text-white">
            <span className="font-semibold">{formatCurrency(policy.amount_per_day)}</span>
            <span className="text-gray-500 dark:text-gray-400"> / day</span>
            {policy.max_per_month ? (
              <span className="text-gray-500 dark:text-gray-400 ml-3">
                Max <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(policy.max_per_month)}</span> / month
              </span>
            ) : null}
          </div>
          {policy.eligible_roles && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Eligible: {policy.eligible_roles}</p>
          )}
        </div>
        {onEdit && (
          <button type="button" onClick={() => onEdit(policy)} className="text-xs text-brand hover:text-brand-hover font-medium">
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

// -- Main Component -----------------------------------------------------------

export default function FoodCabView({ isDark, currentUser, showToast }) {
  const isAdmin = currentUser?.type === 'admin' || currentUser?.type === 'manager';

  const [tab, setTab] = useState('my');
  const [policies, setPolicies] = useState([]);
  const [claims, setClaims] = useState([]);
  const [allClaims, setAllClaims] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Quick claim form
  const [claimType, setClaimType] = useState('food');
  const [claimDate, setClaimDate] = useState(todayISO());
  const [claimAmount, setClaimAmount] = useState('');
  const [claimNotes, setClaimNotes] = useState('');

  // All claims filters
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Policy editor
  const [editingPolicy, setEditingPolicy] = useState(null);

  const card = isDark ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200 shadow-sm';
  const input = isDark
    ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400 focus:border-brand focus:ring-brand'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-brand focus:ring-brand';

  const TABS = isAdmin
    ? [{ id: 'my', label: 'My Claims' }, { id: 'all', label: 'All Claims' }, { id: 'policies', label: 'Policies' }]
    : [{ id: 'my', label: 'My Claims' }];

  // -- Fetch ------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const month = currentMonthISO();
    try {
      const promises = [
        api.allowances?.policies?.()?.catch?.(() => ({ policies: [] })) ?? Promise.resolve({ policies: [] }),
        api.allowances?.claims?.({ month })?.catch?.(() => ({ claims: [] })) ?? Promise.resolve({ claims: [] }),
        api.allowances?.summary?.({ month })?.catch?.(() => null) ?? Promise.resolve(null),
      ];
      if (isAdmin) {
        promises.push(
          api.allowances?.claims?.({ status: 'all', month })?.catch?.(() => ({ claims: [] })) ?? Promise.resolve({ claims: [] })
        );
      }
      const results = await Promise.all(promises);
      setPolicies(results[0]?.policies || []);
      setClaims(results[1]?.claims || []);
      setSummary(results[2]);
      if (isAdmin && results[3]) setAllClaims(results[3]?.claims || []);
    } catch (e) {
      if (e.status !== 401) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Pre-fill amount from policy
  useEffect(() => {
    const pol = policies.find((p) => p.type === claimType);
    if (pol?.amount_per_day) setClaimAmount(String(pol.amount_per_day));
  }, [claimType, policies]);

  // -- Actions ----------------------------------------------------------------

  const handleSubmitClaim = async (e) => {
    e.preventDefault();
    if (!claimAmount || Number(claimAmount) <= 0) return;
    setSubmitting(true);
    try {
      await api.allowances.submitClaim({ type: claimType, claim_date: claimDate, amount: Number(claimAmount), notes: claimNotes.trim() || undefined });
      showToast?.('Claim submitted', 'success');
      setClaimNotes('');
      setClaimDate(todayISO());
      fetchData();
    } catch (e) {
      if (e.status !== 401) showToast?.(e.message || 'Failed to submit', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAction = useCallback(async (id, action) => {
    setActionId(id);
    try {
      await (action === 'approve' ? api.allowances.approveClaim(id) : api.allowances.rejectClaim(id));
      showToast?.(`Claim ${action}d`, 'success');
      fetchData();
    } catch (e) {
      if (e.status !== 401) showToast?.(e.message || `Failed to ${action}`, 'error');
    } finally {
      setActionId(null);
    }
  }, [fetchData, showToast]);

  const handleSavePolicy = useCallback(async (data) => {
    setSavingPolicy(true);
    try {
      if (data.id) await api.allowances.updatePolicy?.(data.id, data);
      else await api.allowances.createPolicy?.(data);
      showToast?.('Policy saved', 'success');
      setEditingPolicy(null);
      fetchData();
    } catch (e) {
      if (e.status !== 401) showToast?.(e.message || 'Failed to save', 'error');
    } finally {
      setSavingPolicy(false);
    }
  }, [fetchData, showToast]);

  // -- Derived ----------------------------------------------------------------

  const foodPolicy = policies.find((p) => p.type === 'food');
  const cabPolicy = policies.find((p) => p.type === 'cab');
  const foodUsed = summary?.food_used ?? claims.filter((c) => c.type === 'food' && c.status !== 'rejected').reduce((s, c) => s + (c.amount || 0), 0);
  const cabUsed = summary?.cab_used ?? claims.filter((c) => c.type === 'cab' && c.status !== 'rejected').reduce((s, c) => s + (c.amount || 0), 0);
  const foodMax = summary?.food_max ?? (foodPolicy?.max_per_month || 0);
  const cabMax = summary?.cab_max ?? (cabPolicy?.max_per_month || 0);
  const foodDays = claims.filter((c) => c.type === 'food' && c.status !== 'rejected').length;
  const cabDays = claims.filter((c) => c.type === 'cab' && c.status !== 'rejected').length;

  const filteredAll = useMemo(() => {
    let r = allClaims;
    if (filterType) r = r.filter((c) => c.type === filterType);
    if (filterStatus) r = r.filter((c) => c.status === filterStatus);
    return r;
  }, [allClaims, filterType, filterStatus]);

  // -- Loading / Error --------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-xl border p-6 max-w-3xl ${card}`}>
        <p className="text-red-600 dark:text-red-400 font-medium">Failed to load allowances</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error}</p>
        <button type="button" onClick={fetchData} className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand hover:bg-brand-hover">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Allowances</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Daily food and transportation allowances</p>
      </div>

      {/* Tab Toggle */}
      {isAdmin && (
        <div className={`inline-flex rounded-lg p-1 ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`}>
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                tab === t.id ? 'bg-brand text-white shadow-sm'
                  : isDark ? 'text-gray-300 hover:text-white hover:bg-slate-600' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
              }`}>{t.label}</button>
          ))}
        </div>
      )}

      {/* ====================== MY CLAIMS ====================== */}
      {tab === 'my' && (
        <>
          {/* Monthly Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={`rounded-xl border p-5 ${card}`}>
              <ProgressRing used={foodUsed} total={foodMax} label="Food Allowance" days={foodDays} isDark={isDark} />
            </div>
            <div className={`rounded-xl border p-5 ${card}`}>
              <ProgressRing used={cabUsed} total={cabMax} label="Transport Allowance" days={cabDays} isDark={isDark} />
            </div>
          </div>

          {/* Quick Claim */}
          <div className={`rounded-xl border p-5 ${card}`}>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Quick Claim</h2>
            <form onSubmit={handleSubmitClaim} className="flex flex-wrap items-end gap-3">
              <div className="w-32">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Type</label>
                <select value={claimType} onChange={(e) => setClaimType(e.target.value)} className={`${input} rounded-lg px-3 py-2 text-sm border w-full`}>
                  <option value="food">Food</option>
                  <option value="cab">Transport</option>
                </select>
              </div>
              <div className="w-40">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Date</label>
                <input type="date" value={claimDate} onChange={(e) => setClaimDate(e.target.value)} max={todayISO()} className={`${input} rounded-lg px-3 py-2 text-sm border w-full`} />
              </div>
              <div className="w-28">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Amount (Rs.)</label>
                <input type="number" step="0.01" min="0.01" value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} className={`${input} rounded-lg px-3 py-2 text-sm border w-full`} required />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Notes (optional)</label>
                <input type="text" value={claimNotes} onChange={(e) => setClaimNotes(e.target.value)} placeholder="e.g., Site visit to client" className={`${input} rounded-lg px-3 py-2 text-sm border w-full`} />
              </div>
              <button type="submit" disabled={submitting || !claimAmount || Number(claimAmount) <= 0}
                className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
            </form>
          </div>

          {/* Claims History */}
          <div className={`rounded-xl border overflow-hidden ${card}`}>
            <div className="px-5 py-3 border-b border-gray-200 dark:border-slate-600">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Claims History</h2>
            </div>
            {claims.length === 0 ? (
              <p className="p-6 text-xs text-gray-500 dark:text-gray-400 text-center">No claims submitted this month.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-full text-left text-xs">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-slate-600' : 'border-gray-200'}`}>
                      <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Date</th>
                      <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Type</th>
                      <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Amount</th>
                      <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Status</th>
                      <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((c) => (
                      <tr key={c.id} className={`border-b ${isDark ? 'border-slate-700 hover:bg-slate-700/50' : 'border-gray-100 hover:bg-gray-50'}`}>
                        <td className="px-4 py-2.5 whitespace-nowrap text-gray-900 dark:text-white">{formatDate(c.claim_date || c.date)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${TYPE_BADGE[c.type] || ''}`}>
                            {c.type === 'food' ? 'Food' : 'Transport'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{formatCurrency(c.amount)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${STATUS_BADGE[c.status] || ''}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 max-w-[200px] truncate">{c.notes || '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ====================== ALL CLAIMS (Admin/Manager) ====================== */}
      {tab === 'all' && isAdmin && (
        <div className={`rounded-xl border overflow-hidden ${card}`}>
          <div className="px-5 py-3 border-b border-gray-200 dark:border-slate-600 flex flex-col sm:flex-row sm:items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex-1">All Claims</h2>
            <div className="flex gap-2">
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className={`${input} rounded-lg px-3 py-1.5 text-xs border`}>
                <option value="">All Types</option>
                <option value="food">Food</option>
                <option value="cab">Transport</option>
              </select>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={`${input} rounded-lg px-3 py-1.5 text-xs border`}>
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
          {filteredAll.length === 0 ? (
            <p className="p-6 text-xs text-gray-500 dark:text-gray-400 text-center">No claims match the selected filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-full text-left text-xs">
                <thead>
                  <tr className={`border-b ${isDark ? 'border-slate-600' : 'border-gray-200'}`}>
                    <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Employee</th>
                    <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Date</th>
                    <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Type</th>
                    <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Amount</th>
                    <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Status</th>
                    <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAll.map((c) => (
                    <tr key={c.id} className={`border-b ${isDark ? 'border-slate-700 hover:bg-slate-700/50' : 'border-gray-100 hover:bg-gray-50'}`}>
                      <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{c.employee_name || c.employeeName || '--'}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-gray-900 dark:text-white">{formatDate(c.claim_date || c.date)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${TYPE_BADGE[c.type] || ''}`}>
                          {c.type === 'food' ? 'Food' : 'Transport'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{formatCurrency(c.amount)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${STATUS_BADGE[c.status] || ''}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {c.status === 'pending' ? (
                          <div className="flex gap-1.5">
                            <button type="button" disabled={actionId === c.id} onClick={() => handleAction(c.id, 'approve')}
                              className="px-2.5 py-1 rounded text-[10px] font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50">
                              Approve
                            </button>
                            <button type="button" disabled={actionId === c.id} onClick={() => handleAction(c.id, 'reject')}
                              className="px-2.5 py-1 rounded text-[10px] font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50">
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-400">--</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ====================== POLICIES (Admin/Manager) ====================== */}
      {tab === 'policies' && isAdmin && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Allowance Policies</h2>
            {!editingPolicy && (
              <button type="button"
                onClick={() => setEditingPolicy({ id: null, type: 'food', amount_per_day: '', max_per_month: '', eligible_roles: 'employee,team_lead,manager,admin' })}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-brand hover:bg-brand-hover">
                + Add Policy
              </button>
            )}
          </div>

          {policies.length === 0 && !editingPolicy && (
            <p className="text-xs text-gray-500 dark:text-gray-400 py-4">No policies configured yet.</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {policies.map((p) => (
              <PolicyCard key={p.id || p.type} policy={p} isDark={isDark} onEdit={(pol) => setEditingPolicy({
                id: pol.id, type: pol.type, amount_per_day: pol.amount_per_day || '', max_per_month: pol.max_per_month || '', eligible_roles: pol.eligible_roles || 'employee,team_lead',
              })} />
            ))}
          </div>

          {/* Edit/Add form */}
          {editingPolicy && (
            <div className={`rounded-xl border p-5 ${card}`}>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                {editingPolicy.id ? 'Edit Policy' : 'New Policy'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Type</label>
                  {editingPolicy.id ? (
                    <input type="text" value={editingPolicy.type === 'food' ? 'Food' : 'Transport'} disabled
                      className={`${input} rounded-lg px-3 py-2 text-sm border w-full opacity-60`} />
                  ) : (
                    <select value={editingPolicy.type} onChange={(e) => setEditingPolicy({ ...editingPolicy, type: e.target.value })}
                      className={`${input} rounded-lg px-3 py-2 text-sm border w-full`}>
                      <option value="food">Food</option>
                      <option value="cab">Transport</option>
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Per Day (Rs.)</label>
                  <input type="number" step="0.01" value={editingPolicy.amount_per_day}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, amount_per_day: e.target.value })}
                    className={`${input} rounded-lg px-3 py-2 text-sm border w-full`} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max / Month (Rs.)</label>
                  <input type="number" step="0.01" value={editingPolicy.max_per_month}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, max_per_month: e.target.value })}
                    className={`${input} rounded-lg px-3 py-2 text-sm border w-full`} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Eligible Roles</label>
                  <input type="text" value={editingPolicy.eligible_roles}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, eligible_roles: e.target.value })}
                    placeholder="employee,team_lead" className={`${input} rounded-lg px-3 py-2 text-sm border w-full`} />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => handleSavePolicy(editingPolicy)} disabled={savingPolicy || !editingPolicy.amount_per_day}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand hover:bg-brand-hover disabled:opacity-50">
                  {savingPolicy ? 'Saving...' : 'Save'}
                </button>
                <button type="button" onClick={() => setEditingPolicy(null)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-slate-600 hover:bg-slate-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
