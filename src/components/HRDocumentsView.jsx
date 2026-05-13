import { useState, useEffect, useCallback, useRef } from 'react';
import { api, hasApi } from '../api/client';

const isHRManager = (u) =>
  u?.type === 'admin' || (u?.type === 'manager' && ['hr', 'finance'].includes((u?.department_name || '').toLowerCase()));

const CATEGORIES = [
  { id: 'nda', label: 'NDA / Legal' },
  { id: 'policy', label: 'Policy' },
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'general', label: 'General' },
];
const CAT_PILL = {
  nda: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  policy: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  onboarding: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  general: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-300',
};
const fmtDate = (d) => { try { return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; } catch { return '—'; } };
const fileIcon = (t = '') => t.includes('pdf') ? '' : t.includes('word') || t.includes('document') ? '' : t.includes('sheet') || t.includes('excel') ? '' : t.includes('image') ? '' : '';

/* ── Form Modal ── */
function DocForm({ isDark, doc, currentUser, onClose, onSave }) {
  const [form, setForm] = useState({
    title: doc?.title || '', description: doc?.description || '',
    category: doc?.category || 'general', visible_to: doc?.visible_to || 'all',
    show_to_new_users: doc?.show_to_new_users ?? true,
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40 ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`;

  const handleSave = async () => {
    if (!form.title.trim()) { setErr('Title is required.'); return; }
    setSaving(true); setErr('');
    try {
      let fd = doc?.file_data || '', fn = doc?.file_name || '', ft = doc?.file_type || '';
      if (file) {
        fd = await new Promise((r, j) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = j; fr.readAsDataURL(file); });
        fn = file.name; ft = file.type;
      }
      const payload = {
        ...form, file_data: fd, file_name: fn, file_type: ft,
        created_by: currentUser?.id, created_by_name: currentUser?.name || 'Admin'
      };
      doc?.id ? await api.hrDocuments.update(doc.id, payload) : await api.hrDocuments.create(payload);
      onSave();
    } catch (e) { setErr(e.message || 'Save failed.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[90vh] ${isDark ? 'bg-slate-800 border border-slate-700' : 'bg-white'}`}>
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
          <h3 className={`text-base font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{doc ? 'Edit Document' : 'New Document'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className={`block text-xs font-semibold mb-1 uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Title *</label>
            <input className={inputCls} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Document title" />
          </div>
          <div>
            <label className={`block text-xs font-semibold mb-1 uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Description</label>
            <textarea className={`${inputCls} resize-none`} rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Brief description…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-xs font-semibold mb-1 uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Category</label>
              <select className={inputCls} value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className={`block text-xs font-semibold mb-1 uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Visible To</label>
              <select className={inputCls} value={form.visible_to} onChange={e => set('visible_to', e.target.value)}>
                <option value="all">All Employees</option>
                <option value="admin">Admins Only</option>
                <option value="employee">Employees Only</option>
              </select>
            </div>
          </div>
          <div>
            <label className={`block text-xs font-semibold mb-1 uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {doc?.file_name ? `Replace File (${doc.file_name})` : 'Attach File (PDF, Word, Excel, Image)'}
            </label>
            <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className={inputCls + ' cursor-pointer file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-brand/10 file:text-brand'} />
          </div>
          <label className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer ${form.show_to_new_users ? isDark ? 'border-brand/50 bg-brand/10' : 'border-brand/30 bg-brand/5' : isDark ? 'border-slate-600' : 'border-gray-200'}`}>
            <input type="checkbox" checked={form.show_to_new_users} onChange={e => set('show_to_new_users', e.target.checked)} className="h-4 w-4 accent-brand" />
            <div>
              <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Show to new users on login</p>
              <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Highlighted in the Documents section for new employees.</p>
            </div>
          </label>
          {err && <p className="text-sm text-red-500">{err}</p>}
        </div>
        <div className={`flex justify-end gap-2 px-6 py-4 border-t ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
          <button onClick={onClose} className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'} transition-colors`}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-lg text-sm font-semibold bg-brand text-white hover:bg-brand/90 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : doc ? 'Save Changes' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Delete Confirm ── */
function DeleteConfirm({ isDark, doc, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full max-w-sm rounded-2xl shadow-2xl p-6 ${isDark ? 'bg-slate-800 border border-slate-700' : 'bg-white'}`}>
        <div className="w-11 h-11 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
          <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        </div>
        <h3 className={`text-base font-bold text-center ${isDark ? 'text-white' : 'text-gray-900'}`}>Delete "{doc.title}"?</h3>
        <p className={`text-sm text-center mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>This cannot be undone.</p>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className={`flex-1 py-2 rounded-lg text-sm font-medium border ${isDark ? 'border-slate-600 text-gray-300 hover:bg-slate-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'} transition-colors`}>Cancel</button>
          <button disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); }} className="flex-1 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── File Preview Modal ── */
function PreviewModal({ isDark, doc, onClose }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className={`w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] ${isDark ? 'bg-slate-800 border border-slate-700' : 'bg-white'}`} onClick={e => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-6 py-3 border-b ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
          <p className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{fileIcon(doc.file_type)} {doc.title}</p>
          <div className="flex items-center gap-2">
            <a href={doc.file_data} download={doc.file_name} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand text-white hover:bg-brand/90 transition-colors">⬇ Download</a>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {doc.file_type?.includes('image') ? <img src={doc.file_data} alt={doc.title} className="w-full object-contain" />
            : doc.file_type?.includes('pdf') ? <iframe src={doc.file_data} title={doc.title} className="w-full h-[72vh]" />
              : <div className="py-20 text-center"><p className="text-4xl mb-3">{fileIcon(doc.file_type)}</p><p className={`font-medium ${isDark ? 'text-white' : 'text-gray-800'}`}>{doc.file_name}</p><p className={`text-sm mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Preview not available — use Download.</p></div>}
        </div>
      </div>
    </div>
  );
}

/* ── Main View ── */
export default function HRDocumentsView({ isDark, currentUser, onEditNdaForm }) {
  const canEdit = isHRManager(currentUser);
  const role = currentUser?.type;

  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFCat] = useState('all');
  const [formOpen, setForm] = useState(false);
  const [editDoc, setEditDoc] = useState(null);
  const [delDoc, setDelDoc] = useState(null);
  const [preview, setPreview] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.hrDocuments.list();
      let hrDocs = r.documents || [];

      if (hasApi()) {
        try {
          const r = await api.nda.getAllTemplates();
          if (r && r.templates && r.templates.length > 0) {
            const templateDocs = r.templates.map(t => ({
              id: t.id,
              title: t.name || 'Document Template',
              description: t.description || 'Interactive document template.',
              category: t.category || 'nda',
              visible_to: 'all',
              show_to_new_users: !!t.show_to_new_users,
              created_by_name: 'Admin',
              created_at: t.created_at || new Date().toISOString(),
              file_data: t.file_url,
              file_type: 'application/pdf',
              file_name: `${t.name || 'Template'}.pdf`,
              is_nda_template: true,
            }));
            hrDocs = [...templateDocs, ...hrDocs];
          }
        } catch (e) {
          console.error("Failed to fetch interactive templates", e);
        }

        try {
          const r = canEdit
            ? await api.nda.getAllCompleted()
            : await api.nda.getEmployeeDocuments(currentUser.id);
          
          if (r && r.ndas) {
            const completedNdas = r.ndas.filter(n => n.status === 'completed' && n.final_pdf_path);
            const completedDocs = completedNdas.map(n => ({
              id: 'completed_nda_' + n.id,
              title: `Signed Document - ${n.employee_name}`,
              description: 'Fully executed and signed document.',
              category: 'nda',
              visible_to: 'all',
              show_to_new_users: false,
              created_by_name: 'System',
              created_at: n.completed_at || n.created_at,
              file_type: 'application/pdf',
              file_name: `Signed_${n.employee_name.replace(/\s+/g, '_')}.pdf`,
              is_signed_nda: true,
              nda_id: n.id
            }));
            hrDocs = [...hrDocs, ...completedDocs];
          }
        } catch (e) {
          console.error("Failed to fetch completed NDAs", e);
        }
      }

      setDocs(hrDocs);
    }
    finally { setLoading(false); }
  }, [canEdit, currentUser]);

  useEffect(() => { load(); }, [load]);

  const [showSigned, setShowSigned] = useState(false);

  const visible = docs.filter(d => {
    if (d.visible_to === 'admin' && role === 'employee') return false;
    if (d.visible_to === 'employee' && (role === 'admin' || role === 'manager')) return false;
    if (filterCat !== 'all' && d.category !== filterCat) return false;
    if (search && !d.title.toLowerCase().includes(search.toLowerCase()) && !d.description.toLowerCase().includes(search.toLowerCase())) return false;

    // Toggle filter
    if (showSigned && !d.is_signed_nda) return false;
    if (!showSigned && d.is_signed_nda) return false;

    return true;
  });

  return (
    <div className="space-y-5 max-w-6xl mx-auto">

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Documents</h1>
          <p className={`text-sm mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {canEdit ? 'Create and manage HR documents for employees.' : 'HR documents and agreements.'}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={() => onEditNdaForm()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand/90 shadow-sm transition-colors flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              New Document
            </button>
          </div>
        )}
      </div>



      {/* New-user notice (employees) */}
      {!canEdit && docs.some(d => d.show_to_new_users) && (
        <div className={`rounded-xl border-2 border-dashed p-4 flex items-center gap-3 ${isDark ? 'border-amber-600/40 bg-amber-900/10' : 'border-amber-300 bg-amber-50'}`}>
          <span className="text-xl"></span>
          <p className={`text-sm font-medium ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>
            Some documents below require your attention — look for the <span className="font-bold">New Users</span> badge.
          </p>
        </div>
      )}

      {/* Search + Category filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row gap-2 flex-1">
          <div className={`flex items-center gap-2 px-3 rounded-xl border flex-1 max-w-sm ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input className={`flex-1 py-2.5 text-sm bg-transparent outline-none ${isDark ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'}`}
              placeholder="Search by title or description…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>}
          </div>
          <div className="flex gap-1.5 flex-wrap items-center">
            {[['all', 'All'], ...CATEGORIES.map(c => [c.id, c.label])].map(([v, l]) => (
              <button key={v} onClick={() => setFCat(v)}
                className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${filterCat === v ? 'bg-brand text-white border-transparent shadow-sm'
                  : isDark ? 'border-slate-700 bg-slate-800 text-gray-400 hover:bg-slate-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}>{l}</button>
            ))}
          </div>
        </div>

        <div className={`flex items-center gap-3 px-4 py-2 rounded-xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
          <span className={`text-sm font-semibold ${showSigned ? (isDark ? 'text-green-400' : 'text-green-600') : (isDark ? 'text-gray-400' : 'text-gray-500')}`}>
            {showSigned ? "Signed Documents" : "Templates"}
          </span>
          <button
            type="button"
            onClick={() => setShowSigned(!showSigned)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${showSigned ? "bg-green-500" : "bg-gray-300 dark:bg-slate-600"
              }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-in-out ${showSigned ? "translate-x-5" : "translate-x-0"
                }`}
            />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className={`rounded-2xl border overflow-hidden shadow-sm ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
        {loading ? (
          <div className="py-20 flex justify-center"><div className="w-7 h-7 rounded-full border-2 border-brand border-t-transparent animate-spin" /></div>
        ) : visible.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-3xl mb-2"></p>
            <p className={`font-semibold ${isDark ? 'text-white' : 'text-gray-700'}`}>No documents found</p>
            <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{canEdit ? 'Click "New Document" to upload one.' : 'No documents available yet.'}</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className={`text-xs uppercase font-semibold tracking-wider border-b ${isDark ? 'bg-slate-700/60 text-slate-400 border-slate-700' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                <th className="px-5 py-3">Document</th>
                <th className="px-5 py-3">Category</th>
                {canEdit && <th className="px-5 py-3">Visibility</th>}
                <th className="px-5 py-3">Added By</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-slate-700' : 'divide-gray-100'}`}>
              {visible.map(doc => (
                <tr key={doc.id} className={`transition-colors ${isDark ? 'hover:bg-slate-700/30' : 'hover:bg-gray-50/70'}`}>
                  {/* Title + desc */}
                  <td className="px-5 py-3.5 max-w-xs">
                    <div className="flex items-start gap-3">
                      <span className="text-lg flex-shrink-0 mt-0.5">{fileIcon(doc.file_type)}</span>
                      <div className="min-w-0">
                        <p className={`font-medium truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{doc.title}</p>
                        {doc.description && <p className={`text-xs truncate mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{doc.description}</p>}
                        {doc.show_to_new_users && (
                          <span className="inline-flex mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                            New Users
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  {/* Category */}
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${CAT_PILL[doc.category] || CAT_PILL.general}`}>
                      {CATEGORIES.find(c => c.id === doc.category)?.label || doc.category}
                    </span>
                  </td>
                  {/* Visibility (Carrie only) */}
                  {canEdit && (
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {doc.visible_to === 'all' ? 'All employees' : doc.visible_to === 'admin' ? 'Admin only' : 'Employees only'}
                      </span>
                    </td>
                  )}
                  {/* Created by */}
                  <td className="px-5 py-3.5">
                    <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{doc.created_by_name || '—'}</span>
                  </td>
                  {/* Date */}
                  <td className="px-5 py-3.5">
                    <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{fmtDate(doc.created_at)}</span>
                  </td>
                  {/* Actions */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2 justify-end">
                      {doc.is_signed_nda ? (
                        <button onClick={async () => {
                          try {
                            const r = await api.nda.downloadFinalPdf(doc.nda_id);
                          } catch (e) { console.error(e); }
                        }}
                          className="px-3 py-1.5 text-xs font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border border-emerald-200 rounded-lg transition-colors dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
                          View Signed Doc
                        </button>
                      ) : (
                        <>
                          {doc.file_data && (
                            <button onClick={() => setPreview(doc)}
                              className="px-3 py-1.5 text-xs font-medium text-brand border border-brand/30 rounded-lg hover:bg-brand/10 transition-colors">
                              View
                            </button>
                          )}
                          {canEdit && (
                            <>
                              {doc.is_nda_template && onEditNdaForm ? (
                                <button onClick={() => onEditNdaForm(doc)}
                                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${isDark ? 'border-slate-600 text-gray-300 hover:bg-slate-700' : 'border-gray-200 text-gray-700 hover:bg-gray-100'}`}>
                                  Edit
                                </button>
                              ) : (
                                <button onClick={() => { setEditDoc(doc); setForm(true); }}
                                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${isDark ? 'border-slate-600 text-gray-300 hover:bg-slate-700' : 'border-gray-200 text-gray-700 hover:bg-gray-100'}`}>
                                  Edit
                                </button>
                              )}
                              <button onClick={() => setDelDoc(doc)}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 transition-colors">
                                Delete
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Row count */}
      {!loading && visible.length > 0 && (
        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Showing {visible.length} of {docs.length} document{docs.length !== 1 ? 's' : ''}
        </p>
      )}

      {/* Modals */}
      {formOpen && <DocForm isDark={isDark} doc={editDoc} currentUser={currentUser} onClose={() => { setForm(false); setEditDoc(null); }} onSave={() => { setForm(false); setEditDoc(null); load(); }} />}
      {delDoc && <DeleteConfirm isDark={isDark} doc={delDoc} onClose={() => setDelDoc(null)} onConfirm={async () => { if (delDoc.is_nda_template) { await api.nda.deleteTemplate(delDoc.id); } else { await api.hrDocuments.remove(delDoc.id); } setDelDoc(null); load(); }} />}
      {preview && <PreviewModal isDark={isDark} doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
