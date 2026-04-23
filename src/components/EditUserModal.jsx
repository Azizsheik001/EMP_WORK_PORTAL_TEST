import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function EditUserModal({ user, onClose, onSaved, isDark, clients = [] }) {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState(user?.email || '');
  const [name, setName] = useState(user?.name || '');
  const [role, setRole] = useState(user?.role || 'employee');
  const [departments, setDepartments] = useState([]);
  const [departmentIds, setDepartmentIds] = useState([]);
  const [clientIds, setClientIds] = useState([]);
  const [managerIds, setManagerIds] = useState([]);
  const [teamLeadIds, setTeamLeadIds] = useState([]);
  const [dateOfBirth, setDateOfBirth] = useState(user?.date_of_birth ? String(user.date_of_birth).slice(0, 10) : '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [designation, setDesignation] = useState(user?.designation || '');
  const [employeeId, setEmployeeId] = useState(user?.employee_id || '');
  const [employmentType, setEmploymentType] = useState(user?.employment_type || 'full_time');
  const [workLocation, setWorkLocation] = useState(user?.work_location_default || 'wfo');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEmail(user?.email || '');
    setName(user?.name || '');
    setRole(user?.role || 'employee');
    setDateOfBirth(user?.date_of_birth ? String(user.date_of_birth).slice(0, 10) : '');
    setPhone(user?.phone || '');
    setDesignation(user?.designation || '');
    setEmployeeId(user?.employee_id || '');
    setEmploymentType(user?.employment_type || 'full_time');
    setWorkLocation(user?.work_location_default || 'wfo');
  }, [user]);

  useEffect(() => {
    api.users().then((data) => setUsers(data.users || [])).catch(() => setUsers([]));
    api.departments().then((data) => {
      const list = Array.isArray(data) ? data : data.departments || [];
      setDepartments(list);
    }).catch(() => setDepartments([]));

    if (user?.id) {
      api.getUserMultiAssignments().then((data) => {
        const uid = user.id;
        setDepartmentIds((data.user_departments || []).filter((r) => r.user_id === uid).map((r) => r.department_id));
        setClientIds((data.user_clients || []).filter((r) => r.user_id === uid).map((r) => r.client_id));
        setManagerIds((data.user_managers || []).filter((r) => r.user_id === uid).map((r) => r.manager_id));
        setTeamLeadIds((data.user_team_leads || []).filter((r) => r.user_id === uid).map((r) => r.team_lead_id));
      }).catch(() => {
        setClientIds(user.client_id ? [user.client_id] : []);
        setManagerIds(user.manager_id ? [user.manager_id] : []);
        setTeamLeadIds(user.team_lead_id ? [user.team_lead_id] : []);
        setDepartmentIds(user.department_id ? [user.department_id] : []);
      });
    }
  }, [user]);

  const teamLeads = users.filter((u) => u.role === 'team_lead' && u.id !== user?.id);
  const managers = users.filter((u) => u.role === 'manager' && u.id !== user?.id);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user?.id) return;
    setError('');
    setSaving(true);
    try {
      const body = {
        email: email.trim(),
        name: name.trim(),
        role,
        client_id: clientIds[0] || null,
        team_lead_id: teamLeadIds[0] || null,
        manager_id: managerIds[0] || null,
        department_id: departmentIds[0] || null,
        date_of_birth: dateOfBirth.trim() || null,
        phone: phone.trim() || null,
        designation: designation.trim() || null,
        employee_id: employeeId.trim() || null,
        employment_type: employmentType || null,
        work_location_default: workLocation || 'wfo',
      };
      if (newPassword.trim().length >= 6) body.password = newPassword;
      await api.updateUser(user.id, body);
      await api.saveUserMultiAssignments(user.id, {
        department_ids: departmentIds,
        client_ids: clientIds,
        manager_ids: managerIds,
        team_lead_ids: teamLeadIds,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.data?.error || err.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = isDark
    ? 'bg-slate-700 border-slate-600 text-white rounded-lg px-3 py-2 w-full'
    : 'bg-gray-50 border-gray-300 text-gray-900 rounded-lg px-3 py-2 w-full';

  const checkboxContainerClass = isDark
    ? 'border-slate-600 bg-slate-700'
    : 'border-gray-300 bg-gray-50';

  const MultiSelect = ({ label, options, selectedIds, setSelectedIds, nameKey = 'name' }) => (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <div className={`border rounded-lg max-h-32 overflow-y-auto p-2 ${checkboxContainerClass}`}>
        {options.length === 0 && <p className="text-xs text-gray-400">No {label.toLowerCase()}</p>}
        {options.map((item) => (
          <label key={item.id} className="flex items-center gap-2 py-0.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={selectedIds.includes(item.id)}
              onChange={(e) => {
                if (e.target.checked) setSelectedIds((prev) => [...prev, item.id]);
                else setSelectedIds((prev) => prev.filter((id) => id !== item.id));
              }}
              className="rounded"
            />
            {item[nameKey]}
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={`${isDark ? 'bg-slate-800' : 'bg-white'} rounded-xl shadow-xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">Edit employee</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Employee ID</label>
            <input type="text" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="e.g. AGS-001" className={inputClass} />
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
            <label className="block text-sm font-medium mb-1">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
              <option value="employee">Employee</option>
              <option value="team_lead">Team Lead</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin (CEO)</option>
            </select>
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
            <label className="block text-sm font-medium mb-1">Work Location Default</label>
            <select value={workLocation} onChange={(e) => setWorkLocation(e.target.value)} className={inputClass}>
              <option value="wfo">Work from Office (WFO)</option>
              <option value="wfh">Work from Home (WFH)</option>
            </select>
          </div>
          <MultiSelect
            label="Departments"
            options={departments}
            selectedIds={departmentIds}
            setSelectedIds={setDepartmentIds}
          />
          <MultiSelect
            label="Clients"
            options={clients}
            selectedIds={clientIds}
            setSelectedIds={setClientIds}
          />
          <MultiSelect
            label="Team Leads"
            options={teamLeads}
            selectedIds={teamLeadIds}
            setSelectedIds={setTeamLeadIds}
          />
          <MultiSelect
            label="Managers"
            options={managers}
            selectedIds={managerIds}
            setSelectedIds={setManagerIds}
          />
          <div>
            <label className="block text-sm font-medium mb-1">Date of birth</label>
            <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. +1 234 567 8900" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Designation</label>
            <input type="text" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Field Technician" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">New password (optional)</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} placeholder="Leave blank to keep current" className={inputClass} />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-white font-medium bg-brand hover:bg-brand-hover">
              {saving ? 'Saving\u2026' : 'Save'}
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
