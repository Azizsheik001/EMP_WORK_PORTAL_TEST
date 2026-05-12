import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

function safeText(value) {
  return String(value ?? '').trim();
}

function formatDateTime(value) {
  if (!value) return '';

  try {
    return new Date(value).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      timeZoneName: 'short',
    });
  } catch {
    return String(value);
  }
}

function dataUrlToBuffer(dataUrl) {
  if (!dataUrl) return null;

  if (Buffer.isBuffer(dataUrl)) return dataUrl;

  const raw = String(dataUrl);

  if (!raw.startsWith('data:')) {
    return Buffer.from(raw, 'base64');
  }

  const base64 = raw.split(',')[1];
  if (!base64) return null;

  return Buffer.from(base64, 'base64');
}

async function embedSignatureImage(pdfDoc, signatureData) {
  const buffer = dataUrlToBuffer(signatureData);
  if (!buffer) return null;

  const raw = String(signatureData || '').toLowerCase();

  if (raw.includes('image/jpeg') || raw.includes('image/jpg')) {
    return pdfDoc.embedJpg(buffer);
  }

  return pdfDoc.embedPng(buffer);
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

  const x = rawX * scaleX;
  const width = rawWidth * scaleX;
  const height = rawHeight * scaleY;

  // Browser y starts from top. PDF y starts from bottom.
  const y = pageHeight - (rawY + rawHeight) * scaleY;

  return {
    x,
    y,
    width,
    height,
  };
}

function drawFieldBorder(page, rect) {
  page.drawRectangle({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    borderColor: rgb(0.85, 0.85, 0.85),
    borderWidth: 0.3,
  });
}

function getFontSize(fieldType, height) {
  if (fieldType === 'initials') return Math.min(10, Math.max(7, height * 0.45));
  if (fieldType === 'date') return Math.min(9, Math.max(7, height * 0.42));
  return Math.min(10, Math.max(7, height * 0.42));
}

export async function fillNdaPdf({
  pdfBuffer,
  fields = [],
  values = {},
  signatureData,
  signerRole = 'employee',
  drawBorders = false,
}) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let signatureImage = null;

  if (signatureData) {
    signatureImage = await embedSignatureImage(pdfDoc, signatureData);
  }

  const pages = pdfDoc.getPages();

  for (const field of fields) {
    if (field.signer_role !== signerRole) continue;

    const pageIndex = Number(field.page_number || 1) - 1;
    const page = pages[pageIndex];

    if (!page) continue;

    const rect = getPdfFieldRect(page, field);

    if (drawBorders) {
      drawFieldBorder(page, rect);
    }

    if (field.field_type === 'signature') {
      if (signatureImage) {
        page.drawImage(signatureImage, {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
      }

      continue;
    }

    const value = safeText(values[field.field_key]);

    if (!value) continue;

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

  return Buffer.from(await pdfDoc.save());
}

export async function createAuditPagePdf({
  documentName = 'Employee NDA',
  requestId,
  employee = {},
  shree = {},
  completedAt = new Date().toISOString(),
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 740;

  const draw = (text, x = 50, size = 10, useBold = false) => {
    page.drawText(String(text || ''), {
      x,
      y,
      size,
      font: useBold ? bold : font,
      color: rgb(0, 0, 0),
    });

    y -= size + 10;
  };

  const drawSectionGap = () => {
    y -= 10;
  };

  draw('E-Sign Audit Certificate', 50, 18, true);
  drawSectionGap();

  draw(`Document: ${documentName}`);
  draw(`NDA Request ID: ${requestId}`);
  draw('Number of Recipients: 2');
  draw(`Completed At: ${formatDateTime(completedAt) || completedAt}`);

  drawSectionGap();
  draw('Recipient 1 - Employee', 50, 13, true);
  draw(`Name: ${employee.name || ''}`);
  draw(`Email: ${employee.email || ''}`);
  draw('Role: Employee');
  draw(`Sent At: ${formatDateTime(employee.sentAt) || employee.sentAt || ''}`);
  draw(`Signed At: ${formatDateTime(employee.signedAt) || employee.signedAt || ''}`);
  draw(`IP Address: ${employee.ipAddress || ''}`);
  draw(`Device: ${employee.device || ''}`);
  draw(`Consent: ${employee.consentAccepted ? 'Accepted' : ''}`);

  drawSectionGap();
  draw('Recipient 2 - Shree / CEO', 50, 13, true);
  draw(`Name: ${shree.name || 'Shree Yerramsetti'}`);
  draw(`Email: ${shree.email || 'shreey@amgsol.com'}`);
  draw('Role: CEO / Admin');
  draw(`Sent At: ${formatDateTime(shree.sentAt) || shree.sentAt || ''}`);
  draw(`Signed At: ${formatDateTime(shree.signedAt) || shree.signedAt || ''}`);
  draw(`IP Address: ${shree.ipAddress || ''}`);
  draw(`Device: ${shree.device || ''}`);
  draw(`Consent: ${shree.consentAccepted ? 'Accepted' : ''}`);

  drawSectionGap();
  draw('Document completed and stored securely by AGS Workforce Portal.', 50, 9);

  return Buffer.from(await pdfDoc.save());
}

export async function appendAuditPageToPdf(originalPdfBuffer, auditPdfBuffer) {
  const mainPdf = await PDFDocument.load(originalPdfBuffer);
  const auditPdf = await PDFDocument.load(auditPdfBuffer);

  const auditPages = await mainPdf.copyPages(
    auditPdf,
    auditPdf.getPageIndices()
  );

  auditPages.forEach((page) => mainPdf.addPage(page));

  return Buffer.from(await mainPdf.save());
}