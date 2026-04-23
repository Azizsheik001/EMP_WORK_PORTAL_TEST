import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function AddMemberModal({ onClose, onSaved, isDark, clients = [], departments = [] }) {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('employee');
  const [clientId, setClientId] = useState('');
  const [teamLeadId, setTeamLeadId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [employmentType, setEmploymentType] = useState('full_time');
  const [selectedDeptIds, setSelectedDeptIds] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.users().then((data) => setUsers(data.users || [])).catch(() => setUsers([]));
  }, []);

  const teamLeads = users.filter((u) => u.role === 'team_lead');
  const managers = users.filter((u) => u.role === 'manager');

  const toggleDept = (deptId) => {
    setSelectedDeptIds((prev) =>
      prev.includes(deptId) ? prev.filter((id) => id !== deptId) : [...prev, deptId]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.createUser({
        email: email.trim(),
        password,
        name: name.trim(),
        role,
        client_id: clientId || null,
        team_lead_id: teamLeadId || null,
        manager_id: managerId || null,
        department_id: selectedDeptIds.length > 0 ? selectedDeptIds[0] : null,
        department_ids: selectedDeptIds.length > 0 ? selectedDeptIds : undefined,
        employee_id: employeeId.trim() || null,
        date_of_birth: dateOfBirth.trim() || null,
        employment_type: employmentType,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.data?.error || err.message || 'Failed to add member');
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
        <h2 className="text-lg font-semibold mb-4">Add team member</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Employee ID</label>
            <input type="text" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="e.g. AGS-001" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Date of Birth</label>
            <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Employment Type</label>
            <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} className={inputClass}>
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="intern">Intern</option>
              <option value="contract">Contract</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
              <option value="employee">Employee</option>
              <option value="team_lead">Team Lead</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin (CEO)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Departments</label>
            <div className={`border rounded-lg p-2 max-h-32 overflow-y-auto ${isDark ? 'border-slate-600 bg-slate-700' : 'border-gray-300 bg-gray-50'}`}>
              {departments.length === 0 && <p className="text-xs text-gray-500">No departments available</p>}
              {departments.map((d) => (
                <label key={d.id} className="flex items-center gap-2 py-0.5 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={selectedDeptIds.includes(d.id)}
                    onChange={() => toggleDept(d.id)}
                    className="rounded"
                  />
                  {d.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Client</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputClass}>
              <option value="">None</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Team Lead</label>
            <select value={teamLeadId} onChange={(e) => setTeamLeadId(e.target.value)} className={inputClass}>
              <option value="">None</option>
              {teamLeads.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Manager</label>
            <select value={managerId} onChange={(e) => setManagerId(e.target.value)} className={inputClass}>
              <option value="">None</option>
              {managers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-white font-medium bg-brand hover:bg-brand-hover">
              {saving ? 'Adding...' : 'Add member'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-400 dark:border-slate-500">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
