import { useState } from 'react';
import EmployeeView from './EmployeeView';
import LeavesView from './LeavesView';

const TABS = [
  { id: 'shift', label: 'My Shift', icon: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )},
  { id: 'leaves', label: 'My Leaves', icon: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  )},
];

export default function MyWorkView({
  isDark, currentUser, clockedInAt, clockedInAtRaw, onClockIn, onClockOut, isClockedIn,
  onLeaveRequest, clients, leaveRequests, onApprove, onReject, onCancelLeave, onSplitLeave, apiShifts,
}) {
  const [activeTab, setActiveTab] = useState('shift');

  return (
    <div className="space-y-4 max-w-6xl mx-auto w-full">
      {/* Sub-tab toggle */}
      <div className={`inline-flex rounded-lg p-1 ${isDark ? 'bg-slate-700/50' : 'bg-gray-100'}`}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-800 text-brand shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'shift' && (
        <EmployeeView
          isDark={isDark}
          currentUser={currentUser}
          clockedInAt={clockedInAt}
          clockedInAtRaw={clockedInAtRaw}
          onClockIn={onClockIn}
          onClockOut={onClockOut}
          isClockedIn={isClockedIn}
          onLeaveRequest={onLeaveRequest}
          onCancelLeave={onCancelLeave}
          clients={clients}
          apiShifts={apiShifts}
          leaveRequests={leaveRequests}
        />
      )}
      {activeTab === 'leaves' && (
        <LeavesView
          leaveRequests={leaveRequests}
          currentUser={currentUser}
          onApprove={onApprove}
          onReject={onReject}
          onCancelLeave={onCancelLeave}
          onSplitLeave={onSplitLeave}
          isDark={isDark}
          myOnly={true}
        />
      )}
    </div>
  );
}
