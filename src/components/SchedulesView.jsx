import { useState, useEffect, useRef } from 'react';
import DateRangeFilter from './DateRangeFilter';
import ScheduleGridView from './ScheduleGridView';
import ScheduleBuildGrid from './ScheduleBuildGrid';
import UploadSchedules from './UploadSchedules';
import { hasApi, api } from '../api/client';

function getDefaultDateRange() {
  const today = new Date();
  const day = today.getDay();
  const from = new Date(today);
  from.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  const to = new Date(from);
  to.setDate(from.getDate() + 6);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

const TEMPLATES_KEY = 'ags_schedule_templates';

export function getStoredTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTemplate(template) {
  const list = getStoredTemplates();
  const id = template.id || `t-${Date.now()}`;
  const t = { ...template, id, savedAt: new Date().toISOString() };
  const next = list.filter((x) => x.id !== id);
  next.unshift(t);
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next.slice(0, 50)));
  return t;
}

export function deleteStoredTemplate(id) {
  const next = getStoredTemplates().filter((x) => x.id !== id);
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next));
}

const SUB_TABS = [
  { id: 'view', label: 'View Schedule', icon: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )},
  { id: 'build', label: 'Build Schedule', icon: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  )},
  { id: 'upload', label: 'Upload CSV', icon: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  )},
  { id: 'templates', label: 'Templates', icon: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  )},
];

export default function SchedulesView({ clients = [], isDark, defaultBuildMode = false, showUpload = false, allUsers = [], departments = [] }) {
  const [subTab, setSubTab] = useState(defaultBuildMode ? 'build' : 'view');
  const [range, setRange] = useState(getDefaultDateRange);
  const [clientId, setClientId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [grid, setGrid] = useState({ dates: [], rows: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [buildRows, setBuildRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState(getStoredTemplates);
  const [templateName, setTemplateName] = useState('');
  const [applyingTemplateId, setApplyingTemplateId] = useState('');
  const [buildKey, setBuildKey] = useState(0);
  const buildGridRef = useRef(null);
  const [assignedRowsForView, setAssignedRowsForView] = useState([]);
  const [scheduleInfo, setScheduleInfo] = useState(null);

  const buildMode = subTab === 'build';

  useEffect(() => {
    if (!buildMode) return;
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        buildGridRef.current?.triggerSave?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [buildMode, clientId]);

  // Fetch schedule info (last scheduled date)
  useEffect(() => {
    if (!hasApi()) return;
    api.scheduleInfo(clientId || undefined)
      .then((data) => setScheduleInfo(data))
      .catch(() => setScheduleInfo(null));
  }, [clientId, subTab]);

  useEffect(() => {
    if (subTab === 'upload') return;
    if (!hasApi()) return;
    setLoading(true);
    setError(null);
    api.shiftsGrid(range.from, range.to, clientId || undefined, departmentId || undefined)
      .then((data) => {
        setGrid(data);
        const dates = data.dates || [];
        const emptyShiftsForDates = dates.length ? Object.fromEntries(dates.map((d) => [d, 'OFF'])) : {};
        if (data.rows?.length > 0) {
          setAssignedRowsForView([]);
          setBuildRows(data.rows);
        } else if (clientId || departmentId) {
          // Client or department selected but no shifts — fetch employees
          const fetchEmployees = clientId
            ? api.assignments.byClient(clientId).then((res) => res.users || [])
            : api.users().then((res) => (res.users || []).filter((u) => u.department_id === departmentId && u.role !== 'admin'));
          fetchEmployees
            .then((users) => {
              const rows = users.map((u) => ({
                user_id: u.id,
                employee_name: u.name,
                role: u.role,
                shifts: { ...emptyShiftsForDates },
              }));
              setAssignedRowsForView(rows);
              if (rows.length > 0) setBuildRows(rows);
              else setBuildRows([{ user_id: '_pattern', employee_name: 'Default week pattern (for template)', role: null, shifts: { ...emptyShiftsForDates } }]);
            })
            .catch(() => {
              setAssignedRowsForView([]);
              setBuildRows([{ user_id: '_pattern', employee_name: 'Default week pattern (for template)', role: null, shifts: { ...emptyShiftsForDates } }]);
            });
        } else {
          // No filter — show all employees from allUsers
          const rows = allUsers.filter((u) => u.role !== 'admin').map((u) => ({
            user_id: u.id,
            employee_name: u.name,
            role: u.role,
            shifts: { ...emptyShiftsForDates },
          }));
          setAssignedRowsForView(rows);
          setBuildRows(rows.length > 0 ? rows : []);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range.from, range.to, clientId, departmentId, subTab, allUsers]);

  useEffect(() => {
    if (buildMode && grid.rows?.length > 0) setBuildRows(grid.rows);
    if (!buildMode) setBuildRows([]);
  }, [buildMode, grid.rows]);

  const viewRows = (grid.rows?.length > 0 ? grid.rows : assignedRowsForView) || [];

  const [saveSuccess, setSaveSuccess] = useState(false);
  const handleSaveBuild = async (body) => {
    if (!hasApi()) return;
    setSaving(true);
    setError(null);
    try {
      // Batch assignments in chunks of 500 to avoid payload limits
      const allAssignments = body.assignments || [];
      const batchSize = 500;
      for (let i = 0; i < allAssignments.length; i += batchSize) {
        const batch = allAssignments.slice(i, i + batchSize);
        const batchBody = { ...body, assignments: batch };
        if (i > 0) delete batchBody.leave_entries; // only send leaves with first batch
        await api.shiftsBulk(batchBody);
      }
      const data = await api.shiftsGrid(range.from, range.to, clientId || undefined, departmentId || undefined);
      setGrid(data);
      setBuildRows(data.rows || []);
      // Remount the grid so the in-memory `edits` and `selectedRows` state in
      // ScheduleBuildGrid is cleared. Without this, stale local edits keep
      // overlaying the freshly fetched server values, and the next save would
      // re-include those old edits and overwrite them across the new
      // repeat-until range — which makes saves look like they "didn't stick".
      setBuildKey((k) => k + 1);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      const rawErr = e.data?.error;
      const msg = Array.isArray(rawErr) ? rawErr.map((x) => x.message || JSON.stringify(x)).join('; ') : (rawErr || e.message || 'Failed to save schedule');
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTemplate = (name, data) => {
    if (!name || !data) return;
    const clientName = clients.find((c) => c.id === clientId)?.name || '';
    saveTemplate({ name, clientId, clientName, dates: data.dates, rows: data.rows });
    setTemplates(getStoredTemplates());
    setTemplateName('');
  };

  const handleApplyTemplate = (templateId) => {
    const template = templates.find((t) => t.id === templateId);
    if (!template || !template.dates?.length || !template.rows?.length) return;
    const ourDates = grid.dates || [];
    const patternRow = template.rows.find((r) => r.user_id === '_pattern');
    const newRows = buildRows.map((row) => {
      const tr = template.rows.find((r) => r.user_id === row.user_id);
      const shifts = { ...row.shifts };
      ourDates.forEach((date, i) => {
        const tDate = template.dates[i];
        if (!tDate) return;
        if (tr?.shifts?.[tDate] != null) shifts[date] = tr.shifts[tDate];
        else if (patternRow?.shifts?.[tDate] != null) shifts[date] = patternRow.shifts[tDate];
      });
      return { ...row, shifts };
    });
    setBuildRows(newRows);
    setApplyingTemplateId('');
    setBuildKey((k) => k + 1);
  };

  const handleExportTemplates = () => {
    const blob = new Blob([JSON.stringify({ templates, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `schedule-templates-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleImportTemplates = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const list = Array.isArray(data.templates) ? data.templates : Array.isArray(data) ? data : [];
        const existing = getStoredTemplates();
        const existingIds = new Set(existing.map((t) => t.id));
        const toAdd = list.map((t) => ({ ...t, id: existingIds.has(t.id) ? `t-${Date.now()}-${Math.random().toString(36).slice(2)}` : t.id }));
        const merged = [...toAdd, ...existing].slice(0, 50);
        localStorage.setItem(TEMPLATES_KEY, JSON.stringify(merged));
        setTemplates(getStoredTemplates());
      } catch (_) {
        setError('Invalid template file');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Schedules</h1>
      </div>

      {/* Sub-tab bar */}
      <div className={`flex gap-1 p-1 rounded-xl ${isDark ? 'bg-slate-700/50' : 'bg-gray-100'}`}>
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              subTab === tab.id
                ? 'bg-white dark:bg-slate-800 text-brand shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Upload sub-tab */}
      {subTab === 'upload' && (
        <UploadSchedules isDark={isDark} clients={clients} allUsers={allUsers} />
      )}

      {/* Templates sub-tab */}
      {subTab === 'templates' && (
        <TemplatesPanel
          templates={templates}
          isDark={isDark}
          onDelete={(id) => {
            deleteStoredTemplate(id);
            setTemplates(getStoredTemplates());
          }}
          onExport={handleExportTemplates}
          onImport={handleImportTemplates}
          onApply={(template) => {
            // Switch to Build mode, set client/dept filter, and stage the
            // template's rows so the user lands on a populated week ready to
            // confirm/save.
            setSubTab('build');
            if (template.clientId !== undefined) setClientId(template.clientId || '');
            // Bumping buildKey resets the inner grid state; we then push the
            // template into buildRows on the next tick once the grid mounts
            // with the new client/dept.
            setBuildKey((k) => k + 1);
            setBuildRows(template.rows || []);
            setGrid({ dates: template.dates || [], rows: template.rows || [] });
          }}
        />
      )}

      {/* View / Build sub-tabs */}
      {subTab !== 'upload' && subTab !== 'templates' && (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <DateRangeFilter
              fromDate={range.from}
              toDate={range.to}
              onFromChange={(from) => setRange((r) => ({ ...r, from }))}
              onToChange={(to) => setRange((r) => ({ ...r, to }))}
              className="bg-white dark:bg-slate-800/50 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-600"
            />
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white min-w-[160px]"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white min-w-[160px]"
            >
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {saveSuccess && <p className="text-sm text-green-600 dark:text-green-400 font-medium">Schedule saved successfully.</p>}
          {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading schedule...</p>}

          {!loading && !error && subTab === 'build' && (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Pick shifts for each cell, then <strong>Save schedule</strong>. Filter by department or client, or schedule all employees at once. Use templates to reuse patterns.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportTemplates}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 text-sm"
                >
                  Export templates
                </button>
                <label className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 text-sm cursor-pointer">
                  Import templates
                  <input type="file" accept=".json,application/json" className="hidden" onChange={handleImportTemplates} />
                </label>
              </div>
              <ScheduleBuildGrid
                ref={buildGridRef}
                key={buildKey}
                dates={grid.dates || []}
                rows={buildRows}
                clientId={clientId}
                departmentId={departmentId}
                onSave={handleSaveBuild}
                isDark={isDark}
                saving={saving}
                onSaveTemplate={handleSaveTemplate}
                templateName={templateName}
                onTemplateNameChange={setTemplateName}
                templates={templates}
                applyingTemplateId={applyingTemplateId}
                onApplyTemplate={handleApplyTemplate}
                leaveMap={{}}
              />
            </>
          )}

          {!loading && !error && subTab === 'view' && (
            <ScheduleGridView dates={grid.dates || []} rows={viewRows} isDark={isDark} scheduleInfo={scheduleInfo} />
          )}
        </>
      )}
    </div>
  );
}

function TemplatesPanel({ templates, isDark, onDelete, onExport, onImport, onApply }) {
  const [openId, setOpenId] = useState(templates[0]?.id || '');
  const open = templates.find((t) => t.id === openId) || templates[0] || null;

  if (!templates || templates.length === 0) {
    return (
      <div className={`rounded-lg border p-6 text-sm ${isDark ? 'border-slate-700 bg-slate-800/50 text-gray-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
        <p>No saved schedule templates yet.</p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Templates are saved when you give a name in the "Save schedule" dialog while building. Imported templates also land here.
        </p>
        <div className="mt-3">
          <label className={`inline-block px-3 py-1.5 rounded-lg border text-xs cursor-pointer ${isDark ? 'border-slate-600 text-gray-300' : 'border-gray-300 text-gray-700'}`}>
            Import templates
            <input type="file" accept=".json,application/json" className="hidden" onChange={onImport} />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onExport}
          className={`px-3 py-1.5 rounded-lg border text-sm ${isDark ? 'border-slate-600 text-gray-300' : 'border-gray-300 text-gray-700'}`}
        >
          Export templates
        </button>
        <label className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${isDark ? 'border-slate-600 text-gray-300' : 'border-gray-300 text-gray-700'}`}>
          Import templates
          <input type="file" accept=".json,application/json" className="hidden" onChange={onImport} />
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Template list */}
        <div className={`rounded-lg border ${isDark ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-white'} overflow-hidden`}>
          <div className={`px-3 py-2 text-xs font-semibold uppercase tracking-wider border-b ${isDark ? 'border-slate-700 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
            {templates.length} saved template{templates.length === 1 ? '' : 's'}
          </div>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700">
            {templates.map((t) => {
              const active = open && open.id === t.id;
              const dateRange = (t.dates && t.dates.length > 0)
                ? `${t.dates[0]} → ${t.dates[t.dates.length - 1]}`
                : '—';
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setOpenId(t.id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${
                    active
                      ? (isDark ? 'bg-brand/15' : 'bg-brand/5')
                      : (isDark ? 'hover:bg-slate-700/50' : 'hover:bg-gray-50')
                  }`}
                >
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{t.name || 'Untitled'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {t.clientName ? `${t.clientName} · ` : ''}{dateRange}
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {(t.rows || []).filter((r) => r.user_id !== '_pattern').length} employees · saved {t.savedAt ? new Date(t.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Template detail */}
        <div className="lg:col-span-2 space-y-3">
          {open ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">{open.name || 'Untitled'}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {open.clientName || 'All clients'}
                    {open.dates && open.dates.length > 0 && (
                      <> · {open.dates[0]} → {open.dates[open.dates.length - 1]}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onApply(open)}
                    className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium"
                  >
                    Use in Build
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete template "${open.name || 'Untitled'}"?`)) {
                        onDelete(open.id);
                        setOpenId('');
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800/60 text-red-600 dark:text-red-400 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <ScheduleGridView
                dates={open.dates || []}
                rows={(open.rows || []).filter((r) => r.user_id !== '_pattern')}
                isDark={isDark}
                scheduleInfo={null}
              />
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">Select a template on the left to preview the week.</p>
          )}
        </div>
      </div>
    </div>
  );
}
