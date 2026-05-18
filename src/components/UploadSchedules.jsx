import { useState, useEffect, useCallback } from 'react';
import { api, hasApi } from '../api/client';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getMondayOfCurrentWeek() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff);
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getISOWeekNumber(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
}

function getWeekLabel(startDate) {
  const weekNum = getISOWeekNumber(startDate);
  const endDate = addDays(startDate, 6);
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const year = start.getFullYear();
  return `Week ${weekNum}: ${fmt(start)} – ${fmt(end)}, ${year}`;
}

function getWeekDates(startDate) {
  return Array.from({ length: 7 }, (_, i) => addDays(startDate, i));
}

const STEPS = [
  { key: 'client', label: 'Select Client & Week' },
  { key: 'template', label: 'Download Template' },
  { key: 'upload', label: 'Upload CSV' },
  { key: 'preview', label: 'Preview & Confirm' },
];

export default function UploadSchedules({ isDark, clients = [], allUsers = [] }) {
  const [step, setStep] = useState(0);
  const [selectedClient, setSelectedClient] = useState('');
  const [startDate, setStartDate] = useState(getMondayOfCurrentWeek);
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [employeeError, setEmployeeError] = useState('');
  const [file, setFile] = useState(null);
  const [csvText, setCsvText] = useState('');
  const [parseError, setParseError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [repeatMode, setRepeatMode] = useState('weeks'); // 'weeks' or 'until'
  const [repeatWeeks, setRepeatWeeks] = useState(1);
  const [repeatUntil, setRepeatUntil] = useState('');

  const weekDates = getWeekDates(startDate);
  const clientName = clients.find((c) => c.id === selectedClient)?.name || '';

  // Fetch employees when client changes (or use allUsers for "all employees")
  useEffect(() => {
    if (!hasApi()) {
      setEmployees([]);
      return;
    }
    if (!selectedClient) {
      // No client selected — show all employees
      setEmployees(allUsers.filter((u) => u.role !== 'admin'));
      return;
    }
    let cancelled = false;
    setLoadingEmployees(true);
    setEmployeeError('');
    api.assignments.byClient(selectedClient)
      .then((data) => {
        if (!cancelled) setEmployees(data.users || []);
      })
      .catch((err) => {
        if (!cancelled) setEmployeeError(err.message || 'Failed to load employees');
      })
      .finally(() => {
        if (!cancelled) setLoadingEmployees(false);
      });
    return () => { cancelled = true; };
  }, [selectedClient, allUsers]);

  // Reset flow when client changes
  useEffect(() => {
    setStep(1);
    setFile(null);
    setCsvText('');
    setPreviewData(null);
    setWarnings([]);
    setParseError('');
    setSubmitError('');
    setSubmitted(false);
  }, [selectedClient]);

  // Calculate how many weeks — must be defined before handleDownloadTemplate uses it
  const totalWeeks = repeatMode === 'until' && repeatUntil
    ? Math.max(1, Math.ceil((new Date(repeatUntil + 'T00:00:00') - new Date(startDate + 'T00:00:00')) / (7 * 86400000)))
    : Math.max(1, repeatWeeks);

  const lastScheduledDate = addDays(startDate, totalWeeks * 7 - 1);

  const handleDownloadTemplate = useCallback(() => {
    const allTemplateDates = Array.from({ length: totalWeeks * 7 }, (_, i) => addDays(startDate, i));
    const header = ['Employee Name', 'Employee ID', ...allTemplateDates.map((d) => {
      const dateObj = new Date(d + 'T00:00:00');
      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
      return `${dayName} (${formatDateShort(d)})`;
    })];
    const rows = employees.map((emp) => {
      const name = (emp.name || '').replace(/,/g, ' ');
      const empId = emp.employee_no || '';
      return [name, empId, ...Array(totalWeeks * 7).fill('')].join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-template-${clientName.replace(/\s+/g, '_')}-${startDate}-${totalWeeks}wk.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [employees, totalWeeks, startDate, clientName]);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    setCsvText('');
    setPreviewData(null);
    setWarnings([]);
    setParseError('');
    setSubmitError('');
    setSubmitted(false);
  };

  const handleParseCSV = useCallback(async () => {
    if (!file) return;
    setParseError('');
    setParsing(true);

    try {
      const text = await file.text();
      setCsvText(text);

      if (hasApi()) {
        const parseBody = { start_date: startDate, csv_text: text };
        if (selectedClient) parseBody.client_id = selectedClient;
        const result = await api.schedules.parseCSV(parseBody);
        setPreviewData(result.assignments || []);
        setWarnings(result.warnings || []);
        setStep(3);
      } else {
        // Fallback: parse locally for demo/mock mode
        const parsed = parseCSVLocally(text, employees, weekDates);
        setPreviewData(parsed.assignments);
        setWarnings(parsed.warnings);
        setStep(3);
      }
    } catch (err) {
      setParseError(err.data?.error || err.message || 'Failed to parse CSV');
    } finally {
      setParsing(false);
    }
  }, [file, selectedClient, startDate, employees, weekDates]);



  const handleSubmit = useCallback(async () => {
    if (!previewData || previewData.length === 0) return;
    setSubmitting(true);
    setSubmitError('');

    try {
      // The CSV already contains all weeks — submit assignments as-is (no repeating)
      const allAssignments = previewData.map((a) => ({
        user_id: a.user_id,
        shift_date: a.shift_date,
        shift_start_time: a.shift_start_time,
        shift_end_time: a.shift_end_time,
        is_off: a.is_off || false,
      }));

      // Send in batches of 500 to avoid payload limits
      const batchSize = 500;
      for (let i = 0; i < allAssignments.length; i += batchSize) {
        const batch = allAssignments.slice(i, i + batchSize);
        const bulkBody = { assignments: batch };
        if (selectedClient) bulkBody.client_id = selectedClient;
        await api.shiftsBulk(bulkBody);
      }
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err.data?.error || err.message || 'Failed to save schedule');
    } finally {
      setSubmitting(false);
    }
  }, [previewData, selectedClient]);

  const handleReset = () => {
    setStep(1);
    setFile(null);
    setCsvText('');
    setPreviewData(null);
    setWarnings([]);
    setParseError('');
    setSubmitError('');
    setSubmitted(false);
  };

  // Build preview table grouped by employee
  const previewTable = buildPreviewTable(previewData, weekDates);

  const selectClass = isDark
    ? 'w-full bg-slate-700 border-slate-600 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-brand'
    : 'w-full bg-white border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:ring-2 focus:ring-brand';

  const cardClass = isDark
    ? 'bg-slate-800 border border-slate-600 rounded-lg p-5'
    : 'bg-white border border-gray-200 rounded-lg p-5 shadow-sm';

  return (
    <div className="space-y-6">
      <p className="text-gray-600 dark:text-gray-400">
        Upload a CSV file to create shift assignments for a week. Follow the steps below: select a client, download the template, fill it in, then upload and confirm.
      </p>

      {/* Step indicators */}
      <div className="flex items-center gap-2 flex-wrap">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${i < step
                  ? 'bg-green-500 text-white'
                  : i === step
                    ? 'bg-brand text-white'
                    : isDark
                      ? 'bg-slate-700 text-slate-400'
                      : 'bg-gray-200 text-gray-500'
                }`}
            >
              {i < step ? '\u2713' : i + 1}
            </div>
            <span
              className={`text-sm ${i === step
                  ? 'font-semibold text-gray-900 dark:text-white'
                  : 'text-gray-500 dark:text-gray-400'
                }`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px ${isDark ? 'bg-slate-600' : 'bg-gray-300'}`} />
            )}
          </div>
        ))}
      </div>

      <div className="max-w-4xl mx-auto w-full space-y-5">
        {/* Step 0/1: Client + Week selection */}
        <div className={cardClass}>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Step 1: Select Client & Week</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-gray-500 dark:text-gray-400 text-sm mb-1">Client (optional)</label>
              <select
                value={selectedClient}
                onChange={(e) => setSelectedClient(e.target.value)}
                className={selectClass}
              >
                <option value="">All Employees</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-gray-500 dark:text-gray-400 text-sm mb-1">Week starting (Monday)</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (step > 1) handleReset();
                }}
                className={selectClass}
              />
              <p className="text-xs text-brand font-medium mt-1">{(() => {
                const startWeekNum = getISOWeekNumber(startDate);
                const endWeekNum = getISOWeekNumber(lastScheduledDate);
                const startFmt = new Date(startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const endFmt = new Date(lastScheduledDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const year = new Date(startDate + 'T00:00:00').getFullYear();
                const weekLabel = totalWeeks > 1 ? `Weeks ${startWeekNum}–${endWeekNum}` : `Week ${startWeekNum}`;
                return `${weekLabel}: ${startFmt} – ${endFmt}, ${year}`;
              })()}</p>
            </div>
          </div>

          {/* Schedule duration */}
          <div className="mt-4">
            <label className="block text-gray-500 dark:text-gray-400 text-sm mb-2 font-medium">Apply schedule for:</label>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="repeatMode" value="weeks" checked={repeatMode === 'weeks'}
                  onChange={() => setRepeatMode('weeks')}
                  className="text-brand focus:ring-brand" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Number of weeks</span>
              </label>
              {repeatMode === 'weeks' && (
                <select value={repeatWeeks} onChange={(e) => setRepeatWeeks(Number(e.target.value))}
                  className={`${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'} rounded-lg px-3 py-1.5 text-sm border`}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map((w) => (
                    <option key={w} value={w}>{w} week{w > 1 ? 's' : ''}</option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="repeatMode" value="until" checked={repeatMode === 'until'}
                  onChange={() => setRepeatMode('until')}
                  className="text-brand focus:ring-brand" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Until date</span>
              </label>
              {repeatMode === 'until' && (
                <input type="date" value={repeatUntil}
                  onChange={(e) => setRepeatUntil(e.target.value)}
                  min={addDays(startDate, 7)}
                  className={`${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'} rounded-lg px-3 py-1.5 text-sm border`} />
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              The uploaded weekly pattern will repeat for <strong>{totalWeeks} week{totalWeeks > 1 ? 's' : ''}</strong>, scheduling till <strong>{new Date(lastScheduledDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>.
            </p>
          </div>

          <div className="mt-3 text-sm text-gray-600 dark:text-gray-400">
            {loadingEmployees ? (
              'Loading employees...'
            ) : employeeError ? (
              <span className="text-red-500">{employeeError}</span>
            ) : (
              <span>{employees.length} employee{employees.length !== 1 ? 's' : ''} {selectedClient ? `assigned to ${clientName}` : '(all employees)'}</span>
            )}
          </div>
        </div>

        {/* Step 1: Template & Format info */}
        {step >= 1 && (
          <div className={cardClass}>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Step 2: CSV Format & Template</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              The CSV should have employee names in the first column, employee ID in the second column, and 7 day columns (Mon-Sun). All times are in <strong>IST</strong> timezone. Each cell should contain a shift time range or <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-xs">OFF</code> for days off. Leave cells empty to skip.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              <strong>Standard AGS shifts (IST):</strong>
              {' '}<code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-slate-700">14:00-23:00</code> (2 PM – 11 PM),
              {' '}<code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-slate-700">13:00-22:00</code> (1 PM – 10 PM),
              {' '}<code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-slate-700">23:00-09:00</code> (11 PM – 9 AM),
              {' '}<code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-slate-700">19:30-04:30</code> (7:30 PM – 4:30 AM),
              {' '}<code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-slate-700">19:00-04:00</code> (7 PM – 4 AM).
            </p>
            <div className={`overflow-x-auto rounded-lg border ${isDark ? 'border-slate-600' : 'border-gray-200'} mb-4`}>
              <table className="text-xs w-full min-w-full">
                <thead>
                  <tr className={isDark ? 'bg-slate-700' : 'bg-gray-50'}>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Employee Name</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Employee ID</th>
                    {weekDates.map((d) => {
                      const dateObj = new Date(d + 'T00:00:00');
                      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                      return (
                      <th key={d} className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                        {dayName}<br />
                        <span className="font-normal text-gray-400">{formatDateShort(d)}</span>
                      </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  <tr className={isDark ? 'bg-slate-800' : 'bg-white'}>
                    <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 italic">Sanjay Kumar G</td>
                    <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 italic">EMP001</td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">09:00-18:00</td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">09:00-18:00</td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">09:00-18:00</td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">09:00-18:00</td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">09:00-18:00</td>
                    <td className="px-3 py-1.5 text-orange-500">OFF</td>
                    <td className="px-3 py-1.5 text-orange-500">OFF</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              disabled={loadingEmployees || employees.length === 0}
              className="inline-flex items-center gap-2 bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
              </svg>
              Download Template CSV
            </button>
            {employees.length === 0 && !loadingEmployees && (
              <p className="text-xs text-amber-500 mt-2">No employees assigned to this client. Assign employees first.</p>
            )}
          </div>
        )}

        {/* Step 2: Upload CSV */}
        {step >= 1 && (
          <div className={cardClass}>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Step 3: Upload Filled CSV</h3>
            <div className="space-y-3">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="w-full text-sm text-gray-600 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-brand file:text-white file:cursor-pointer"
              />
              {parseError && <p className="text-sm text-red-600 dark:text-red-400">{parseError}</p>}
              <button
                type="button"
                onClick={handleParseCSV}
                disabled={!file || parsing}
                className="bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors text-sm"
              >
                {parsing ? 'Parsing...' : 'Parse & Preview'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Preview & Confirm */}
        {step === 3 && previewData && (
          <div className={cardClass}>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Step 4: Review & Confirm</h3>

            {warnings.length > 0 && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${isDark ? 'bg-amber-900/30 border border-amber-700 text-amber-300' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
                <p className="font-semibold mb-1">Warnings ({warnings.length})</p>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {previewData.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No valid assignments found in the CSV. Check the warnings above and ensure employee names match exactly.</p>
            ) : (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  {previewData.length} shift assignment{previewData.length !== 1 ? 's' : ''} per week for {Object.keys(previewTable).length} employee{Object.keys(previewTable).length !== 1 ? 's' : ''}.
                  {totalWeeks > 1 && <> Repeating for <strong>{totalWeeks} weeks</strong> ({previewData.length * totalWeeks} total assignments) till <strong>{new Date(lastScheduledDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>.</>}
                </p>
                <div className={`overflow-x-auto rounded-lg border ${isDark ? 'border-slate-600' : 'border-gray-200'} mb-4`}>
                  <table className="text-xs w-full min-w-full">
                    <thead>
                      <tr className={isDark ? 'bg-slate-700' : 'bg-gray-50'}>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Employee</th>
                        {weekDates.map((d) => {
                          const dateObj = new Date(d + 'T00:00:00');
                          const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                          return (
                          <th key={d} className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-300">
                            {dayName}<br />
                            <span className="font-normal text-gray-400">{formatDateShort(d)}</span>
                          </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(previewTable).map(([empName, dayMap]) => (
                        <tr key={empName} className={isDark ? 'border-t border-slate-700' : 'border-t border-gray-100'}>
                          <td className="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">{empName}</td>
                          {weekDates.map((d) => {
                            const cell = dayMap[d];
                            if (!cell) {
                              return <td key={d} className="px-3 py-1.5 text-center text-gray-400">-</td>;
                            }
                            const isOff = cell.is_off;
                            return (
                              <td
                                key={d}
                                className={`px-3 py-1.5 text-center ${isOff
                                    ? 'text-orange-500 font-medium'
                                    : 'text-gray-700 dark:text-gray-300'
                                  }`}
                              >
                                {isOff ? 'OFF' : `${cell.shift_start_time}-${cell.shift_end_time}`}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {submitError && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{submitError}</p>}

                {submitted ? (
                  <div className="space-y-3">
                    <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                      Schedule uploaded successfully. {previewData.length * totalWeeks} shift assignments saved for {totalWeeks} week{totalWeeks > 1 ? 's' : ''} (till {new Date(lastScheduledDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}).
                    </p>
                    <button
                      type="button"
                      onClick={handleReset}
                      className="text-sm text-brand hover:underline"
                    >
                      Upload another schedule
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 px-5 rounded-lg transition-colors text-sm"
                    >
                      {submitting ? 'Saving...' : `Confirm & Save ${previewData.length * totalWeeks} Assignments`}
                    </button>
                    <button
                      type="button"
                      onClick={handleReset}
                      disabled={submitting}
                      className={`py-2 px-4 rounded-lg text-sm font-medium transition-colors ${isDark
                          ? 'bg-slate-700 hover:bg-slate-600 text-gray-300'
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                        }`}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Build a preview table: { [employeeName]: { [date]: assignment } } */
function buildPreviewTable(assignments, weekDates) {
  if (!assignments) return {};
  const table = {};
  for (const a of assignments) {
    const name = a.employee_name || a.user_id;
    if (!table[name]) table[name] = {};
    table[name][a.shift_date] = a;
  }
  return table;
}

/** Local CSV parsing fallback (when no API is available) */
function parseCSVLocally(text, employees, weekDates) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { assignments: [], warnings: ['CSV must have a header and at least one data row'] };

  const nameMap = {};
  for (const emp of employees) {
    nameMap[(emp.name || '').trim().toLowerCase()] = emp;
  }

  const assignments = [];
  const warnings = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const empName = cols[0] || '';
    if (!empName) continue;

    const user = nameMap[empName.toLowerCase()];
    if (!user) {
      warnings.push(`Row ${i + 1}: Employee "${empName}" not found for this client`);
      continue;
    }

    // Column 1 = Employee ID (skip), day columns start at index 2
    for (let d = 0; d < weekDates.length && d + 2 < cols.length; d++) {
      const cellVal = cols[d + 2] || '';
      if (!cellVal) continue;

      const isOff = cellVal.toUpperCase() === 'OFF';
      let shift_start_time = null;
      let shift_end_time = null;

      if (!isOff) {
        const m = cellVal.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
        if (m) {
          shift_start_time = m[1].length === 4 ? '0' + m[1] : m[1];
          shift_end_time = m[2].length === 4 ? '0' + m[2] : m[2];
        } else {
          warnings.push(`Row ${i + 1}, day ${d + 1}: Invalid time format "${cellVal}"`);
          continue;
        }
      }

      assignments.push({
        user_id: user.id,
        employee_name: user.name,
        shift_date: weekDates[d],
        shift_start_time,
        shift_end_time,
        is_off: isOff,
      });
    }
  }

  return { assignments, warnings };
}
