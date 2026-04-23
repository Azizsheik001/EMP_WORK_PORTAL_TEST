export default function FilterBar({
  week,
  weekOptions,
  dateFrom,
  dateTo,
  clientId,
  clients,
  searchQuery,
  onWeekChange,
  onDateFromChange,
  onDateToChange,
  onClientChange,
  onSearchChange,
  departments = [],
  departmentId = '',
  onDepartmentChange,
  showClientFilter = true,
}) {
  const inputClass = 'bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-brand focus:border-transparent';

  // Navigate to previous / next day
  const shiftDate = (delta) => {
    const d = new Date((dateFrom || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })) + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (onDateFromChange) onDateFromChange(iso);
    if (onDateToChange) onDateToChange(iso);
  };

  // Before 5 AM IST, overnight shifts from yesterday are still active — treat yesterday as "today"
  const effectiveToday = (() => {
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    if (nowIST.getHours() < 5) {
      const y = new Date(nowIST); y.setDate(y.getDate() - 1);
      return `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
    }
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  })();

  const goToToday = () => {
    if (onDateFromChange) onDateFromChange(effectiveToday);
    if (onDateToChange) onDateToChange(effectiveToday);
  };

  // Format selected date for display
  const dateLabel = (() => {
    if (!dateFrom) return '';
    const d = new Date(dateFrom + 'T00:00:00');
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
    const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (dateFrom === effectiveToday) return `Today, ${formatted}`;
    return `${dayName}, ${formatted}`;
  })();

  return (
    <div className="flex-shrink-0 px-3 sm:px-4 py-3 bg-white dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-700">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
        {/* Department filter */}
        {onDepartmentChange && departments.length > 0 && (
          <select
            value={departmentId}
            onChange={(e) => {
              onDepartmentChange(e.target.value);
              if (e.target.value) {
                const dept = departments.find((d) => d.id === e.target.value);
                if (dept && dept.name.toLowerCase() !== 'solar') {
                  onClientChange('');
                }
              }
            }}
            className={`${inputClass} w-full sm:w-auto sm:min-w-[160px] min-h-[44px] sm:min-h-0`}
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
        {/* Client filter */}
        {showClientFilter && (
          <select
            value={clientId}
            onChange={(e) => onClientChange(e.target.value)}
            className={`${inputClass} w-full sm:w-auto sm:min-w-[160px] min-h-[44px] sm:min-h-0`}
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        <input
          type="search"
          placeholder="Search employee..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className={`${inputClass} w-full sm:flex-1 sm:min-w-[200px] sm:max-w-xs placeholder-gray-500 dark:placeholder-gray-400 min-h-[44px] sm:min-h-0`}
        />
        {/* Single date picker with prev/next navigation */}
        {onDateFromChange && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => shiftDate(-1)}
              className="p-2 sm:p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
              title="Previous day"
            >
              <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <input
              type="date"
              value={dateFrom || ''}
              onChange={(e) => {
                const val = e.target.value || null;
                onDateFromChange(val);
                if (onDateToChange) onDateToChange(val);
              }}
              className={`${inputClass} flex-1 sm:flex-none sm:min-w-[130px] min-h-[44px] sm:min-h-0`}
            />
            <button
              type="button"
              onClick={() => shiftDate(1)}
              className="p-2 sm:p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
              title="Next day"
            >
              <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={goToToday}
              className="px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-lg text-sm sm:text-xs font-medium text-brand bg-brand/10 hover:bg-brand/20 transition-colors min-h-[44px] sm:min-h-0"
            >
              Today
            </button>
          </div>
        )}
        {dateLabel && (
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
            {dateLabel}
          </span>
        )}
      </div>
    </div>
  );
}
