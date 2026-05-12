import express from 'express';
import multer from 'multer';
import {
  supabaseAdmin,
  createSignedUrl,
  uploadFile,
  downloadFile,
} from '../services/ndaStorageService.js';
import {
  fillNdaPdf,
  createAuditPagePdf,
  appendAuditPageToPdf,
} from '../services/ndaPdfService.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

function getUserEmail(req) {
  return (
    req.user?.email ||
    req.headers['x-user-email'] ||
    req.body?.email ||
    req.query?.email ||
    ''
  );
}

function requiredNumber(value, name) {
  const num = Number(value);

  if (value === null || value === undefined || value === '' || Number.isNaN(num)) {
    throw new Error(`${name} is required and must be a number`);
  }

  return num;
}

async function getTemplateFields(templateId) {
  const { data, error } = await supabaseAdmin
    .from('nda_template_fields')
    .select('*')
    .eq('template_id', templateId)
    .order('page_number', { ascending: true });

  if (error) throw error;
  return data || [];
}

// GET active NDA template
router.get('/templates/active', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('nda_templates')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) throw error;

    res.json({ template: data });
  } catch (e) {
    next(e);
  }
});

// GET all templates
router.get('/templates', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('nda_templates')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const templatesWithUrls = await Promise.all(
      data.map(async (t) => {
        let file_url = null;
        if (t.pdf_path && t.pdf_path !== 'pending-upload') {
          try {
            file_url = await createSignedUrl(t.pdf_path, 3600);
          } catch (err) {
            console.error(`Failed to get signed url for template ${t.id}`, err);
          }
        }
        return { ...t, file_url };
      })
    );

    res.json({ templates: templatesWithUrls });
  } catch (e) {
    next(e);
  }
});

// POST upload new NDA template PDF
router.post('/templates', upload.single('file'), async (req, res, next) => {
  try {
    const name = req.body?.name || 'Employee NDA Template';
    const category = req.body?.category || 'nda';
    const description = req.body?.description || '';
    const show_to_new_users = req.body?.show_to_new_users === 'true';

    if (!req.file) {
      return res.status(400).json({ error: 'PDF file is required' });
    }

    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ error: 'Only PDF files are allowed' });
    }

    const { data: template, error: insertError } = await supabaseAdmin
      .from('nda_templates')
      .insert({
        name,
        category,
        description,
        show_to_new_users,
        pdf_path: 'pending-upload',
        is_active: false,
        created_by: req.user?.id || null,
      })
      .select('*')
      .single();

    if (insertError) throw insertError;

    const pdfPath = `nda/templates/${template.id}/template.pdf`;

    await uploadFile(pdfPath, req.file.buffer, 'application/pdf');

    const { data: updatedTemplate, error: updateError } = await supabaseAdmin
      .from('nda_templates')
      .update({ pdf_path: pdfPath })
      .eq('id', template.id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    res.json({ template: updatedTemplate });
  } catch (e) {
    next(e);
  }
});

// PUT update template
router.put('/templates/:id', upload.single('file'), async (req, res, next) => {
  try {
    const templateId = req.params.id;
    const name = req.body?.name;
    const category = req.body?.category;
    const description = req.body?.description;
    const show_to_new_users = req.body?.show_to_new_users === 'true';

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (category !== undefined) updates.category = category;
    if (description !== undefined) updates.description = description;
    if (req.body?.show_to_new_users !== undefined) updates.show_to_new_users = show_to_new_users;

    if (req.file) {
      if (req.file.mimetype !== 'application/pdf') {
        return res.status(400).json({ error: 'Only PDF files are allowed' });
      }
      const pdfPath = `nda/templates/${templateId}/template.pdf`;
      await uploadFile(pdfPath, req.file.buffer, 'application/pdf');
      updates.pdf_path = pdfPath;
    }

    const { data: updatedTemplate, error } = await supabaseAdmin
      .from('nda_templates')
      .update(updates)
      .eq('id', templateId)
      .select('*')
      .single();

    if (error) throw error;

    res.json({ template: updatedTemplate });
  } catch (e) {
    next(e);
  }
});

// POST save template field boxes
router.post('/templates/:id/fields', async (req, res, next) => {
  try {
    const templateId = req.params.id;
    const fields = Array.isArray(req.body?.fields) ? req.body.fields : [];

    if (!templateId) {
      return res.status(400).json({ error: 'template id is required' });
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'At least one field is required' });
    }

    const rows = fields.map((field, index) => {
      try {
        return {
          template_id: templateId,
          field_key: field.field_key,
          field_label: field.field_label,
          field_type: field.field_type,
          signer_role: field.signer_role,
          page_number: requiredNumber(field.page_number, 'page_number'),
          x: requiredNumber(field.x, 'x'),
          y: requiredNumber(field.y, 'y'),
          width: requiredNumber(field.width, 'width'),
          height: requiredNumber(field.height, 'height'),

          // Required for accurate PDF placement
          viewer_width: requiredNumber(field.viewer_width, 'viewer_width'),
          viewer_height: requiredNumber(field.viewer_height, 'viewer_height'),
          pdf_width: requiredNumber(field.pdf_width, 'pdf_width'),
          pdf_height: requiredNumber(field.pdf_height, 'pdf_height'),

          required: field.required !== false,
        };
      } catch (e) {
        throw new Error(`Field ${index + 1} (${field.field_key || 'unknown'}): ${e.message}`);
      }
    });

    const { error: deleteError } = await supabaseAdmin
      .from('nda_template_fields')
      .delete()
      .eq('template_id', templateId);

    if (deleteError) throw deleteError;

    const { data, error } = await supabaseAdmin
      .from('nda_template_fields')
      .insert(rows)
      .select('*');

    if (error) throw error;

    res.json({ fields: data || [] });
  } catch (e) {
    next(e);
  }
});

// GET template fields
router.get('/templates/:id/fields', async (req, res, next) => {
  try {
    const templateId = req.params.id;
    const { data, error } = await supabaseAdmin
      .from('nda_template_fields')
      .select('*')
      .eq('template_id', templateId);

    if (error) throw error;
    res.json({ fields: data || [] });
  } catch (e) {
    next(e);
  }
});

router.patch('/templates/:id/set-active', async (req, res, next) => {
  try {
    const templateId = req.params.id;

    const { data: template, error: findError } = await supabaseAdmin
      .from('nda_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (findError) throw findError;

    const { error: clearError } = await supabaseAdmin
      .from('nda_templates')
      .update({ is_active: false })
      .neq('id', templateId);

    if (clearError) throw clearError;

    const { data, error } = await supabaseAdmin
      .from('nda_templates')
      .update({ is_active: true })
      .eq('id', template.id)
      .select('*')
      .single();

    if (error) throw error;

    res.json({ template: data });
  } catch (e) {
    next(e);
  }
});

// DELETE template
router.delete('/templates/:id', async (req, res, next) => {
  try {
    const templateId = req.params.id;

    const { error: deleteFieldsError } = await supabaseAdmin
      .from('nda_template_fields')
      .delete()
      .eq('template_id', templateId);

    if (deleteFieldsError) throw deleteFieldsError;

    const { error } = await supabaseAdmin
      .from('nda_templates')
      .delete()
      .eq('id', templateId);

    if (error) throw error;

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// Create NDA request for newly created employee
router.post('/create-for-employee', async (req, res, next) => {
  try {
    const { employee_id, employee_name, employee_email } = req.body;

    if (!employee_id || !employee_email) {
      return res.status(400).json({
        error: 'employee_id and employee_email are required',
      });
    }

    const { data: template, error: templateError } = await supabaseAdmin
      .from('nda_templates')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (templateError) throw templateError;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('nda_requests')
      .select('*')
      .eq('employee_id', employee_id)
      .in('status', ['pending_employee', 'pending_shree'])
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      return res.json({ nda: existing, already_exists: true });
    }

    const { data, error } = await supabaseAdmin
      .from('nda_requests')
      .insert({
        employee_id,
        employee_name,
        employee_email,
        status: 'pending_employee',
        template_id: template.id,
        template_path: template.pdf_path,
      })
      .select('*')
      .single();

    if (error) throw error;

    res.json({ nda: data });
  } catch (e) {
    next(e);
  }
});

// POST send document to multiple users
router.post('/send-to-users', async (req, res, next) => {
  try {
    const { template_id, user_ids, is_standard } = req.body;

    if (!template_id || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ error: 'template_id and array of user_ids are required' });
    }

    let actualTemplateId = template_id;
    let template;

    if (is_standard) {
      // It's a standard document, fetch it from 'documents' table
      const { data: stdDoc, error: stdDocError } = await supabaseAdmin
        .from('documents')
        .select('*')
        .eq('id', template_id)
        .single();
        
      if (stdDocError) throw stdDocError;

      // Check if we already created a template for this standard document
      const { data: existingTemplate } = await supabaseAdmin
        .from('nda_templates')
        .select('*')
        .eq('pdf_path', stdDoc.file_path)
        .limit(1)
        .single();

      if (existingTemplate) {
        template = existingTemplate;
        actualTemplateId = existingTemplate.id;
      } else {
        // Create a new nda_template wrapping this document
        const { data: newTemplate, error: newTempError } = await supabaseAdmin
          .from('nda_templates')
          .insert({
            name: stdDoc.title || 'Standard Document',
            category: stdDoc.category || 'general',
            description: stdDoc.description || '',
            show_to_new_users: false,
            pdf_path: stdDoc.file_path,
            is_active: true,
            created_by: req.user?.id || null,
          })
          .select('*')
          .single();

        if (newTempError) throw newTempError;
        template = newTemplate;
        actualTemplateId = newTemplate.id;
      }
    } else {
      const { data: fetchTemplate, error: templateError } = await supabaseAdmin
        .from('nda_templates')
        .select('*')
        .eq('id', template_id)
        .single();

      if (templateError) throw templateError;
      template = fetchTemplate;
    }

    // Fetch the users to get their names and emails
    const { data: users, error: usersError } = await supabaseAdmin
      .from('profiles')
      .select('id, name, email')
      .in('id', user_ids);

    if (usersError) throw usersError;

    const inserts = users.map(u => ({
      employee_id: u.id,
      employee_name: u.name,
      employee_email: u.email,
      status: 'pending_employee',
      template_id: template.id,
      template_path: template.pdf_path,
    }));

    const { data, error } = await supabaseAdmin
      .from('nda_requests')
      .insert(inserts)
      .select('*');

    if (error) throw error;

    res.json({ ndas: data });
  } catch (e) {
    next(e);
  }
});

// Employee pending NDA
router.get('/me/pending', async (req, res, next) => {
  try {
    const email = getUserEmail(req);

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('nda_requests')
      .select('*, nda_templates(*)')
      .eq('employee_email', email)
      .eq('status', 'pending_employee')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    res.json({ nda: data || null });
  } catch (e) {
    next(e);
  }
});

// Shree pending NDA list
router.get('/shree/pending', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('nda_requests')
      .select('*')
      .eq('status', 'pending_shree')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ ndas: data || [] });
  } catch (e) {
    next(e);
  }
});

// Carrie completed NDA list
router.get('/carrie/completed', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('nda_requests')
      .select('*')
      .eq('status', 'completed')
      .eq('carrie_dismissed', false)
      .order('completed_at', { ascending: false });

    if (error) throw error;

    res.json({ ndas: data || [] });
  } catch (e) {
    next(e);
  }
});

// All completed NDA list
router.get('/all-completed', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('nda_requests')
      .select('*')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false });

    if (error) throw error;

    res.json({ ndas: data || [] });
  } catch (e) {
    next(e);
  }
});

// Employee NDA history
router.get('/employee/:employeeId', async (req, res, next) => {
  try {
    const { employeeId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('nda_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ ndas: data || [] });
  } catch (e) {
    next(e);
  }
});

// GET single NDA request with template fields and preview URL
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: nda, error } = await supabaseAdmin
      .from('nda_requests')
      .select('*, nda_templates(*)')
      .eq('id', id)
      .single();

    if (error) throw error;

    const templateId = nda.template_id || nda.nda_templates?.id;
    const fields = templateId ? await getTemplateFields(templateId) : [];

    const templateUrl = nda.template_path
      ? await createSignedUrl(nda.template_path, 60 * 10)
      : '';

    const employeePdfUrl = nda.employee_pdf_path
      ? await createSignedUrl(nda.employee_pdf_path, 60 * 10)
      : '';

    const finalPdfUrl = nda.final_pdf_path
      ? await createSignedUrl(nda.final_pdf_path, 60 * 10)
      : '';

    res.json({
      nda,
      fields,
      templateUrl,
      template_url: templateUrl,
      employeePdfUrl,
      employee_pdf_url: employeePdfUrl,
      finalPdfUrl,
      final_pdf_url: finalPdfUrl,
    });
  } catch (e) {
    next(e);
  }
});

// Employee submits NDA
router.post('/:id/employee-submit', async (req, res, next) => {
  try {
    const { id } = req.params;
    const fieldValues = req.body?.field_values || {};
    const signature = req.body?.signature || '';
    const audit = req.body?.audit || {};

    const { data: nda, error } = await supabaseAdmin
      .from('nda_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    if (!nda.template_path || !nda.template_id) {
      return res.status(400).json({
        error: 'NDA template is missing for this request',
      });
    }

    const templateBuffer = await downloadFile(nda.template_path);
    const fields = await getTemplateFields(nda.template_id);

    const employeePdfBuffer = await fillNdaPdf({
      pdfBuffer: templateBuffer,
      fields,
      values: fieldValues,
      signatureData: signature,
      signerRole: 'employee',
    });

    const employeePdfPath = `nda/requests/${id}/employee-signed.pdf`;

    await uploadFile(employeePdfPath, employeePdfBuffer, 'application/pdf');

    const now = new Date().toISOString();

    const { data: updatedNda, error: updateError } = await supabaseAdmin
      .from('nda_requests')
      .update({
        status: 'pending_shree',
        employee_pdf_path: employeePdfPath,
        employee_signed_at: now,
        employee_field_values: fieldValues,
        employee_audit: audit,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    res.json({ nda: updatedNda });
  } catch (e) {
    next(e);
  }
});

// Shree submits final NDA
router.post('/:id/shree-submit', async (req, res, next) => {
  try {
    const { id } = req.params;
    const fieldValues = req.body?.field_values || {};
    const signature = req.body?.signature || '';
    const audit = req.body?.audit || {};

    const { data: nda, error } = await supabaseAdmin
      .from('nda_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    if (!nda.employee_pdf_path || !nda.template_id) {
      return res.status(400).json({
        error: 'Employee signed NDA PDF is missing',
      });
    }

    const employeePdfBuffer = await downloadFile(nda.employee_pdf_path);
    const fields = await getTemplateFields(nda.template_id);

    const shreeSignedPdfBuffer = await fillNdaPdf({
      pdfBuffer: employeePdfBuffer,
      fields,
      values: fieldValues,
      signatureData: signature,
      signerRole: 'shree',
    });

    const completedAt = new Date().toISOString();

    const auditPdfBuffer = await createAuditPagePdf({
      documentName: 'Employee NDA',
      requestId: id,
      employee: {
        name: nda.employee_audit?.signer_name || nda.employee_name,
        email: nda.employee_audit?.signer_email || nda.employee_email,
        sentAt: nda.employee_audit?.sent_at || nda.created_at,
        signedAt: nda.employee_audit?.signed_at || nda.employee_signed_at,
        ipAddress: nda.employee_audit?.ip_address || '',
        device: nda.employee_audit?.device || '',
        consentAccepted: nda.employee_audit?.consent_accepted === true,
      },
      shree: {
        name:
          audit.signer_name ||
          fieldValues.shree_name ||
          'Shree Yerramsetti',
        email:
          audit.signer_email ||
          fieldValues.shree_email ||
          'shreey@amgsol.com',
        sentAt: audit.sent_at || '',
        signedAt: audit.signed_at || completedAt,
        ipAddress: audit.ip_address || '',
        device: audit.device || '',
        consentAccepted: audit.consent_accepted === true,
      },
      completedAt,
    });

    const finalPdfBuffer = await appendAuditPageToPdf(
      shreeSignedPdfBuffer,
      auditPdfBuffer
    );

    const finalPdfPath = `nda/requests/${id}/final-signed.pdf`;

    await uploadFile(finalPdfPath, finalPdfBuffer, 'application/pdf');

    const { data: updatedNda, error: updateError } = await supabaseAdmin
      .from('nda_requests')
      .update({
        status: 'completed',
        final_pdf_path: finalPdfPath,
        shree_signed_at: completedAt,
        completed_at: completedAt,
        shree_field_values: fieldValues,
        shree_audit: audit,
        carrie_dismissed: false,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    res.json({ nda: updatedNda });
  } catch (e) {
    next(e);
  }
});

// Carrie dismiss completed NDA notification
router.patch('/:id/carrie-dismiss', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('nda_requests')
      .update({ carrie_dismissed: true })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    res.json({ nda: data });
  } catch (e) {
    next(e);
  }
});

// Download final NDA PDF
router.get('/:id/download-url', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: nda, error } = await supabaseAdmin
      .from('nda_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    if (!nda.final_pdf_path) {
      return res.status(404).json({ error: 'Final PDF not available yet' });
    }

    const url = await createSignedUrl(nda.final_pdf_path);

    res.json({ url });
  } catch (e) {
    next(e);
  }
});

export default router;