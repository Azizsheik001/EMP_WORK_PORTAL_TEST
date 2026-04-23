import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function AddClientModal({ onClose, onSaved, isDark }) {
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [teamLeadId, setTeamLeadId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.departments().then((d) => setDepartments(d.departments || [])).catch(() => {});
    api.users().then((d) => setUsers(d.users || [])).catch(() => {});
  }, []);

  const teamLeads = users.filter((u) => u.role === 'team_lead');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    setSaving(true);
    try {
      await api.createClient({
        name: name.trim(),
        department_id: departmentId || null,
        team_lead_id: teamLeadId || null,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.data?.error || err.message || 'Failed to add client');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = isDark
    ? 'bg-slate-700 border-slate-600 text-white rounded-lg px-3 py-2 w-full'
    : 'bg-gray-50 border-gray-300 text-gray-900 rounded-lg px-3 py-2 w-full';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={`${isDark ? 'bg-slate-800' : 'bg-white'} rounded-xl shadow-xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Add client</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Client name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="e.g. Ameresco"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Department</label>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={inputClass}>
              <option value="">None</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Team lead</label>
            <select value={teamLeadId} onChange={(e) => setTeamLeadId(e.target.value)} className={inputClass}>
              <option value="">None</option>
              {teamLeads.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-white font-medium disabled:opacity-60 bg-brand hover:bg-brand-hover">
              {saving ? 'Adding…' : 'Add client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
