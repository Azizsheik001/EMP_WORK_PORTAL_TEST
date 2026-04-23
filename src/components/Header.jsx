export default function Header({
  title = 'AGS Workforce Portal',
  subtitle = 'Workforce Management and Employee Scheduling',
  onOpenRightPanel,
  onOpenNotifications,
  notificationCount = 0,
  onMenuToggle,
}) {
  return (
    <header
      className="flex-shrink-0 flex items-center gap-2 px-2 sm:px-6 text-white border-b border-black/10 shadow-sm min-h-[60px] sm:h-24 bg-brand"
      role="banner"
    >
      {/* Left slot — hamburger on mobile, spacer on desktop.
          (Logo lives in the sidebar top; keeping it out of the header
          avoids the redundant double-logo look.) */}
      <div className="flex items-center w-10 sm:w-48 flex-shrink-0">
        {onMenuToggle && (
          <button
            type="button"
            onClick={onMenuToggle}
            className="lg:hidden flex items-center justify-center w-11 h-11 -ml-1 rounded-lg hover:bg-white/15 transition-colors"
            aria-label="Open navigation menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
      </div>

      {/* Center — title + subtitle */}
      <div className="flex-1 flex justify-center min-w-0 px-1">
        <div className="text-center min-w-0 w-full">
          <h1 className="text-base sm:text-2xl md:text-3xl font-bold text-white tracking-wide truncate leading-tight">
            {title}
          </h1>
          <p className="hidden sm:block text-xs sm:text-sm text-white/90 mt-0.5 truncate">
            {subtitle}
          </p>
        </div>
      </div>

      {/* Right — notifications + account */}
      <div className="w-auto sm:w-56 md:w-64 flex items-center justify-end gap-0.5 sm:gap-2 flex-shrink-0">
        {onOpenNotifications && (
          <button
            type="button"
            onClick={onOpenNotifications}
            className="relative flex items-center justify-center w-11 h-11 rounded-lg hover:bg-white/15 transition-colors flex-shrink-0"
            title="Notifications"
            aria-label={`Notifications${notificationCount > 0 ? ` (${notificationCount} pending)` : ''}`}
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {notificationCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                {notificationCount > 99 ? '99+' : notificationCount}
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenRightPanel}
          className="flex items-center justify-center px-1 sm:px-3 py-1 rounded-lg hover:bg-white/15 transition-colors min-h-[44px] sm:min-h-[88px] flex-shrink-0"
          title="Account & settings"
          aria-label="Open settings"
        >
          <img
            src="/rightpanel.png"
            alt="American Green Solutions"
            className="h-9 sm:h-20 md:h-[88px] w-auto max-w-[140px] sm:max-w-[220px] object-contain"
          />
        </button>
      </div>
    </header>
  );
}
