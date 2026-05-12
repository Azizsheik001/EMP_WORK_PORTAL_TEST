const DOC_REQUESTS_KEY = 'employee_document_requests_v1';
const DOC_SUBMISSIONS_KEY = 'employee_document_submissions_v1';
const ACTIVE_DOC_REQUEST_KEY = 'active_document_request_id';

////////////////////////////////////////////////////////////
// ✅ Carrie Lu strict check
////////////////////////////////////////////////////////////
export function isCarrieLu(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  const name = String(user?.name || user?.full_name || '').trim().toLowerCase();
  const role = String(user?.type || user?.role || '').trim().toLowerCase();

  return (
    email === 'carriel@libsysinc.com' &&
    name === 'carrie lu' &&
    role === 'manager'
  );
}

////////////////////////////////////////////////////////////
// Safe Local Storage Helpers
////////////////////////////////////////////////////////////
function safeRead(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function safeWrite(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

////////////////////////////////////////////////////////////
// Convert File → Base64
////////////////////////////////////////////////////////////
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file selected'));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));

    reader.readAsDataURL(file);
  });
}

////////////////////////////////////////////////////////////
// Send Document (Carrie → Employee)
////////////////////////////////////////////////////////////
export function sendDocumentToEmployee({ employee, sender, fileName, fileData }) {
  if (!employee?.id) {
    throw new Error('Employee is required');
  }

  if (!fileName || !fileData) {
    throw new Error('PDF document is required');
  }

  const allRequests = safeRead(DOC_REQUESTS_KEY, {});
  const id = `doc_${Date.now()}_${employee.id}`;

  const request = {
    id,
    employeeId: employee.id,
    employeeName: employee.name || employee.full_name || 'Employee',
    employeeEmail: employee.email || '',
    senderId: sender?.id || '',
    senderName: sender?.name || sender?.full_name || 'Carrie Lu',
    senderEmail: sender?.email || '',
    fileName,
    fileData,
    fileType: 'application/pdf',
    status: 'pending',
    createdAt: new Date().toISOString(),
    submittedAt: null,
  };

  allRequests[id] = request;
  safeWrite(DOC_REQUESTS_KEY, allRequests);

  return request;
}

////////////////////////////////////////////////////////////
// Get Requests
////////////////////////////////////////////////////////////
export function getAllDocumentRequests() {
  return safeRead(DOC_REQUESTS_KEY, {});
}

export function getDocumentRequestById(requestId) {
  const allRequests = safeRead(DOC_REQUESTS_KEY, {});
  return allRequests[requestId] || null;
}

////////////////////////////////////////////////////////////
// Employee: Pending Documents
////////////////////////////////////////////////////////////
export function getPendingDocumentsForUser(user) {
  if (!user?.id) return [];

  const allRequests = safeRead(DOC_REQUESTS_KEY, {});

  return Object.values(allRequests).filter(
    (doc) => doc.employeeId === user.id && doc.status === 'pending'
  );
}

////////////////////////////////////////////////////////////
// Active Document (for editing page)
////////////////////////////////////////////////////////////
export function setActiveDocumentRequest(requestId) {
  localStorage.setItem(ACTIVE_DOC_REQUEST_KEY, requestId);
}

export function getActiveDocumentRequestId() {
  return localStorage.getItem(ACTIVE_DOC_REQUEST_KEY);
}

export function clearActiveDocumentRequest() {
  localStorage.removeItem(ACTIVE_DOC_REQUEST_KEY);
}

////////////////////////////////////////////////////////////
// Employee submits completed document
////////////////////////////////////////////////////////////
export function submitCompletedDocument(requestId, payload = {}) {
  const allRequests = safeRead(DOC_REQUESTS_KEY, {});
  const allSubmissions = safeRead(DOC_SUBMISSIONS_KEY, {});

  const request = allRequests[requestId];

  if (!request) {
    throw new Error('Document request not found');
  }

  const submittedAt = new Date().toISOString();

  const completedDoc = {
    ...request,
    ...payload,
    id: requestId,
    status: 'submitted',
    submittedAt,
  };

  allRequests[requestId] = {
    ...request,
    status: 'submitted',
    submittedAt,
  };

  allSubmissions[requestId] = completedDoc;

  safeWrite(DOC_REQUESTS_KEY, allRequests);
  safeWrite(DOC_SUBMISSIONS_KEY, allSubmissions);

  return completedDoc;
}

////////////////////////////////////////////////////////////
// Carrie: Completed Documents
////////////////////////////////////////////////////////////
export function getCompletedDocumentsForCarrie(user) {
  if (!isCarrieLu(user)) return [];

  const allSubmissions = safeRead(DOC_SUBMISSIONS_KEY, {});

  return Object.values(allSubmissions).sort((a, b) => {
    return new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0);
  });
}

////////////////////////////////////////////////////////////
// Download Document
////////////////////////////////////////////////////////////
export function downloadCompletedDocument(doc) {
  if (!doc) return;

  const downloadData = doc.completedFileData || doc.fileData;

  if (!downloadData) {
    throw new Error('Completed document file is missing');
  }

  const employeeName = String(doc.employeeName || 'Employee')
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_');

  const originalName = String(doc.fileName || 'document.pdf')
    .replace(/[^a-z0-9._-]/gi, '_');

  const a = document.createElement('a');
  a.href = downloadData;
  a.download = `Completed_${employeeName}_${originalName}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

////////////////////////////////////////////////////////////
// Delete / Cleanup (optional)
////////////////////////////////////////////////////////////
export function deleteDocumentRequest(requestId) {
  const allRequests = safeRead(DOC_REQUESTS_KEY, {});
  const allSubmissions = safeRead(DOC_SUBMISSIONS_KEY, {});

  delete allRequests[requestId];
  delete allSubmissions[requestId];

  safeWrite(DOC_REQUESTS_KEY, allRequests);
  safeWrite(DOC_SUBMISSIONS_KEY, allSubmissions);
}

export function clearAllDocumentRequests() {
  localStorage.removeItem(DOC_REQUESTS_KEY);
  localStorage.removeItem(DOC_SUBMISSIONS_KEY);
  localStorage.removeItem(ACTIVE_DOC_REQUEST_KEY);
}