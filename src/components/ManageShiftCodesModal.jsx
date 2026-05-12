import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function ManageShiftCodesModal({ isOpen, onClose, isDark, showToast, onCodesUpdated }) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  
  // Form state
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [shiftCode, setShiftCode] = useState('');

  const fetchCodes = async () => {
    try {
      setLoading(true);
      const data = await api.shiftCodes.list();
      setCodes(data || []);
    } catch (err) {
      if (showToast) showToast('Failed to load shift codes', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCodes();
      resetForm();
    }
  }, [isOpen]);

  const resetForm = () => {
    setEditingId(null);
    setStartTime('');
    setEndTime('');
    setShiftCode('');
  };

  const handleEdit = (c) => {
    setEditingId(c.id);
    setStartTime(c.start_time);
    setEndTime(c.end_time);
    setShiftCode(c.shift_code);
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this shift code?')) return;
    try {
      await api.shiftCodes.remove(id);
      if (showToast) showToast('Shift code deleted');
      await fetchCodes();
      if (onCodesUpdated) onCodesUpdated();
    } catch (err) {
      if (showToast) showToast('Failed to delete shift code', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!startTime || !endTime || !shiftCode) {
      if (showToast) showToast('Please fill all fields', 'error');
      return;
    }
    
    // Format times to ensure HH:MM
    const formatTime = (t) => t.length === 5 ? t : (t.length === 4 ? `0${t}` : t);
    
    try {
      await api.shiftCodes.save({
        start_time: formatTime(startTime),
        end_time: formatTime(endTime),
        shift_code: shiftCode.toUpperCase()
      });
      if (showToast) showToast('Shift code saved successfully');
      resetForm();
      await fetchCodes();
      if (onCodesUpdated) onCodesUpdated();
    } catch (err) {
      if (showToast) showToast(err.message || 'Failed to save shift code', 'error');
    }
  };

  const formatTimeAMPM = (time24) => {
    if (!time24) return '';
    const [hStr, mStr] = time24.split(':');
    let h = parseInt(hStr, 10);
    const m = mStr;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  };

  if (!isOpen) return null;

  const bgClass = isDark ? 'bg-slate-800 text-white' : 'bg-white text-gray-900';
  const borderClass = isDark ? 'border-slate-700' : 'border-gray-200';
  const inputClass = isDark
    ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400 focus:border-brand focus:ring-brand'
    : 'bg-white border-gray-300 text-gray-900 focus:border-brand focus:ring-brand';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`relative w-full max-w-2xl rounded-2xl shadow-xl flex flex-col max-h-[90vh] ${bgClass}`}>
        <div className={`flex items-center justify-between p-5 border-b ${borderClass}`}>
          <h2 className="text-xl font-bold">Manage Shift Codes</h2>
          <button onClick={onClose} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {/* Add / Edit Form */}
          <form onSubmit={handleSubmit} className={`p-4 rounded-xl border mb-6 ${borderClass} ${isDark ? 'bg-slate-800/50' : 'bg-gray-50'}`}>
            <h3 className="text-sm font-semibold mb-3">{editingId ? 'Edit Shift Code' : 'Add New Shift Code'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Start Time (HH:MM)</label>
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-sm ${inputClass}`} required />
              </div>
              <div>
                <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>End Time (HH:MM)</label>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-sm ${inputClass}`} required />
              </div>
              <div>
                <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Shift Code (e.g. AGS1)</label>
                <input type="text" value={shiftCode} onChange={e => setShiftCode(e.target.value)} placeholder="AGS1" className={`w-full rounded-lg border px-3 py-2 text-sm uppercase ${inputClass}`} required />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              {editingId && (
                <button type="button" onClick={resetForm} className={`px-4 py-2 text-sm font-medium rounded-lg border ${isDark ? 'border-slate-600 hover:bg-slate-700' : 'border-gray-300 hover:bg-gray-100'}`}>
                  Cancel
                </button>
              )}
              <button type="submit" className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand/90 transition-colors">
                {editingId ? 'Update Code' : 'Add Code'}
              </button>
            </div>
          </form>

          {/* List */}
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : (
            <div className={`rounded-xl border overflow-hidden ${borderClass}`}>
              <table className="w-full text-sm text-left">
                <thead className={`text-xs uppercase bg-gray-50 dark:bg-slate-700/50 border-b ${borderClass}`}>
                  <tr>
                    <th className="px-4 py-3 font-semibold">Start Time</th>
                    <th className="px-4 py-3 font-semibold">End Time</th>
                    <th className="px-4 py-3 font-semibold">Shift Code</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {codes.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-3 font-mono">{formatTimeAMPM(c.start_time)}</td>
                      <td className="px-4 py-3 font-mono">{formatTimeAMPM(c.end_time)}</td>
                      <td className="px-4 py-3 font-medium text-brand">{c.shift_code}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => handleEdit(c)} className="text-blue-500 hover:text-blue-600 mr-3 text-xs font-medium">Edit</button>
                        <button onClick={() => handleDelete(c.id)} className="text-red-500 hover:text-red-600 text-xs font-medium">Delete</button>
                      </td>
                    </tr>
                  ))}
                  {codes.length === 0 && (
                    <tr>
                      <td colSpan="4" className="px-4 py-8 text-center text-gray-500">No shift codes found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
