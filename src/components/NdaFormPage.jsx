import { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { api } from '../api/client';

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
  const idx = parts.indexOf('nda-form');
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
  employee_name: '',
  employee_address: '',
  employee_initials: '',
  employee_title: '',
  employee_date: new Date().toISOString().slice(0, 10),
};

const FIELD_LABELS = {
  employee_name: 'Employee Name',
  employee_address: 'Employee Address',
  employee_initials: 'Employee Initials',
  employee_signature: 'Employee Signature',
  employee_title: 'Employee Title',
  employee_date: 'Date',
};

export default function NdaFormPage({
  currentUser,
  isDark = false,
  onSubmit,
  ndaId: ndaIdProp,
}) {
  const canvasRef = useRef(null);
  const fileSignatureRef = useRef(null);
  const drawing = useRef(false);

  const ndaId = ndaIdProp || getNdaIdFromUrl();

  const [loading, setLoading] = useState(true);
  const [nda, setNda] = useState(null);
  const [templateUrl, setTemplateUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploadedSignature, setUploadedSignature] = useState('');
  const [updatingPreview, setUpdatingPreview] = useState(false);
  const [fields, setFields] = useState([]);

  const [formValues, setFormValues] = useState(() => ({
    ...FIELD_DEFAULTS,
    employee_name: currentUser?.name || currentUser?.full_name || '',
    employee_title:
      currentUser?.designation ||
      currentUser?.title ||
      currentUser?.role ||
      currentUser?.type ||
      '',
  }));

  const [consentAccepted, setConsentAccepted] = useState(false);
  const [ipAddress, setIpAddress] = useState('Unavailable');
  const [deviceInfo] = useState(getDeviceInfo());
  const [sentAt] = useState(formatCentralTime(new Date()));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const employeeEmail = currentUser?.email || '';

  const inputClass = isDark
    ? 'w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder-gray-400 outline-none focus:ring-2 focus:ring-green-500'
    : 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 outline-none focus:ring-2 focus:ring-green-500';

  const cardClass = isDark
    ? 'bg-slate-800 border-slate-700 text-white'
    : 'bg-white border-gray-200 text-gray-900';

  const employeeFields = useMemo(
    () =>
      (fields || []).filter(
        (field) =>
          field.signer_role === 'employee' &&
          field.field_type !== 'signature',
      ),
    [fields],
  );

  const hasSignatureField = useMemo(
    () =>
      (fields || []).some(
        (field) =>
          field.signer_role === 'employee' &&
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
        setError('NDA request ID is missing.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError('');

        const data = await api.get(`/api/nda/${ndaId}`);

        setNda(data.nda || null);
        setFields(data.fields || []);
        setTemplateUrl(data.templateUrl || data.template_url || '');

        setFormValues((prev) => ({
          ...prev,
          employee_name:
            prev.employee_name ||
            data.nda?.employee_name ||
            currentUser?.name ||
            currentUser?.full_name ||
            '',
          employee_title:
            prev.employee_title ||
            currentUser?.designation ||
            currentUser?.title ||
            currentUser?.role ||
            currentUser?.type ||
            '',
        }));
      } catch (e) {
        setError(e.message || 'Unable to load NDA form.');
      } finally {
        setLoading(false);
      }
    }

    loadNda();
  }, [ndaId, currentUser]);

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

    if (fileSignatureRef.current) {
      fileSignatureRef.current.value = '';
    }
  };

  const isSignatureEmpty = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return true;

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return !pixels.some((value) => value !== 0);
  };

  const renderFieldInput = (field) => {
    const key = field.field_key;
    const label = field.field_label || FIELD_LABELS[key] || key;
    const value = formValues[key] ?? '';

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

    if (key === 'employee_address') {
      return (
        <textarea
          value={value}
          onChange={(e) => updateValue(key, e.target.value)}
          rows={3}
          className={`${inputClass} resize-none`}
          placeholder={label}
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
        setError('Template PDF is unavailable.');
        return;
      }

      const existingPdfBytes = await fetch(templateUrl).then((res) =>
        res.arrayBuffer(),
      );

      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      for (const field of employeeFields) {
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
          f.signer_role === 'employee' &&
          f.field_type === 'signature',
      );

      if (signatureField) {
        let signatureData = uploadedSignature;

        if (!signatureData && !isSignatureEmpty()) {
          signatureData = canvasRef.current.toDataURL('image/png');
        }

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
      setError('Failed to generate preview.');
    } finally {
      setUpdatingPreview(false);
    }
  };

  const validate = () => {
    for (const field of employeeFields) {
      if (
        field.required !== false &&
        !String(formValues[field.field_key] || '').trim()
      ) {
        return `Please enter ${field.field_label || field.field_key}.`;
      }
    }

    const missingMetrics = fields.some(
      (field) =>
        field.signer_role === 'employee' &&
        (!field.viewer_width ||
          !field.viewer_height ||
          !field.pdf_width ||
          !field.pdf_height),
    );

    if (missingMetrics) {
      return 'This NDA template was saved without PDF size data. Carrie must re-save the active template from Edit NDA Form.';
    }

    if (hasSignatureField && !uploadedSignature && isSignatureEmpty()) {
      return 'Please sign or upload signature before submitting.';
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

      let signature = '';

      if (hasSignatureField) {
        if (uploadedSignature) {
          signature = uploadedSignature;
        } else if (!isSignatureEmpty()) {
          signature = canvasRef.current.toDataURL('image/png');
        }
      }

      const payload = {
        field_values: formValues,
        signature,
        audit: {
          signer_role: 'employee',
          signer_name:
            formValues.employee_name ||
            currentUser?.name ||
            currentUser?.full_name ||
            '',
          signer_email: employeeEmail,
          sent_at: sentAt,
          signed_at: signedAt,
          ip_address: ipAddress,
          device: deviceInfo,
          consent_accepted: consentAccepted,
        },
      };

      const result = await api.post(
        `/api/nda/${ndaId}/employee-submit`,
        payload,
      );

      onSubmit?.(result?.nda || result);
    } catch (e) {
      setError(e.message || 'Failed to submit NDA. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div
        className={`min-h-screen flex items-center justify-center ${
          isDark
            ? 'bg-slate-900 text-white'
            : 'bg-gray-50 text-gray-900'
        }`}
      >
        <p className="text-sm">Loading NDA form...</p>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen p-4 md:p-6 ${
        isDark
          ? 'bg-slate-900 text-white'
          : 'bg-gray-50 text-gray-900'
      }`}
    >
      <div className="mx-auto max-w-6xl space-y-4">
        <div className={`rounded-xl border p-5 ${cardClass}`}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl font-bold">Complete NDA Document</h1>
              <p
                className={`mt-1 text-sm ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                Please complete and sign this one-time NDA before accessing the dashboard.
              </p>
              <p
                className={`mt-1 text-xs ${
                  isDark ? 'text-gray-500' : 'text-gray-400'
                }`}
              >
                Logged in as: {currentUser?.name || 'Employee'}{' '}
                {employeeEmail ? `• ${employeeEmail}` : ''}
              </p>
            </div>

            <div className="rounded-lg bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              After submit, NDA goes to Shree Yerramsetti for final signature
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_0.85fr]">
          <div className={`overflow-hidden rounded-xl border ${cardClass}`}>
            <div
              className={`border-b px-4 py-3 ${
                isDark ? 'border-slate-700' : 'border-gray-200'
              }`}
            >
              <p className="text-sm font-semibold">NDA PDF Preview</p>
              <p
                className={`mt-0.5 text-xs ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                Click Update Preview to view your latest filled values on the PDF.
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
                  title="NDA PDF Preview"
                  className="h-[760px] w-full bg-white"
                />
              </div>
            ) : (
              <div className="flex h-[760px] items-center justify-center">
                <p className="text-sm text-gray-500">
                  Template preview unavailable.
                </p>
              </div>
            )}
          </div>

          <div className={`rounded-xl border p-5 ${cardClass}`}>
            <h2 className="text-lg font-semibold">Employee Details</h2>
            <p
              className={`mt-1 text-xs ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              These fields are generated dynamically from Carrie Lu’s active NDA template.
            </p>

            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-300">
              <p>
                <b>NDA Request:</b> {nda?.id || ndaId}
              </p>
              <p>
                <b>Sent At:</b> {sentAt}
              </p>
              <p>
                <b>IP Address:</b> {ipAddress}
              </p>
              <p>
                <b>Device:</b> {deviceInfo}
              </p>
            </div>

            <div className="mt-5 space-y-4">
              {employeeFields.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                  No employee fields found for this NDA template. Carrie Lu must edit the NDA form and add employee boxes.
                </div>
              ) : (
                employeeFields.map((field) => (
                  <div key={field.id || field.field_key}>
                    <label
                      className={`mb-1 block text-sm font-medium ${
                        isDark ? 'text-gray-300' : 'text-gray-700'
                      }`}
                    >
                      {field.field_label ||
                        FIELD_LABELS[field.field_key] ||
                        field.field_key}
                      {field.required !== false ? ' *' : ''}
                    </label>
                    {renderFieldInput(field)}
                  </div>
                ))
              )}

              {hasSignatureField && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label
                      className={`block text-sm font-medium ${
                        isDark ? 'text-gray-300' : 'text-gray-700'
                      }`}
                    >
                      Employee Signature *
                    </label>

                    <button
                      type="button"
                      onClick={clearSignature}
                      className={`rounded-lg border px-3 py-1 text-xs font-medium ${
                        isDark
                          ? 'border-slate-600 text-gray-300 hover:bg-slate-700'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      Clear
                    </button>
                  </div>

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

                  <p
                    className={`mt-1 text-xs ${
                      isDark ? 'text-gray-500' : 'text-gray-400'
                    }`}
                  >
                    Use mouse or touch to sign, or upload a signature image below.
                  </p>

                  <div className="mt-3">
                    <label
                      className={`mb-1 block text-sm font-medium ${
                        isDark ? 'text-gray-300' : 'text-gray-700'
                      }`}
                    >
                      Upload Signature Image
                    </label>

                    <input
                      ref={fileSignatureRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        const reader = new FileReader();
                        reader.onload = () =>
                          setUploadedSignature(String(reader.result || ''));
                        reader.readAsDataURL(file);
                      }}
                      className={inputClass}
                    />

                    {uploadedSignature && (
                      <div className="mt-2 rounded-lg border border-gray-300 bg-white p-2">
                        <img
                          src={uploadedSignature}
                          alt="Uploaded signature"
                          className="max-h-[100px] object-contain"
                        />
                      </div>
                    )}
                  </div>
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
                  I accept and consent to electronically sign this NDA.
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
                disabled={submitting || employeeFields.length === 0}
                onClick={handleSubmit}
                className="w-full rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit NDA to Shree'}
              </button>

              <p
                className={`text-center text-xs ${
                  isDark ? 'text-gray-500' : 'text-gray-400'
                }`}
              >
                Dashboard access opens after employee submission. Shree completes the company signature next.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}