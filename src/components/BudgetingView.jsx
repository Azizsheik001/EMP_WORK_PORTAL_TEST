import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

// -- Helpers ------------------------------------------------------------------

function formatCurrency(v) {
  if (v == null) return '₹0.00';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(v);
}

function formatDate(d) {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function utilColor(pct) {
  if (pct > 90) return 'text-red-600 dark:text-red-400';
  if (pct > 70) return 'text-amber-600 dark:text-amber-400';
  return 'text-green-600 dark:text-green-400';
}

function barColor(pct) {
  if (pct > 90) return 'bg-red-500';
  if (pct > 70) return 'bg-amber-500';
  return 'bg-brand';
}

// -- Main Component -----------------------------------------------------------

export default function BudgetingView({ isDark, currentUser, showToast, departments = [], clients = [] }) {
  const [budgets, setBudgets] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', department_id: '', client_id: '', period_start: '', period_end: '', allocated_amount: '', notes: '' });
  const [saving, setSaving] = useState(false);

  // Expanded budget (accordion)
  const [expandedId, setExpandedId] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [expForm, setExpForm] = useState({ description: '', amount: '', expense_date: new Date().toISOString().slice(0, 10), category: '' });

  const card = isDark ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200 shadow-sm';
  const input = isDark
    ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400 focus:border-brand focus:ring-brand'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-brand focus:ring-brand';

  // -- Fetch ------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [budgetData, summaryData] = await Promise.all([
        api.budgeting.list(),
        api.budgeting.summary(),
      ]);
      setBudgets(budgetData.budgets || []);
      setSummary(summaryData);
    } catch (e) {
      if (e.status !== 401) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchExpenses = useCallback(async (budgetId) => {
    setLoadingExpenses(true);
    try {
      const data = await api.budgeting.expenses(budgetId);
      setExpenses(data.expenses || []);
    } catch {
      setExpenses([]);
    } finally {
      setLoadingExpenses(false);
    }
  }, []);

  // -- Actions ----------------------------------------------------------------

  const handleCreate = async () => {
    if (!form.name || !form.allocated_amount || !form.period_start || !form.period_end) return;
    setSaving(true);
    try {
      await api.budgeting.create({
        name: form.name,
        department_id: form.department_id || null,
        client_id: form.client_id || null,
        period_start: form.period_start,
        period_end: form.period_end,
        allocated_amount: parseFloat(form.allocated_amount),
        notes: form.notes || null,
      });
      setForm({ name: '', department_id: '', client_id: '', period_start: '', period_end: '', allocated_amount: '', notes: '' });
      setShowForm(false);
      fetchData();
      showToast?.('Budget created', 'success');
    } catch (e) {
      if (e.status !== 401) showToast?.(e.message || 'Failed to create budget', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.budgeting.remove(id);
      if (expandedId === id) { setExpandedId(null); setExpenses([]); }
      fetchData();
      showToast?.('Budget deleted', 'success');
    } catch (e) {
      if (e.status !== 401) showToast?.(e.message || 'Failed to delete', 'error');
    }
  };

  const handleAddExpense = async () => {
    if (!expandedId || !expForm.description || !expForm.amount) return;
    try {
      await api.budgeting.addExpense(expandedId, {
        description: expForm.description,
        amount: parseFloat(expForm.amount),
        expense_date: expForm.expense_date,
        category: expForm.category || null,
      });
      setExpForm({ description: '', amount: '', expense_date: new Date().toISOString().slice(0, 10), category: '' });
      fetchExpenses(expandedId);
      fetchData();
      showToast?.('Expense added', 'success');
    } catch (e) {
      if (e.status !== 401) showToast?.(e.message || 'Failed to add expense', 'error');
    }
  };

  const toggleExpand = (b) => {
    if (expandedId === b.id) {
      setExpandedId(null);
      setExpenses([]);
    } else {
      setExpandedId(b.id);
      fetchExpenses(b.id);
    }
  };

  // -- Derived ----------------------------------------------------------------

  const totalAllocated = summary?.total_allocated ?? 0;
  const totalSpent = summary?.total_spent ?? 0;
  const utilPct = totalAllocated > 0 ? Math.min(100, (totalSpent / totalAllocated) * 100) : 0;

  // -- Loading / Error --------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Budget Overview</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Financial planning and expense tracking</p>
        </div>
        <button type="button" onClick={() => setShowForm(!showForm)}
          className="w-full sm:w-auto px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium transition-colors">
          {showForm ? 'Cancel' : '+ New Budget'}
        </button>
      </div>

      {error && (
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button type="button" onClick={fetchData} className="mt-2 text-xs text-brand hover:text-brand-hover font-medium">Retry</button>
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className={`rounded-xl border p-5 ${card}`}>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">Total Allocated</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{formatCurrency(totalAllocated)}</p>
          </div>
          <div className={`rounded-xl border p-5 ${card}`}>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">Total Spent</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{formatCurrency(totalSpent)}</p>
          </div>
          <div className={`rounded-xl border p-5 ${card}`}>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">Utilization</p>
            <p className={`text-2xl font-bold mt-1 ${utilColor(utilPct)}`}>{utilPct.toFixed(1)}%</p>
            <div className={`w-full h-1.5 rounded-full mt-2 ${isDark ? 'bg-slate-600' : 'bg-gray-200'}`}>
              <div className={`h-1.5 rounded-full transition-all ${barColor(utilPct)}`} style={{ width: `${utilPct}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Create Budget Form */}
      {showForm && (
        <div className={`rounded-xl border p-5 space-y-4 ${card}`}>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Create New Budget</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Budget Name</label>
              <input placeholder="e.g., Q1 Operations" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={`${input} rounded-lg px-3 py-2 text-sm border w-full`} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Allocated Amount (Rs.)</label>
              <input placeholder="0.00" type="number" step="0.01" value={form.allocated_amount}
                onChange={(e) => setForm({ ...form, allocated_amount: e.target.value })}
                className={`${input} rounded-lg px-3 py-2 text-sm border w-full`} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Department (optional)</label>
              <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}
                className={`${input} rounded-lg px-3 py-2 text-sm border w-full`}>
                <option value="">None</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Client (optional)</label>
              <select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                className={`${input} rounded-lg px-3 py-2 text-sm border w-full`}>
                <option value="">None</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Period Start</label>
              <input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })}
                className={`${input} rounded-lg px-3 py-2 text-sm border w-full`} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Period End</label>
              <input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })}
                className={`${input} rounded-lg px-3 py-2 text-sm border w-full`} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Notes (optional)</label>
            <textarea placeholder="Additional details about this budget..." value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={`${input} rounded-lg px-3 py-2 text-sm border w-full`} rows={2} />
          </div>
          <button type="button" onClick={handleCreate}
            disabled={saving || !form.name || !form.allocated_amount || !form.period_start || !form.period_end}
            className="px-5 py-2 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-sm font-medium">
            {saving ? 'Creating...' : 'Create Budget'}
          </button>
        </div>
      )}

      {/* Budget List (Card-based with accordion) */}
      <div className="space-y-3">
        {budgets.length === 0 ? (
          <div className={`rounded-xl border p-8 text-center ${card}`}>
            <p className="text-sm text-gray-500 dark:text-gray-400">No budgets created yet. Click "+ New Budget" to get started.</p>
          </div>
        ) : budgets.map((b) => {
          const spent = b.spent_amount || 0;
          const allocated = b.allocated_amount || 0;
          const pct = allocated > 0 ? Math.min(100, (spent / allocated) * 100) : 0;
          const isExpanded = expandedId === b.id;

          return (
            <div key={b.id} className={`rounded-xl border overflow-hidden transition-all ${card}`}>
              {/* Budget Header */}
              <div className="p-4 cursor-pointer" onClick={() => toggleExpand(b)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-gray-900 dark:text-white text-sm">{b.name}</h3>
                      {b.department_name && (
                        <span className="px-1.5 py-0.5 rounded bg-brand/10 text-brand text-[10px] font-medium">{b.department_name}</span>
                      )}
                      {b.client_name && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-medium">{b.client_name}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {formatDate(b.period_start)} - {formatDate(b.period_end)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(b.id); }}
                      className="text-[10px] text-red-500 hover:text-red-600 font-medium">Delete</button>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Progress */}
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-700 dark:text-gray-300">
                      {formatCurrency(spent)} <span className="text-gray-400">of</span> {formatCurrency(allocated)}
                    </span>
                    <span className={`text-xs font-medium ${utilColor(pct)}`}>{pct.toFixed(0)}%</span>
                  </div>
                  <div className={`w-full h-1.5 rounded-full ${isDark ? 'bg-slate-600' : 'bg-gray-200'}`}>
                    <div className={`h-1.5 rounded-full transition-all ${barColor(pct)}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>

              {/* Expanded: Expenses */}
              {isExpanded && (
                <div className={`border-t px-4 py-4 space-y-3 ${isDark ? 'border-slate-600 bg-slate-700/30' : 'border-gray-200 bg-gray-50'}`}>
                  {/* Add Expense Form */}
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[140px]">
                      <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Description</label>
                      <input placeholder="What was this for?" value={expForm.description}
                        onChange={(e) => setExpForm({ ...expForm, description: e.target.value })}
                        className={`${input} rounded-lg px-3 py-1.5 text-xs border w-full`} />
                    </div>
                    <div className="w-24">
                      <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Amount</label>
                      <input placeholder="0.00" type="number" step="0.01" value={expForm.amount}
                        onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })}
                        className={`${input} rounded-lg px-3 py-1.5 text-xs border w-full`} />
                    </div>
                    <div className="w-36">
                      <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Date</label>
                      <input type="date" value={expForm.expense_date}
                        onChange={(e) => setExpForm({ ...expForm, expense_date: e.target.value })}
                        className={`${input} rounded-lg px-3 py-1.5 text-xs border w-full`} />
                    </div>
                    <div className="w-28">
                      <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Category</label>
                      <input placeholder="Optional" value={expForm.category}
                        onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}
                        className={`${input} rounded-lg px-3 py-1.5 text-xs border w-full`} />
                    </div>
                    <button type="button" onClick={handleAddExpense}
                      disabled={!expForm.description || !expForm.amount}
                      className="px-4 py-1.5 rounded-lg bg-brand text-white text-xs font-medium disabled:opacity-50 hover:bg-brand-hover">
                      Add
                    </button>
                  </div>

                  {/* Expense List */}
                  {loadingExpenses ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400 py-2">Loading expenses...</p>
                  ) : expenses.length === 0 ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400 py-2">No expenses recorded yet.</p>
                  ) : (
                    <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                      <table className="w-full min-w-full text-xs">
                        <thead>
                          <tr className={`border-b ${isDark ? 'border-slate-600' : 'border-gray-200'}`}>
                            <th className="text-left py-1.5 font-medium text-gray-500 dark:text-gray-400">Description</th>
                            <th className="text-left py-1.5 font-medium text-gray-500 dark:text-gray-400">Category</th>
                            <th className="text-left py-1.5 font-medium text-gray-500 dark:text-gray-400">Date</th>
                            <th className="text-right py-1.5 font-medium text-gray-500 dark:text-gray-400">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expenses.map((exp) => (
                            <tr key={exp.id} className={`border-b ${isDark ? 'border-slate-700' : 'border-gray-100'}`}>
                              <td className="py-1.5 text-gray-900 dark:text-white">{exp.description}</td>
                              <td className="py-1.5 text-gray-500 dark:text-gray-400">{exp.category || '--'}</td>
                              <td className="py-1.5 text-gray-500 dark:text-gray-400">{formatDate(exp.expense_date)}</td>
                              <td className="py-1.5 text-right font-medium text-gray-900 dark:text-white">{formatCurrency(exp.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
