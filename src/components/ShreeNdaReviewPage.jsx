import { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { api } from '../api/client';

const SHREE_EMAIL = 'shreey@amgsol.com';

function formatCentralTime(date = new Date()) {
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

function getDeviceInfo() {
  const platform = navigator.platform || '';
  const userAgent = navigator.userAgent || '';

  if (/Win/i.test(platform) || /Windows/i.test(userAgent)) return 'Windows';
  if (/Mac/i.test(platform) || /Macintosh/i.test(userAgent)) return 'Mac';
  if (/Linux/i.test(platform) || /Linux/i.test(userAgent)) return 'Linux';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iOS';

  return 'Unknown device';
}

async function getPublicIpAddress() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    return data.ip || 'Unavailable';
  } catch {
    return 'Unavailable';
  }
}

function getNdaIdFromUrl() {
  const path = window.location.pathname || '';
  const parts = path.split('/').filter(Boolean);
  const idx = parts.indexOf('shree-nda-review');
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return '';
}

function getPdfFieldRect(page, field) {
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();

  const viewerWidth = Number(field.viewer_width || pageWidth);
  const viewerHeight = Number(field.viewer_height || pageHeight);

  const rawX = Number(field.x || 0);
  const rawY = Number(field.y || 0);
  const rawWidth = Number(field.width || 150);
  const rawHeight = Number(field.height || 24);

  const scaleX = pageWidth / viewerWidth;
  const scaleY = pageHeight / viewerHeight;

  return {
    x: rawX * scaleX,
    y: pageHeight - (rawY + rawHeight) * scaleY,
    width: rawWidth * scaleX,
    height: rawHeight * scaleY,
  };
}

function getFontSize(fieldType, height) {
  if (fieldType === 'initials') return Math.min(10, Math.max(7, height * 0.45));
  if (fieldType === 'date') return Math.min(9, Math.max(7, height * 0.42));
  return Math.min(10, Math.max(7, height * 0.42));
}

const FIELD_DEFAULTS = {
  shree_name: 'Shree Yerramsetti',
  shree_email: SHREE_EMAIL,
  shree_initials: 'SY',
  shree_date: new Date().toISOString().slice(0, 10),
};

const FIELD_LABELS = {
  shree_name: 'Shree Name',
  shree_email: 'Shree Email',
  shree_initials: 'Shree Initials',
  shree_signature: 'Shree Signature',
  shree_date: 'Date',
};

export default function ShreeNdaReviewPage({
  currentUser,
  isDark = false,
  ndaId: ndaIdProp,
}) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  const ndaId = ndaIdProp || getNdaIdFromUrl();

  const [loading, setLoading] = useState(true);
  const [nda, setNda] = useState(null);
  const [templateUrl, setTemplateUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [fields, setFields] = useState([]);

  const [formValues, setFormValues] = useState(() => ({
    ...FIELD_DEFAULTS,
  }));

  const [signatureMode, setSignatureMode] = useState('draw');
  const [uploadedSignature, setUploadedSignature] = useState('');

  const [consentAccepted, setConsentAccepted] = useState(false);
  const [ipAddress, setIpAddress] = useState('Unavailable');
  const [deviceInfo] = useState(getDeviceInfo());
  const [sentAt] = useState(formatCentralTime(new Date()));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [updatingPreview, setUpdatingPreview] = useState(false);

  const isShree =
    String(currentUser?.email || '').toLowerCase() === SHREE_EMAIL ||
    currentUser?.type === 'admin';

  const inputClass = isDark
    ? 'w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder-gray-400 outline-none focus:ring-2 focus:ring-green-500'
    : 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 outline-none focus:ring-2 focus:ring-green-500';

  const cardClass = isDark
    ? 'bg-slate-800 border-slate-700 text-white'
    : 'bg-white border-gray-200 text-gray-900';

  const shreeFields = useMemo(
    () =>
      (fields || []).filter(
        (field) =>
          field.signer_role === 'shree' &&
          field.field_type !== 'signature',
      ),
    [fields],
  );

  const hasSignatureField = useMemo(
    () =>
      (fields || []).some(
        (field) =>
          field.signer_role === 'shree' &&
          field.field_type === 'signature',
      ),
    [fields],
  );

  useEffect(() => {
    let active = true;

    getPublicIpAddress().then((ip) => {
      if (active) setIpAddress(ip);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    async function loadNda() {
      if (!ndaId) {
        setError('NDA request ID is missing. Please open the NDA from notifications.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError('');

        const data = await api.get(`/api/nda/${ndaId}`);

        setNda(data.nda || null);
        setFields(data.fields || []);
        setTemplateUrl(
          data.employeePdfUrl ||
            data.employee_pdf_url ||
            data.templateUrl ||
            data.template_url ||
            '',
        );

        setFormValues((prev) => ({
          ...prev,
          shree_name: prev.shree_name || 'Shree Yerramsetti',
          shree_email: prev.shree_email || SHREE_EMAIL,
          shree_initials: prev.shree_initials || 'SY',
          shree_date: prev.shree_date || new Date().toISOString().slice(0, 10),
        }));
      } catch (e) {
        setError(e.message || 'Unable to load NDA review.');
      } finally {
        setLoading(false);
      }
    }

    loadNda();
  }, [ndaId]);

  const updateValue = (key, value) => {
    setFormValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const touch = e.touches?.[0];

    return {
      x: (touch ? touch.clientX : e.clientX) - rect.left,
      y: (touch ? touch.clientY : e.clientY) - rect.top,
    };
  };

  const startDraw = (e) => {
    drawing.current = true;
    draw(e);
  };

  const stopDraw = () => {
    drawing.current = false;
    const ctx = canvasRef.current?.getContext('2d');
    ctx?.beginPath();
  };

  const draw = (e) => {
    if (!drawing.current) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getPos(e);

    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');

    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    setUploadedSignature('');
  };

  const isCanvasSignatureEmpty = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return true;

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return !pixels.some((value) => value !== 0);
  };

  const hasSignature = () => {
    if (!hasSignatureField) return true;
    if (signatureMode === 'upload') return Boolean(uploadedSignature);
    return !isCanvasSignatureEmpty();
  };

  const getSignatureDataUrl = () => {
    if (!hasSignatureField) return '';
    if (signatureMode === 'upload') return uploadedSignature;
    return canvasRef.current?.toDataURL('image/png') || '';
  };

  const handleSignatureUpload = (file) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please upload a PNG or JPG signature image.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setUploadedSignature(String(reader.result || ''));
      setSignatureMode('upload');
      setError('');
    };
    reader.readAsDataURL(file);
  };

  const renderFieldInput = (field) => {
    const key = field.field_key;
    const label = field.field_label || FIELD_LABELS[key] || key;
    const value = formValues[key] ?? '';

    if (key === 'shree_name' || key === 'shree_email') {
      return (
        <input
          value={value}
          disabled
          className={`${inputClass} opacity-70`}
        />
      );
    }

    if (field.field_type === 'date') {
      return (
        <input
          type="date"
          value={value}
          onChange={(e) => updateValue(key, e.target.value)}
          className={inputClass}
          required={field.required !== false}
        />
      );
    }

    return (
      <input
        value={value}
        onChange={(e) =>
          updateValue(
            key,
            field.field_type === 'initials'
              ? e.target.value.toUpperCase()
              : e.target.value,
          )
        }
        className={inputClass}
        placeholder={label}
        maxLength={field.field_type === 'initials' ? 8 : undefined}
        required={field.required !== false}
      />
    );
  };

  const generatePreview = async () => {
    try {
      setUpdatingPreview(true);
      setError('');

      if (!templateUrl) {
        setError('Employee signed PDF preview is unavailable.');
        return;
      }

      const existingPdfBytes = await fetch(templateUrl).then((res) =>
        res.arrayBuffer(),
      );

      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      for (const field of shreeFields) {
        const value = String(formValues[field.field_key] || '');
        if (!value) continue;

        const pageIndex = Number(field.page_number || 1) - 1;
        const page = pdfDoc.getPage(pageIndex);
        if (!page) continue;

        const rect = getPdfFieldRect(page, field);
        const fontSize = getFontSize(field.field_type, rect.height);

        page.drawText(value, {
          x: rect.x + 2,
          y: rect.y + Math.max(2, rect.height / 2 - fontSize / 2),
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
          maxWidth: Math.max(20, rect.width - 4),
        });
      }

      const signatureField = fields.find(
        (f) =>
          f.signer_role === 'shree' &&
          f.field_type === 'signature',
      );

      if (signatureField) {
        const signatureData = getSignatureDataUrl();

        if (signatureData) {
          const pageIndex = Number(signatureField.page_number || 1) - 1;
          const page = pdfDoc.getPage(pageIndex);

          if (page) {
            const rect = getPdfFieldRect(page, signatureField);

            const image =
              signatureData.includes('image/jpeg') ||
              signatureData.includes('image/jpg')
                ? await pdfDoc.embedJpg(signatureData)
                : await pdfDoc.embedPng(signatureData);

            page.drawImage(image, {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            });
          }
        }
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });

      if (previewUrl) URL.revokeObjectURL(previewUrl);

      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      console.error(e);
      setError('Failed to generate Shree preview.');
    } finally {
      setUpdatingPreview(false);
    }
  };

  const validate = () => {
    if (!nda) {
      return 'NDA document not found. Please open it again from notifications.';
    }

    for (const field of shreeFields) {
      if (
        field.required !== false &&
        !String(formValues[field.field_key] || '').trim()
      ) {
        return `Please enter ${field.field_label || field.field_key}.`;
      }
    }

    const missingMetrics = fields.some(
      (field) =>
        field.signer_role === 'shree' &&
        (!field.viewer_width ||
          !field.viewer_height ||
          !field.pdf_width ||
          !field.pdf_height),
    );

    if (missingMetrics) {
      return 'This NDA template was saved without PDF size data. Carrie must re-save the active template from Edit NDA Form.';
    }

    if (!hasSignature()) {
      return 'Please draw or upload Shree signature.';
    }

    if (!consentAccepted) {
      return 'Please accept the consent checkbox before submitting.';
    }

    return '';
  };

  const handleSubmit = async () => {
    setError('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSubmitting(true);

      const signedAt = formatCentralTime(new Date());

      const payload = {
        field_values: {
          ...formValues,
          shree_name: formValues.shree_name || 'Shree Yerramsetti',
          shree_email: formValues.shree_email || SHREE_EMAIL,
        },
        signature: getSignatureDataUrl(),
        audit: {
          signer_role: 'shree',
          signer_name: formValues.shree_name || 'Shree Yerramsetti',
          signer_email: formValues.shree_email || SHREE_EMAIL,
          sent_at: sentAt,
          signed_at: signedAt,
          ip_address: ipAddress,
          device: deviceInfo,
          consent_accepted: consentAccepted,
        },
      };

      await api.post(`/api/nda/${ndaId}/shree-submit`, payload);

      alert('NDA completed and sent to Carrie Lu.');
      window.location.href = '/';
    } catch (e) {
      setError(e.message || 'Failed to complete NDA.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className={`flex min-h-screen items-center justify-center p-6 ${isDark ? 'bg-slate-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
        <p className="text-sm">Loading Shree NDA review...</p>
      </div>
    );
  }

  if (!isShree) {
    return (
      <div className={`flex min-h-screen items-center justify-center p-6 ${isDark ? 'bg-slate-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
        <div className={`w-full max-w-md rounded-xl border p-6 text-center ${cardClass}`}>
          <h1 className="text-xl font-bold">Access denied</h1>
          <p className={`mt-2 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Only Shree/admin can complete this NDA review.
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.href = '/';
            }}
            className="mt-5 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (!nda) {
    return (
      <div className={`flex min-h-screen items-center justify-center p-6 ${isDark ? 'bg-slate-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
        <div className={`w-full max-w-md rounded-xl border p-6 text-center ${cardClass}`}>
          <h1 className="text-xl font-bold">NDA not found</h1>
          <p className={`mt-2 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Please open the NDA again from notifications.
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.href = '/';
            }}
            className="mt-5 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const employeeName =
    nda.employee_name ||
    nda.fullName ||
    nda.name ||
    'Employee';

  const employeeEmail = nda.employee_email || nda.email || '';

  return (
    <div className={`min-h-screen p-4 md:p-6 ${isDark ? 'bg-slate-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      <div className="mx-auto max-w-6xl space-y-4">
        <div className={`rounded-xl border p-5 ${cardClass}`}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl font-bold">Shree NDA Review</h1>
              <p className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Complete the Shree/CEO fields from Carrie Lu’s active NDA template.
              </p>
              <p className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Employee: {employeeName} {employeeEmail ? `• ${employeeEmail}` : ''}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                isDark
                  ? 'border-slate-600 text-gray-300 hover:bg-slate-700'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-100'
              }`}
            >
              Back
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_0.85fr]">
          <div className={`overflow-hidden rounded-xl border ${cardClass}`}>
            <div className={`border-b px-4 py-3 ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
              <p className="text-sm font-semibold">Employee Signed NDA Preview</p>
              <p className={`mt-0.5 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Click Update Preview to view Shree’s latest filled values before final submission.
              </p>
            </div>

            {previewUrl || templateUrl ? (
              <div>
                <div className="flex items-center justify-end gap-2 border-b px-4 py-2">
                  <button
                    type="button"
                    onClick={generatePreview}
                    disabled={updatingPreview || !templateUrl}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {updatingPreview ? 'Updating Preview...' : 'Update Preview'}
                  </button>
                </div>

                <iframe
                  src={previewUrl || templateUrl}
                  title="Employee Signed NDA Preview"
                  className="h-[760px] w-full bg-white"
                />
              </div>
            ) : (
              <div className="flex h-[760px] items-center justify-center">
                <p className="text-sm text-gray-500">Preview unavailable.</p>
              </div>
            )}
          </div>

          <div className={`rounded-xl border p-5 ${cardClass}`}>
            <h2 className="text-lg font-semibold">Shree Details</h2>
            <p className={`mt-1 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Final signed PDF will go to Carrie Lu after submit.
            </p>

            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-300">
              <p><b>Name:</b> {formValues.shree_name}</p>
              <p><b>Email:</b> {formValues.shree_email}</p>
              <p><b>Sent Time:</b> {sentAt}</p>
              <p><b>IP Address:</b> {ipAddress}</p>
              <p><b>Signer/Reviewer Count:</b> 2</p>
            </div>

            <div className="mt-5 space-y-4">
              {shreeFields.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                  No Shree fields found for this NDA template. Carrie Lu must edit the NDA form and add Shree boxes.
                </div>
              ) : (
                shreeFields.map((field) => (
                  <div key={field.id || field.field_key}>
                    <label className={`mb-1 block text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {field.field_label || FIELD_LABELS[field.field_key] || field.field_key}
                      {field.required !== false ? ' *' : ''}
                    </label>
                    {renderFieldInput(field)}
                  </div>
                ))
              )}

              {hasSignatureField && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <label className={`block text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      Shree Signature *
                    </label>

                    <div className="overflow-hidden rounded-lg border border-gray-300 text-xs">
                      <button
                        type="button"
                        onClick={() => setSignatureMode('draw')}
                        className={`px-3 py-1 ${signatureMode === 'draw' ? 'bg-brand text-white' : ''}`}
                      >
                        Cursor
                      </button>

                      <button
                        type="button"
                        onClick={() => setSignatureMode('upload')}
                        className={`px-3 py-1 ${signatureMode === 'upload' ? 'bg-brand text-white' : ''}`}
                      >
                        Upload
                      </button>
                    </div>
                  </div>

                  {signatureMode === 'draw' ? (
                    <canvas
                      ref={canvasRef}
                      width={520}
                      height={150}
                      className="h-[150px] w-full touch-none cursor-crosshair rounded-lg border border-gray-400 bg-white"
                      onMouseDown={startDraw}
                      onMouseMove={draw}
                      onMouseUp={stopDraw}
                      onMouseLeave={stopDraw}
                      onTouchStart={startDraw}
                      onTouchMove={draw}
                      onTouchEnd={stopDraw}
                    />
                  ) : (
                    <div className="space-y-2">
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        onChange={(e) => handleSignatureUpload(e.target.files?.[0])}
                        className={inputClass}
                      />

                      {uploadedSignature && (
                        <img
                          src={uploadedSignature}
                          alt="Uploaded signature"
                          className="max-h-24 rounded border bg-white p-2"
                        />
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={clearSignature}
                    className={`rounded-lg border px-3 py-1 text-xs font-medium ${
                      isDark
                        ? 'border-slate-600 text-gray-300 hover:bg-slate-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    Clear Signature
                  </button>
                </div>
              )}

              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                  isDark
                    ? 'border-slate-600 bg-slate-700/60 text-gray-200'
                    : 'border-gray-300 bg-gray-50 text-gray-700'
                }`}
              >
                <input
                  type="checkbox"
                  checked={consentAccepted}
                  onChange={(e) => setConsentAccepted(e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  I accept and consent to electronically sign this NDA as Shree Yerramsetti.
                  The audit page will show Consent as{' '}
                  <b>{consentAccepted ? 'Accepted' : 'Not Accepted'}</b>.
                </span>
              </label>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                  {error}
                </div>
              )}

              <button
                type="button"
                disabled={submitting || shreeFields.length === 0}
                onClick={handleSubmit}
                className="w-full rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Final NDA to Carrie Lu'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}