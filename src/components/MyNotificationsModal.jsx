import { useState, useEffect } from 'react';
import useModalKeyboard from '../hooks/useModalKeyboard';
import { api, hasApi } from '../api/client';

export default function MyNotificationsModal({
  isOpen,
  onClose,
  isDark,
}) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState('all');

  const modalRef = useModalKeyboard(isOpen, onClose);

  useEffect(() => {
    if (isOpen && hasApi()) {
      setLoading(true);
      fetch('/api/notifications', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('ags_token')}` }
      })
      .then(res => res.json())
      .then(data => {
        setNotifications(data.notifications || []);
      })
      .catch(err => console.error('Failed to load notifications:', err))
      .finally(() => setLoading(false));
    }
  }, [isOpen]);

  const handleDownload = () => {
    const filtered = filterType === 'all' 
      ? notifications 
      : notifications.filter(n => n.type === filterType);
      
    if (filtered.length === 0) return;

    const headers = ['Date', 'Type', 'Title', 'Message', 'Read'];
    const csvContent = [
      headers.join(','),
      ...filtered.map(n => {
        return [
          `"${new Date(n.created_at).toLocaleString()}"`,
          `"${n.type}"`,
          `"${n.title}"`,
          `"${n.message.replace(/"/g, '""')}"`,
          `"${n.is_read ? 'Yes' : 'No'}"`
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `My_Notifications_${filterType}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const markAsRead = async (id) => {
    if (!hasApi()) return;
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('ags_token')}` }
      });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) {
      console.error(err);
    }
  };

  if (!isOpen) return null;

  const panelClass = isDark ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-gray-200 text-gray-900';
  
  const filteredNotifications = filterType === 'all' 
    ? notifications 
    : notifications.filter(n => n.type === filterType);

  const types = [...new Set(notifications.map(n => n.type))];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div
        ref={modalRef}
        className={`w-full max-w-2xl ${panelClass} rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-6 border-b border-inherit flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
          <h2 className="text-xl font-bold">My Notifications</h2>
          <div className="flex gap-2 w-full sm:w-auto">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className={`flex-1 sm:w-auto rounded-lg border px-3 py-1.5 text-sm ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
            >
              <option value="all">All Types</option>
              {types.map(t => (
                <option key={t} value={t}>{t.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleDownload}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-brand hover:bg-brand-hover text-white flex items-center gap-1.5"
              title="Download CSV"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download
            </button>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10" aria-label="Close">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50 dark:bg-slate-900/50">
          {loading ? (
            <p className="text-center text-sm text-gray-500 py-4">Loading notifications...</p>
          ) : filteredNotifications.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-4">No notifications found.</p>
          ) : (
            <div className="space-y-3">
              {filteredNotifications.map((n) => (
                <div 
                  key={n.id} 
                  className={`p-4 rounded-xl border ${!n.is_read ? (isDark ? 'border-brand/50 bg-brand/10' : 'border-brand/30 bg-brand/5') : (isDark ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white')}`}
                >
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <h3 className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{n.title}</h3>
                      <p className={`text-sm mt-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{n.message}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${isDark ? 'bg-slate-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                          {n.type.replace('_', ' ')}
                        </span>
                        <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {new Date(n.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    {!n.is_read && (
                      <button
                        onClick={() => markAsRead(n.id)}
                        className="text-xs px-2 py-1 rounded text-brand hover:bg-brand/10 font-medium flex-shrink-0"
                      >
                        Mark Read
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
