import { useState, useEffect } from 'react';
import { api, hasApi } from '../api/client';

export default function PendingChangesView({ isDark, currentUser }) {
  const [pendingChanges, setPendingChanges] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchPending = async () => {
    if (!hasApi()) return setLoading(false);
    try {
      const res = await fetch('/api/pending-changes', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPendingChanges(data.pending_changes || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPending();
  }, []);

  const handleApprove = async (id) => {
    try {
      const res = await fetch(`/api/pending-changes/${id}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        setPendingChanges((prev) => prev.filter((p) => p.id !== id));
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to approve');
      }
    } catch (e) {
      alert('Error approving change');
    }
  };

  const handleReject = async (id) => {
    try {
      const res = await fetch(`/api/pending-changes/${id}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        setPendingChanges((prev) => prev.filter((p) => p.id !== id));
      }
    } catch (e) {
      alert('Error rejecting change');
    }
  };

  if (loading) return <div className="text-sm p-4">Loading pending updates...</div>;
  if (pendingChanges.length === 0) return null; // Hide if nothing pending

  const cardClass = isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200';
  const rowClass = isDark ? 'border-slate-700' : 'border-gray-100';

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        Data Updates Awaiting Approval
        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
          {pendingChanges.length}
        </span>
      </h2>
      <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
        <ul className="divide-y divide-gray-100 dark:divide-slate-700">
          {pendingChanges.map((req) => {
            const payload = req.payload || {};
            return (
              <li key={req.id} className={`p-4 ${rowClass}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize text-sm">{req.module}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 rounded text-gray-600 dark:text-gray-300 font-mono">
                        {req.action}
                      </span>
                    </div>
                    <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">
                      Requested by <span className="font-medium text-gray-900 dark:text-gray-200">{req.requested_by_name}</span>
                    </p>
                    <pre className="mt-2 text-[10px] p-2 bg-gray-50 dark:bg-slate-900 rounded border border-gray-100 dark:border-slate-700 overflow-x-auto max-w-2xl">
                      {JSON.stringify(payload.body, null, 2)}
                    </pre>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleReject(req.id)}
                      className="px-3 py-1.5 rounded bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-sm font-medium transition-colors"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApprove(req.id)}
                      className="px-3 py-1.5 rounded bg-brand text-white hover:bg-brand-hover text-sm font-medium transition-colors"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
