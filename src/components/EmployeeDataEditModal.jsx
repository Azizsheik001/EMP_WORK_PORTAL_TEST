import { useState, useEffect } from 'react';
import { api, hasApi } from '../api/client';

export default function EmployeeDataEditModal({ profile, balance, assets, users = [], onClose, onSaved, isDark }) {
  const [activeTab, setActiveTab] = useState('personal'); // personal, leave, assets
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Personal Info State
  const [personal, setPersonal] = useState({
    phone: profile?.phone || '',
    date_of_birth: profile?.date_of_birth ? String(profile.date_of_birth).slice(0, 10) : '',
    employment_type: profile?.employment_type || 'full_time',
    work_timezone: profile?.work_timezone || 'Asia/Kolkata',
    work_location_default: profile?.work_location_default || 'WFO',
    team_lead_id: profile?.team_lead_id || '',
    manager_id: profile?.manager_id || '',
    client_id: profile?.client_id || '',
    designation: profile?.designation || '',
  });

  // Leave Balances State
  const [leave, setLeave] = useState({
    casual: balance?.casual?.allocated ?? '',
    casual_used: balance?.casual?.used ?? '',
    sick: balance?.sick?.allocated ?? '',
    sick_used: balance?.sick?.used ?? '',
    comp: balance?.comp?.available ?? '',
    nhco: balance?.nhco?.available ?? '',
    lop: balance?.loss_of_pay?.used ?? '',
  });

  // Assets State
  const [assignedAssets, setAssignedAssets] = useState(assets || []);
  const [availableAssets, setAvailableAssets] = useState([]);
  const [fetchingAssets, setFetchingAssets] = useState(false);
  const [assigningAssetId, setAssigningAssetId] = useState('');

  const teamLeads = users.filter(u => u.role === 'team_lead' || u.role === 'manager' || u.role === 'admin');
  const managers = users.filter(u => u.role === 'manager' || u.role === 'admin');

  useEffect(() => {
    if (activeTab === 'assets' && hasApi()) {
      setFetchingAssets(true);
      api.assets.list({ status: 'available' })
        .then(data => setAvailableAssets(data.assets || []))
        .catch(() => {})
        .finally(() => setFetchingAssets(false));
    }
  }, [activeTab]);

  const handleSavePersonal = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.updateUser(profile.id, personal);
      onSaved();
    } catch (e) {
      setError(e.data?.error || e.message || 'Failed to update personal info');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveLeave = async () => {
    setLoading(true);
    setError(null);
    try {
      const year = new Date().getFullYear();
      await api.leaveRequests.adjustBalance(profile.id, {
        year,
        casual: leave.casual === '' ? null : parseFloat(leave.casual),
        casual_used: leave.casual_used === '' ? null : parseFloat(leave.casual_used),
        sick: leave.sick === '' ? null : parseFloat(leave.sick),
        sick_used: leave.sick_used === '' ? null : parseFloat(leave.sick_used),
        comp: leave.comp === '' ? null : parseFloat(leave.comp),
        nhco: leave.nhco === '' ? null : parseFloat(leave.nhco),
        lop: leave.lop === '' ? null : parseFloat(leave.lop),
      });
      onSaved();
    } catch (e) {
      setError(e.data?.error || e.message || 'Failed to update leave balances');
    } finally {
      setLoading(false);
    }
  };

  const handleAssignAsset = async () => {
    if (!assigningAssetId) return;
    setLoading(true);
    setError(null);
    try {
      await api.assets.assign(assigningAssetId, { user_id: profile.id });
      const asset = availableAssets.find(a => a.id === assigningAssetId);
      if (asset) {
        setAssignedAssets([...assignedAssets, { ...asset, status: 'assigned', current_user_id: profile.id }]);
        setAvailableAssets(availableAssets.filter(a => a.id !== assigningAssetId));
      }
      setAssigningAssetId('');
      onSaved();
    } catch (e) {
      setError(e.data?.error || e.message || 'Failed to assign asset');
    } finally {
      setLoading(false);
    }
  };

  const handleUnassignAsset = async (assetId) => {
    setLoading(true);
    setError(null);
    try {
      await api.assets.unassign(assetId);
      const asset = assignedAssets.find(a => a.id === assetId);
      if (asset) {
        setAvailableAssets([...availableAssets, { ...asset, status: 'available', current_user_id: null }]);
        setAssignedAssets(assignedAssets.filter(a => a.id !== assetId));
      }
      onSaved();
    } catch (e) {
      setError(e.data?.error || e.message || 'Failed to unassign asset');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = isDark
    ? 'w-full rounded-lg bg-slate-700 border-slate-600 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50'
    : 'w-full rounded-lg bg-white border-gray-300 text-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 border';
  
  const labelClass = `block text-xs font-semibold mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`;
  
  const tabClass = (tab) => `flex-1 py-2 text-sm font-medium text-center border-b-2 transition-colors ${activeTab === tab ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div 
        className={`w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-inherit">
          <div>
            <h2 className="text-xl font-bold">Edit Data: {profile?.name}</h2>
            <p className="text-sm text-gray-500">Update personal info, leave balances, or assigned assets</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-black/10 dark:hover:bg-white/10">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex border-b border-inherit px-5">
          <button className={tabClass('personal')} onClick={() => setActiveTab('personal')}>Personal Info</button>
          <button className={tabClass('leave')} onClick={() => setActiveTab('leave')}>Leave Balances</button>
          <button className={tabClass('assets')} onClick={() => setActiveTab('assets')}>Assets</button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-sm">{error}</div>}
          
          {activeTab === 'personal' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Phone</label>
                  <input type="text" value={personal.phone} onChange={e => setPersonal({...personal, phone: e.target.value})} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Date of Birth</label>
                  <input type="date" value={personal.date_of_birth} onChange={e => setPersonal({...personal, date_of_birth: e.target.value})} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Designation</label>
                  <input type="text" value={personal.designation} onChange={e => setPersonal({...personal, designation: e.target.value})} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Employment Type</label>
                  <select value={personal.employment_type} onChange={e => setPersonal({...personal, employment_type: e.target.value})} className={inputClass}>
                    <option value="full_time">Full Time</option>
                    <option value="part_time">Part Time</option>
                    <option value="contract">Contract</option>
                    <option value="intern">Intern</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Work Location</label>
                  <select value={personal.work_location_default} onChange={e => setPersonal({...personal, work_location_default: e.target.value})} className={inputClass}>
                    <option value="WFO">WFO</option>
                    <option value="WFH">WFH</option>
                    <option value="HYBRID">Hybrid</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Team Lead</label>
                  <select value={personal.team_lead_id} onChange={e => setPersonal({...personal, team_lead_id: e.target.value})} className={inputClass}>
                    <option value="">-- None --</option>
                    {teamLeads.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Manager</label>
                  <select value={personal.manager_id} onChange={e => setPersonal({...personal, manager_id: e.target.value})} className={inputClass}>
                    <option value="">-- None --</option>
                    {managers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex justify-end pt-4">
                <button onClick={handleSavePersonal} disabled={loading} className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium disabled:opacity-50">
                  {loading ? 'Saving...' : 'Save Personal Info'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'leave' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 mb-4">Leave empty to use automatic calculation. Fill in to set a manual override.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Casual Leave (Allocated)</label>
                  <input type="number" step="0.5" value={leave.casual} onChange={e => setLeave({...leave, casual: e.target.value})} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Casual Leave (Used)</label>
                  <input type="number" step="0.5" value={leave.casual_used} onChange={e => setLeave({...leave, casual_used: e.target.value})} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Sick Leave (Allocated)</label>
                  <input type="number" step="0.5" value={leave.sick} onChange={e => setLeave({...leave, sick: e.target.value})} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Sick Leave (Used)</label>
                  <input type="number" step="0.5" value={leave.sick_used} onChange={e => setLeave({...leave, sick_used: e.target.value})} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Comp Off (Allocated)</label>
                  <input type="number" step="0.5" value={leave.comp} onChange={e => setLeave({...leave, comp: e.target.value})} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>NHCO (Allocated)</label>
                  <input type="number" step="0.5" value={leave.nhco} onChange={e => setLeave({...leave, nhco: e.target.value})} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Loss of Pay (Used)</label>
                  <input type="number" step="0.5" value={leave.lop} onChange={e => setLeave({...leave, lop: e.target.value})} className={inputClass} />
                </div>
              </div>
              <div className="flex justify-end pt-4">
                <button onClick={handleSaveLeave} disabled={loading} className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium disabled:opacity-50">
                  {loading ? 'Saving...' : 'Save Leave Balances'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'assets' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold mb-2">Assigned Assets</h3>
                {assignedAssets.length === 0 ? (
                  <p className="text-sm text-gray-500">No assets assigned.</p>
                ) : (
                  <ul className="space-y-2">
                    {assignedAssets.map(a => (
                      <li key={a.id} className="flex items-center justify-between p-3 rounded-lg border border-inherit bg-gray-50 dark:bg-slate-700/50">
                        <div>
                          <p className="text-sm font-medium">{a.brand} {a.model}</p>
                          <p className="text-xs text-gray-500">{a.asset_tag || a.serial_number}</p>
                        </div>
                        <button onClick={() => handleUnassignAsset(a.id)} disabled={loading} className="px-3 py-1 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 disabled:opacity-50">
                          Unassign
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              
              <div className="pt-4 border-t border-inherit">
                <h3 className="text-sm font-semibold mb-2">Assign New Asset</h3>
                <div className="flex items-center gap-2">
                  <select 
                    value={assigningAssetId} 
                    onChange={e => setAssigningAssetId(e.target.value)} 
                    className={inputClass}
                    disabled={fetchingAssets}
                  >
                    <option value="">{fetchingAssets ? 'Loading...' : '-- Select Asset --'}</option>
                    {availableAssets.map(a => (
                      <option key={a.id} value={a.id}>{a.brand} {a.model} ({a.asset_tag || a.serial_number})</option>
                    ))}
                  </select>
                  <button 
                    onClick={handleAssignAsset} 
                    disabled={loading || !assigningAssetId} 
                    className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium disabled:opacity-50 whitespace-nowrap"
                  >
                    {loading ? 'Assigning...' : 'Assign'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
