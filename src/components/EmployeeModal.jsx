import { useState } from 'react';
import { getClientById } from '../data/mockData';
import useModalKeyboard from '../hooks/useModalKeyboard';

export default function EmployeeModal({ employee, onClose, isDark, onLeaveRequest, clients }) {
  const [leaveDate, setLeaveDate] = useState('');
  const modalRef = useModalKeyboard(!!employee, onClose);
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (!employee) return null;

  const client = (clients && clients.length && employee.clientId) ? clients.find((c) => c.id === employee.clientId) : getClientById(employee.clientId);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onLeaveRequest) {
      onLeaveRequest(employee.id, employee.name, employee.clientId, leaveDate, reason);
      setLeaveDate('');
      setReason('');
      setSubmitted(true);
    }
  };

  const contentClass = isDark ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-gray-200 text-gray-900';
  const inputClass = isDark
    ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400 focus:ring-brand'
    : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-500 focus:ring-brand';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Employee details for ${employee.name}`}>
      <div
        ref={modalRef}
        className={`${contentClass} border rounded-xl shadow-xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-6 border-b border-inherit flex justify-between items-center">
          <h2 className="text-xl font-semibold">{employee.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white p-2 rounded min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <div>
            <span className="text-gray-500 dark:text-gray-400 text-sm">Assigned client</span>
            <p className="font-medium">{client?.name ?? employee.clientId}</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400 text-sm">Leaves remaining</span>
            <p className="font-medium">{employee.leavesRemaining ?? '—'}</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400 text-sm">Leaves taken in last 4 weeks</span>
            <p className="font-medium">{employee.leavesLast4Weeks ?? '—'}</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400 text-sm">Planned leaves</span>
            <p className="font-medium">
              {employee.plannedLeaves?.length ? employee.plannedLeaves.join(', ') : 'None'}
            </p>
          </div>

          <div className="pt-4 border-t border-inherit">
            <h3 className="text-sm font-semibold mb-3 text-brand">Request Leave</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-gray-500 dark:text-gray-400 text-sm mb-1">Date</label>
                <input
                  type="date"
                  value={leaveDate}
                  onChange={(e) => setLeaveDate(e.target.value)}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:border-transparent ${inputClass}`}
                />
              </div>
              <div>
                <label className="block text-gray-500 dark:text-gray-400 text-sm mb-1">Reason</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Enter reason..."
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:border-transparent ${inputClass}`}
                />
              </div>
              <button
                type="submit"
                className="w-full text-white font-medium py-2 px-4 rounded-lg transition-colors bg-brand hover:bg-brand-hover"
              >
                Submit
              </button>
              {submitted && (
                <p className="text-sm mt-2 text-brand">Request sent to team lead and manager.</p>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
