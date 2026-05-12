import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

// ── Helpers ─────────────────────────────────────────────────────

const PASTEL_COLORS = [
  'bg-pink-200 text-pink-800',
  'bg-purple-200 text-purple-800',
  'bg-blue-200 text-blue-800',
  'bg-green-200 text-green-800',
  'bg-amber-200 text-amber-800',
  'bg-teal-200 text-teal-800',
  'bg-indigo-200 text-indigo-800',
  'bg-rose-200 text-rose-800',
  'bg-cyan-200 text-cyan-800',
  'bg-lime-200 text-lime-800',
];

function avatarColor(name) {
  if (!name) return PASTEL_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PASTEL_COLORS[Math.abs(hash) % PASTEL_COLORS.length];
}

function avatarLetter(name) {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
}

function parseDateStr(dateStr) {
  if (!dateStr) return null;
  // Handle both "1990-03-15" and "1990-03-15T00:00:00.000Z" formats
  const iso = String(dateStr).slice(0, 10);
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function formatBirthdayDate(dateStr) {
  const d = parseDateStr(dateStr);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function isBirthdayToday(dateStr) {
  const d = parseDateStr(dateStr);
  if (!d) return false;
  const today = new Date();
  return d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
}

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'all', label: 'All Year' },
];

const DEPT_COLORS = {
  Engineering: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Design: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  HR: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  Sales: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  Marketing: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  Operations: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  default: 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-400',
};

function deptBadgeClass(dept) {
  if (!dept) return DEPT_COLORS.default;
  return DEPT_COLORS[dept] || DEPT_COLORS.default;
}

// ── Birthday Card ───────────────────────────────────────────────

function BirthdayCard({ person, isDark }) {
  const name = person.name || person.full_name || 'Employee';
  const dept = person.department || person.department_name || '';
  const designation = person.designation || person.role || '';
  const birthday = person.date_of_birth || person.birthday || '';
  const isToday = isBirthdayToday(birthday);

  const cardClass = isDark
    ? 'bg-slate-800 border-slate-600 text-white'
    : 'bg-white border-gray-200 text-gray-900';

  return (
    <div
      className={`rounded-xl border-2 p-5 transition-all hover:shadow-md ${cardClass} ${
        isToday ? 'ring-2 ring-brand/50 border-brand/30' : ''
      }`}
    >
      {isToday && (
        <div className="mb-3 -mt-1 -mx-1">
          <div className="bg-gradient-to-r from-brand/10 via-pink-100/50 to-amber-100/50 dark:from-brand/20 dark:via-pink-900/20 dark:to-amber-900/20 rounded-lg px-3 py-1.5 text-center">
            <span className="text-sm font-semibold text-brand">
              🎂 Happy Birthday!
            </span>
          </div>
        </div>
      )}

      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0 ${avatarColor(name)}`}
        >
          {avatarLetter(name)}
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm truncate">{name}</p>
          {designation && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{designation}</p>
          )}
          {dept && (
            <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${deptBadgeClass(dept)}`}>
              {dept}
            </span>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            {formatBirthdayDate(birthday)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Empty State ─────────────────────────────────────────────────

function EmptyState({ period, isDark }) {
  const messages = {
    today: 'No birthdays today',
    week: 'No birthdays this week',
    month: 'No birthdays this month',
  };

  return (
    <div className="py-16 text-center">
      <span className="text-5xl block mb-4" role="img" aria-label="no celebrations">🎈</span>
      <p className={`text-lg font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
        {messages[period] || 'No birthdays found'}
      </p>
      <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
        Check back later for upcoming celebrations
      </p>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────

export default function CelebrationsView({ isDark, currentUser }) {
  const [activeTab, setActiveTab] = useState('today');
  const [todayData, setTodayData] = useState([]);
  const [allData, setAllData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const cardClass = isDark
    ? 'bg-slate-800 border-slate-600 text-white'
    : 'bg-white border-gray-200 text-gray-900';

  const fetchCelebrations = useCallback(async () => {
    setLoading(true);
    setError(null);

    const currentMonth = new Date().getMonth() + 1; // 1-based

    try {
      const promises = [
        api.celebrations?.today?.()?.catch?.(() => ({ celebrations: [] })) ??
          Promise.resolve({ celebrations: [] }),
        api.celebrations?.all?.()?.catch?.(() => ({ celebrations: [] })) ??
          Promise.resolve({ celebrations: [] }),
      ];

      const [todayRes, allRes] = await Promise.all(promises);

      setTodayData(todayRes?.celebrations || todayRes?.birthdays || []);
      setAllData(allRes?.celebrations || allRes?.birthdays || []);
    } catch (e) {
      if (e.status !== 401) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCelebrations();
  }, [fetchCelebrations]);

  const currentData = activeTab === 'today' ? todayData : allData;

  const groupedByMonth = useCallback(() => {
    const groups = {};
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    allData.forEach(person => {
      const d = parseDateStr(person.date_of_birth || person.birthday);
      if (!d) return;
      const mName = months[d.getMonth()];
      if (!groups[mName]) groups[mName] = [];
      groups[mName].push(person);
    });
    return groups;
  }, [allData]);

  // ── Loading ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="max-w-5xl mx-auto w-full space-y-4">
        <div className={`rounded-xl border-2 p-6 ${cardClass}`}>
          <p className="text-red-600 dark:text-red-400 font-medium">Failed to load celebrations</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error}</p>
          <button
            type="button"
            onClick={fetchCelebrations}
            className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand hover:bg-brand-hover"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          Celebrations <span role="img" aria-label="celebration">🎉</span>
        </h1>
      </div>

      {/* ── Tab Toggle ───────────────────────────────────────── */}
      <div className={`inline-flex rounded-lg p-1 ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-brand text-white shadow-sm'
                : isDark
                  ? 'text-gray-300 hover:text-white hover:bg-slate-600'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Birthday Grid ────────────────────────────────────── */}
      {currentData.length === 0 ? (
        <EmptyState period={activeTab} isDark={isDark} />
      ) : activeTab === 'today' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {todayData.map((person, idx) => (
            <BirthdayCard
              key={person.id || idx}
              person={person}
              isDark={isDark}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedByMonth()).map(([monthName, people]) => (
            <div key={monthName} className="space-y-4">
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200 border-b pb-2 dark:border-slate-700">
                {monthName} <span className="text-gray-400 dark:text-gray-500 font-normal text-sm ml-2">({people.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {people.map((person, idx) => (
                  <BirthdayCard
                    key={person.id || idx}
                    person={person}
                    isDark={isDark}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
