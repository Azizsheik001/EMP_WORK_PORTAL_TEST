export default function DateRangeFilter({ fromDate, toDate, onFromChange, onToChange, className = '' }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <label className="text-sm text-gray-600 dark:text-gray-400">From</label>
      <input
        type="date"
        value={fromDate}
        onChange={(e) => onFromChange(e.target.value)}
        className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-brand"
      />
      <label className="text-sm text-gray-600 dark:text-gray-400">To</label>
      <input
        type="date"
        value={toDate}
        onChange={(e) => onToChange(e.target.value)}
        className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-brand"
      />
    </div>
  );
}
