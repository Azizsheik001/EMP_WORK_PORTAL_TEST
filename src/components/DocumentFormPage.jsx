import { useState } from 'react';
import {
  getActiveDocumentRequestId,
  getDocumentRequestById,
  submitCompletedDocument,
  clearActiveDocumentRequest,
} from '../utils/documentStorage';

export default function DocumentFormPage({ currentUser, isDark }) {
  const requestId = getActiveDocumentRequestId();
  const documentRequest = getDocumentRequestById(requestId);

  const [fullName, setFullName] = useState(currentUser?.name || '');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [signature, setSignature] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  if (!documentRequest) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-6 ${isDark ? 'bg-slate-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
        <div className={`max-w-md w-full rounded-xl border p-6 text-center ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
          <h1 className="text-xl font-bold">Document not found</h1>
          <p className="text-sm mt-2 text-gray-500">
            Please open the document again from notifications.
          </p>
          <button
            type="button"
            onClick={() => {
              clearActiveDocumentRequest();
              window.location.href = '/';
            }}
            className="mt-5 px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = () => {
    if (!fullName.trim()) {
      alert('Please enter full name');
      return;
    }

    if (!signature.trim()) {
      alert('Please enter signature');
      return;
    }

    try {
      setSubmitting(true);

      submitCompletedDocument(requestId, {
        completedByUserId: currentUser?.id || '',
        completedByName: fullName.trim(),
        completedByEmail: email.trim(),
        address: address.trim(),
        notes: notes.trim(),
        signature: signature.trim(),
        signedDate: date,
        completedFileData: documentRequest.fileData,
      });

      clearActiveDocumentRequest();

      alert('Document submitted successfully');
      window.location.href = '/';
    } catch (e) {
      alert(e.message || 'Failed to submit document');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`min-h-screen p-4 md:p-6 ${isDark ? 'bg-slate-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className={`rounded-xl border p-5 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">Complete Document</h1>
              <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {documentRequest.fileName}
              </p>
              <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Sent by {documentRequest.senderName || 'Carrie Lu'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                clearActiveDocumentRequest();
                window.location.href = '/';
              }}
              className={`px-4 py-2 rounded-lg border text-sm font-medium ${isDark ? 'border-slate-600 text-gray-300 hover:bg-slate-700' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
            >
              Back
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_0.8fr] gap-4">
          <div className={`rounded-xl border overflow-hidden ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
            <div className={`px-4 py-3 border-b ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
              <p className="text-sm font-semibold">Document Preview</p>
            </div>

            <iframe
              src={documentRequest.fileData}
              title="PDF Document"
              className="w-full h-[700px] bg-white"
            />
          </div>

          <div className={`rounded-xl border p-5 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
            <h2 className="text-lg font-semibold">Editable Details</h2>
            <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Fill the required fields and submit to Carrie Lu.
            </p>

            <div className="space-y-4 mt-5">
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  Full Name *
                </label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                  placeholder="Full name"
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  Email
                </label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                  placeholder="Email"
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  Address
                </label>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={3}
                  className={`w-full rounded-lg border px-3 py-2 text-sm resize-none ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                  placeholder="Address"
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  Notes / Additional Information
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className={`w-full rounded-lg border px-3 py-2 text-sm resize-none ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                  placeholder="Optional notes"
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  Signature *
                </label>
                <input
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm font-signature ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                  placeholder="Type your signature"
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                />
              </div>

              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmit}
                className="w-full px-5 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Document'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}