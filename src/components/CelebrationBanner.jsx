import { useState, useEffect } from 'react';
import { hasApi, api } from '../api/client';

const PASTEL_COLORS = [
  'from-pink-400 to-rose-300',
  'from-violet-400 to-purple-300',
  'from-blue-400 to-sky-300',
  'from-emerald-400 to-teal-300',
  'from-amber-400 to-yellow-300',
  'from-orange-400 to-red-300',
];

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return PASTEL_COLORS[Math.abs(hash) % PASTEL_COLORS.length];
}

export default function CelebrationBanner({ isDark }) {
  const [birthdays, setBirthdays] = useState([]);
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!hasApi()) return;
    api.celebrations.today()
      .then((data) => {
        const bdays = data?.birthdays || [];
        if (bdays.length > 0) {
          setBirthdays(bdays);
          // Check if already dismissed today (IST date)
          const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
          const dismissedKey = `celebration_dismissed_${todayIST}`;
          // Clear old dismissals (not today)
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key?.startsWith('celebration_dismissed_') && key !== dismissedKey) {
              localStorage.removeItem(key);
            }
          }
          if (!localStorage.getItem(dismissedKey)) {
            setTimeout(() => setVisible(true), 1500); // slide in after 1.5s
          }
        }
      })
      .catch(() => {});
  }, []);

  // Rotate through birthdays
  useEffect(() => {
    if (birthdays.length <= 1) return;
    const interval = setInterval(() => {
      setActiveIndex((i) => (i + 1) % birthdays.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [birthdays.length]);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => setDismissed(true), 500);
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    localStorage.setItem(`celebration_dismissed_${todayIST}`, '1');
  };

  if (dismissed || birthdays.length === 0) return null;

  const person = birthdays[activeIndex];
  const initial = (person.name || '?')[0].toUpperCase();
  const gradient = avatarColor(person.name);

  return (
    <div
      className={`fixed bottom-6 right-6 z-[90] transition-all duration-500 ease-out ${
        visible ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-8 opacity-0 scale-95 pointer-events-none'
      }`}
    >
      <div className={`relative w-80 rounded-2xl shadow-2xl overflow-hidden ${
        isDark ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-gray-100'
      }`}>
        {/* Confetti/party top strip */}
        <div className="relative h-20 bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 overflow-hidden">
          {/* Animated confetti */}
          <div className="absolute inset-0 overflow-hidden">
            {[...Array(20)].map((_, i) => (
              <span
                key={i}
                className="absolute animate-bounce"
                style={{
                  left: `${(i * 17 + 3) % 100}%`,
                  top: `${(i * 23 + 7) % 80}%`,
                  animationDelay: `${i * 0.15}s`,
                  animationDuration: `${1.5 + (i % 3) * 0.5}s`,
                  fontSize: `${10 + (i % 4) * 3}px`,
                  transform: `rotate(${i * 37}deg)`,
                  opacity: 0.8,
                }}
              >
                {['*', '+', '.', '*'][i % 4]}
              </span>
            ))}
          </div>
          {/* Party poppers and cake */}
          <div className="absolute inset-0 flex items-center justify-center gap-3 text-3xl">
            <span className="animate-pulse" style={{ animationDelay: '0s' }}>&#127881;</span>
            <span className="animate-pulse" style={{ animationDelay: '0.3s' }}>&#127874;</span>
            <span className="animate-pulse" style={{ animationDelay: '0.6s' }}>&#127881;</span>
          </div>
          {/* Dismiss button */}
          <button
            type="button"
            onClick={handleDismiss}
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white transition-colors backdrop-blur-sm"
            aria-label="Dismiss"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-5 pb-5 -mt-8 relative">
          {/* Avatar */}
          <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-2xl font-bold shadow-lg border-4 ${
            isDark ? 'border-slate-800' : 'border-white'
          } mx-auto`}>
            {initial}
          </div>

          <div className="text-center mt-3">
            <p className={`text-xs font-semibold uppercase tracking-widest ${
              isDark ? 'text-pink-400' : 'text-pink-500'
            }`}>
              Happy Birthday!
            </p>
            <h3 className={`text-lg font-bold mt-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {person.name}
            </h3>
            {(person.designation || person.department_name) && (
              <p className={`text-sm mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {person.designation}{person.designation && person.department_name ? ' \u00b7 ' : ''}{person.department_name}
              </p>
            )}
          </div>

          {/* Wish message */}
          <div className={`mt-3 text-center text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            <p>Wishing you a wonderful day filled with joy and happiness! &#127775;</p>
          </div>

          {/* Multiple birthdays indicator */}
          {birthdays.length > 1 && (
            <div className="flex items-center justify-center gap-1.5 mt-3">
              {birthdays.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === activeIndex
                      ? 'bg-pink-500 w-4'
                      : (isDark ? 'bg-slate-600 hover:bg-slate-500' : 'bg-gray-300 hover:bg-gray-400')
                  }`}
                  aria-label={`Birthday ${i + 1}`}
                />
              ))}
              <span className={`text-xs ml-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {birthdays.length} birthdays today
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
