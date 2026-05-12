const NDA_REQUIRED_KEY = 'ags_nda_required_users';
const NDA_SIGNED_KEY = 'ags_nda_signed_docs';
const NDA_DISMISSED_KEY = 'ags_nda_notification_dismissed';
const ACTIVE_SHREE_NDA_REVIEW_KEY = 'ags_active_shree_nda_review_id';

const CARRIE_EMAIL = 'carriel@libsysinc.com';
const SHREE_EMAIL = 'shreey@amgsol.com';

function safeParse(key, fallback = {}) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function safeWrite(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function createEsignTrackingId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `esign_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function formatCentralTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    timeZoneName: 'short',
  }).format(date);
}

export function getDeviceInfo() {
  const ua = navigator.userAgent || 'Unknown device';
  const platform = navigator.platform || '';
  return platform ? `${platform} - ${ua}` : ua;
}

export async function getPublicIpAddress() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    return data.ip || 'Unavailable';
  } catch {
    return 'Unavailable';
  }
}

export function isCarrieLu(user) {
  const email = normalizeEmail(user?.email);
  const name = String(user?.name || user?.full_name || '').trim().toLowerCase();
  const role = String(user?.type || user?.role || '').trim().toLowerCase();

  return email === CARRIE_EMAIL && name === 'carrie lu' && role === 'manager';
}

export function isShreeYerramsetti(user) {
  const email = normalizeEmail(user?.email);
  const name = String(user?.name || user?.full_name || '').trim().toLowerCase();
  const role = String(user?.type || user?.role || '').trim().toLowerCase();

  return (
    email === SHREE_EMAIL &&
    (name === 'shree yerramsetti' || name.includes('shree')) &&
    role === 'admin'
  );
}

export function markNdaRequiredForUser(user) {
  const email = normalizeEmail(user?.email);
  if (!email) return;

  const requiredUsers = safeParse(NDA_REQUIRED_KEY, {});

  requiredUsers[email] = {
    userId: user?.id || '',
    email,
    name: user?.name || user?.full_name || '',
    employeeId: user?.employee_id || user?.employee_no || '',
    role: user?.role || user?.type || 'employee',
    required: true,
    createdAt: new Date().toISOString(),
    createdAtDisplay: formatCentralTime(),
  };

  safeWrite(NDA_REQUIRED_KEY, requiredUsers);
}

export function isNdaRequired(user) {
  const email = normalizeEmail(user?.email);
  if (!email) return false;

  const requiredUsers = safeParse(NDA_REQUIRED_KEY, {});
  const signedDocs = safeParse(NDA_SIGNED_KEY, {});
  const existing = signedDocs[email];

  return Boolean(
    requiredUsers[email]?.required &&
    !existing?.employeeSubmittedAt &&
    existing?.status !== 'shree_pending' &&
    existing?.status !== 'completed_for_carrie'
  );
}

export function saveSignedNda(user, ndaData = {}) {
  const email = normalizeEmail(user?.email || ndaData?.email);
  if (!email) return null;

  const signedDocs = safeParse(NDA_SIGNED_KEY, {});
  const submittedAt = new Date().toISOString();

  const employeeSentAt =
    ndaData?.employeeSentAt ||
    ndaData?.sentAt ||
    formatCentralTime(new Date());

  const employeeSignedAt =
    ndaData?.employeeSignedAt ||
    ndaData?.signedAt ||
    formatCentralTime(new Date());

  const trackingId =
    ndaData?.trackingId ||
    ndaData?.eSignTrackingId ||
    ndaData?.esignTrackingId ||
    createEsignTrackingId();

  const employeeIpAddress =
    ndaData?.employeeIpAddress ||
    ndaData?.ipAddress ||
    'Unavailable';

  const employeeDevice =
    ndaData?.employeeDevice ||
    ndaData?.device ||
    getDeviceInfo();

  const employeeConsent =
    ndaData?.employeeConsent ??
    ndaData?.consentAccepted ??
    ndaData?.consent === 'Accepted';

  const savedNda = {
    id: `nda_${Date.now()}_${email}`,
    trackingId,
    esignTrackingId: trackingId,
    eSignTrackingId: trackingId,

    userId: user?.id || ndaData?.userId || '',
    email,
    name: ndaData?.fullName || user?.name || user?.full_name || '',
    employeeId: user?.employee_id || user?.employee_no || ndaData?.employeeId || '',
    fullName: ndaData?.fullName || user?.name || user?.full_name || '',
    address: ndaData?.address || '',
    employeeInitials: ndaData?.initials || '',
    initials: ndaData?.initials || '',
    title: ndaData?.title || user?.designation || user?.title || '',
    date: ndaData?.date || new Date().toISOString().slice(0, 10),

    employeeSignature: ndaData?.signature || '',
    signature: ndaData?.signature || '',
    employeeSignatureType:
      ndaData?.employeeSignatureType ||
      ndaData?.signatureType ||
      'Drawn Signature',

    employeeSentAt,
    employeeSignedAt,
    employeeIpAddress,
    employeeDevice,
    employeeConsent,

    ipAddress: employeeIpAddress,
    device: employeeDevice,
    consent: employeeConsent ? 'Accepted' : '',

    employeePdfData: ndaData?.signedPdfData || '',
    signedPdfData: ndaData?.signedPdfData || '',

    status: 'shree_pending',
    assignedToEmail: SHREE_EMAIL,
    employeeSubmittedAt: submittedAt,
    submittedAt,

    shreeName: 'Shree Yerramsetti',
    shreeEmail: SHREE_EMAIL,
    shreeTitle: 'CEO',
    shreeInitials: '',
    shreeDate: '',
    shreeSignature: '',
    shreeSignatureType: '',
    shreeSentAt: formatCentralTime(new Date()),
    shreeSignedAt: '',
    shreeIpAddress: '',
    shreeDevice: '',
    shreeConsent: false,
    shreeSubmittedAt: '',

    completedAt: ndaData?.completedAt || '',
    completedAtDisplay: ndaData?.completedAtDisplay || ndaData?.signedAt || '',
    signerCount: ndaData?.signerReviewerCount || ndaData?.signerCount || 1,
    signerReviewerCount: ndaData?.signerReviewerCount || ndaData?.signerCount || 1,

    holderName: ndaData?.holderName || 'Carrie Lu',
    holderEmail: ndaData?.holderEmail || CARRIE_EMAIL,

    dismissedByShree: false,
    dismissedByCarrie: false,
  };

  signedDocs[email] = savedNda;
  safeWrite(NDA_SIGNED_KEY, signedDocs);

  const requiredUsers = safeParse(NDA_REQUIRED_KEY, {});
  if (requiredUsers[email]) {
    requiredUsers[email] = {
      ...requiredUsers[email],
      required: false,
      employeeCompletedAt: submittedAt,
      employeeCompletedAtDisplay: employeeSignedAt,
      sentToShreeAt: submittedAt,
      sentToShreeAtDisplay: savedNda.shreeSentAt,
      trackingId,
      esignTrackingId: trackingId,
      eSignTrackingId: trackingId,
    };
    safeWrite(NDA_REQUIRED_KEY, requiredUsers);
  }

  resetNdaNotificationDismissedForShree();

  return savedNda;
}

export function saveShreeCompletedNda(ndaIdOrEmail, shreeData = {}) {
  const signedDocs = safeParse(NDA_SIGNED_KEY, {});
  const submittedAt = new Date().toISOString();

  let targetEmail = normalizeEmail(ndaIdOrEmail);

  if (!signedDocs[targetEmail]) {
    const found = Object.values(signedDocs).find((nda) => nda.id === ndaIdOrEmail);
    targetEmail = normalizeEmail(found?.email);
  }

  if (!targetEmail || !signedDocs[targetEmail]) {
    throw new Error('NDA document not found for Shree review.');
  }

  const existing = signedDocs[targetEmail];

  const trackingId =
    existing.trackingId ||
    existing.esignTrackingId ||
    existing.eSignTrackingId ||
    createEsignTrackingId();

  const shreeSignedAt =
    shreeData?.shreeSignedAt ||
    shreeData?.signedAt ||
    formatCentralTime(new Date());

  const completedAtDisplay =
    shreeData?.completedAtDisplay ||
    formatCentralTime(new Date());

  const updatedNda = {
    ...existing,
    trackingId,
    esignTrackingId: trackingId,
    eSignTrackingId: trackingId,

    status: 'completed_for_carrie',
    assignedToEmail: CARRIE_EMAIL,

    shreeName: shreeData?.shreeName || 'Shree Yerramsetti',
    shreeEmail: shreeData?.shreeEmail || SHREE_EMAIL,
    shreeTitle: shreeData?.shreeTitle || 'CEO',
    shreeInitials: shreeData?.shreeInitials || '',
    shreeDate: shreeData?.shreeDate || new Date().toISOString().slice(0, 10),
    shreeSignature: shreeData?.shreeSignature || '',
    shreeSignatureType:
      shreeData?.shreeSignatureType ||
      shreeData?.signatureType ||
      'Drawn Signature',

    shreeSentAt: existing.shreeSentAt || formatCentralTime(new Date()),
    shreeSignedAt,
    shreeIpAddress:
      shreeData?.shreeIpAddress ||
      shreeData?.ipAddress ||
      'Unavailable',
    shreeDevice:
      shreeData?.shreeDevice ||
      shreeData?.device ||
      getDeviceInfo(),
    shreeConsent:
      shreeData?.shreeConsent ??
      shreeData?.consentAccepted ??
      shreeData?.consent === 'Accepted',

    finalPdfData: shreeData?.finalPdfData || existing.signedPdfData || '',
    signedPdfData: shreeData?.finalPdfData || existing.signedPdfData || '',

    shreeSubmittedAt: submittedAt,
    completedAt: submittedAt,
    completedAtDisplay,
    submittedAt,
    signerCount: 2,
    signerReviewerCount: 2,

    dismissedByShree: true,
    dismissedByCarrie: false,
  };

  signedDocs[targetEmail] = updatedNda;
  safeWrite(NDA_SIGNED_KEY, signedDocs);

  clearActiveShreeNdaReview();
  resetNdaNotificationDismissedForCarrie();

  return updatedNda;
}

export function getSignedNda(user) {
  const email = normalizeEmail(user?.email);
  if (!email) return null;
  return safeParse(NDA_SIGNED_KEY, {})[email] || null;
}

export function getAllSignedNdas() {
  return safeParse(NDA_SIGNED_KEY, {});
}

export function getNdaById(ndaId) {
  return Object.values(safeParse(NDA_SIGNED_KEY, {})).find((nda) => nda.id === ndaId) || null;
}

export function getNdaByEmail(email) {
  return safeParse(NDA_SIGNED_KEY, {})[normalizeEmail(email)] || null;
}

export function getPendingNdasForShree(user) {
  if (!isShreeYerramsetti(user)) return [];

  return Object.values(safeParse(NDA_SIGNED_KEY, {}))
    .filter((nda) => nda.status === 'shree_pending' && !nda.dismissedByShree)
    .sort(
      (a, b) =>
        new Date(b.employeeSubmittedAt || b.submittedAt || 0) -
        new Date(a.employeeSubmittedAt || a.submittedAt || 0)
    );
}

export function getCompletedNdasForCarrie(user) {
  if (!isCarrieLu(user)) return [];

  return Object.values(safeParse(NDA_SIGNED_KEY, {}))
    .filter((nda) => nda.status === 'completed_for_carrie' && !nda.dismissedByCarrie)
    .sort(
      (a, b) =>
        new Date(b.completedAt || b.submittedAt || 0) -
        new Date(a.completedAt || a.submittedAt || 0)
    );
}

export function getCarrieVisibleSignedNdas(user) {
  return getCompletedNdasForCarrie(user);
}

export function setActiveShreeNdaReview(ndaId) {
  localStorage.setItem(ACTIVE_SHREE_NDA_REVIEW_KEY, ndaId);
}

export function getActiveShreeNdaReviewId() {
  return localStorage.getItem(ACTIVE_SHREE_NDA_REVIEW_KEY);
}

export function clearActiveShreeNdaReview() {
  localStorage.removeItem(ACTIVE_SHREE_NDA_REVIEW_KEY);
}

export function clearSignedNda(user) {
  const email = normalizeEmail(user?.email);
  if (!email) return;

  const signedDocs = safeParse(NDA_SIGNED_KEY, {});
  delete signedDocs[email];
  safeWrite(NDA_SIGNED_KEY, signedDocs);
}

export function dismissShreeNdaNotification(ndaOrEmail) {
  const email = normalizeEmail(typeof ndaOrEmail === 'string' ? ndaOrEmail : ndaOrEmail?.email);
  if (!email) return;

  const signedDocs = safeParse(NDA_SIGNED_KEY, {});
  if (signedDocs[email]) {
    signedDocs[email] = {
      ...signedDocs[email],
      dismissedByShree: true,
      dismissedByShreeAt: new Date().toISOString(),
    };
    safeWrite(NDA_SIGNED_KEY, signedDocs);
  }
}

export function dismissSignedNdaNotification(ndaOrEmail) {
  const email = normalizeEmail(typeof ndaOrEmail === 'string' ? ndaOrEmail : ndaOrEmail?.email);
  if (!email) return;

  const signedDocs = safeParse(NDA_SIGNED_KEY, {});
  if (signedDocs[email]) {
    signedDocs[email] = {
      ...signedDocs[email],
      dismissedByCarrie: true,
      dismissedByCarrieAt: new Date().toISOString(),
    };
    safeWrite(NDA_SIGNED_KEY, signedDocs);
  }
}

export function deleteSignedNda(ndaOrEmail) {
  const email = normalizeEmail(typeof ndaOrEmail === 'string' ? ndaOrEmail : ndaOrEmail?.email);
  if (!email) return;

  const signedDocs = safeParse(NDA_SIGNED_KEY, {});
  delete signedDocs[email];
  safeWrite(NDA_SIGNED_KEY, signedDocs);
}

export function resetNdaRequirement(user) {
  const email = normalizeEmail(user?.email);
  if (!email) return;

  const requiredUsers = safeParse(NDA_REQUIRED_KEY, {});
  requiredUsers[email] = {
    userId: user?.id || '',
    email,
    name: user?.name || user?.full_name || '',
    employeeId: user?.employee_id || user?.employee_no || '',
    role: user?.role || user?.type || 'employee',
    required: true,
    resetAt: new Date().toISOString(),
    resetAtDisplay: formatCentralTime(),
  };

  safeWrite(NDA_REQUIRED_KEY, requiredUsers);
}

export function canViewNdaNotifications(user) {
  return isCarrieLu(user) || isShreeYerramsetti(user);
}

export function isNdaNotificationDismissed(user) {
  const email = normalizeEmail(user?.email);
  if (!email) return false;

  return safeParse(NDA_DISMISSED_KEY, {})[email] === true;
}

export function dismissNdaNotification(user) {
  const email = normalizeEmail(user?.email);
  if (!email) return;

  const dismissed = safeParse(NDA_DISMISSED_KEY, {});
  dismissed[email] = true;
  safeWrite(NDA_DISMISSED_KEY, dismissed);
}

export function resetNdaNotificationDismissedForCarrie() {
  const dismissed = safeParse(NDA_DISMISSED_KEY, {});
  dismissed[CARRIE_EMAIL] = false;
  safeWrite(NDA_DISMISSED_KEY, dismissed);
}

export function resetNdaNotificationDismissedForShree() {
  const dismissed = safeParse(NDA_DISMISSED_KEY, {});
  dismissed[SHREE_EMAIL] = false;
  safeWrite(NDA_DISMISSED_KEY, dismissed);
}

export function resetNdaNotificationDismissedForAllowedViewers() {
  const dismissed = safeParse(NDA_DISMISSED_KEY, {});
  dismissed[CARRIE_EMAIL] = false;
  dismissed[SHREE_EMAIL] = false;
  safeWrite(NDA_DISMISSED_KEY, dismissed);
}

function dataUrlToBlob(dataUrl) {
  const parts = String(dataUrl || '').split(',');
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/pdf';
  const binary = atob(parts[1] || '');
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

export function downloadNdaDocument(nda) {
  if (!nda) return;

  const downloadData =
    nda.finalPdfData ||
    nda.signedPdfData ||
    nda.employeePdfData ||
    nda.completedFileData ||
    nda.fileData;

  if (!downloadData) {
    alert('Signed PDF is missing. Please complete the NDA workflow again.');
    return;
  }

  const safeName = String(nda.fullName || nda.name || 'Employee')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_');

  const fileName = `Fully_Signed_NDA_${safeName}.pdf`;

  const blob = dataUrlToBlob(downloadData);
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

export function clearAllNdaData() {
  localStorage.removeItem(NDA_REQUIRED_KEY);
  localStorage.removeItem(NDA_SIGNED_KEY);
  localStorage.removeItem(NDA_DISMISSED_KEY);
  localStorage.removeItem(ACTIVE_SHREE_NDA_REVIEW_KEY);
}