import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_DOCUMENT_BUCKET || 'documents';

if (!supabaseUrl || !serviceRoleKey) {
  console.warn('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const supabaseAdmin = supabaseUrl && serviceRoleKey 
  ? createClient(supabaseUrl, serviceRoleKey) 
  : null;

/**
 * Clean path for Supabase storage (no leading slash, no full URL)
 */
function cleanPath(path) {
  if (!path) return '';
  let cleaned = String(path);
  // If it's a full URL, try to extract the relative path (last part after bucket)
  if (cleaned.startsWith('http')) {
    const parts = cleaned.split(`/${bucket}/`);
    if (parts.length > 1) cleaned = parts[1];
    else {
      // Fallback: just take the part after the last slash if it looks like a Supabase URL
      const urlParts = cleaned.split('/');
      cleaned = urlParts[urlParts.length - 1];
    }
  }
  // Remove leading slash
  return cleaned.replace(/^\/+/, '');
}

export async function uploadFile(path, buffer, contentType = 'application/pdf') {
  if (!supabaseAdmin) throw new Error('Supabase Storage is not configured on this server (Missing SUPABASE_URL)');
  
  const safePath = cleanPath(path);
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(safePath, buffer, {
      contentType,
      upsert: true,
    });

  if (error) throw error;

  return safePath;
}

export async function uploadPdf(path, buffer, contentType = 'application/pdf') {
  return uploadFile(path, buffer, contentType);
}

export async function createSignedUrl(path, expiresIn = 60 * 10) {
  if (!supabaseAdmin) throw new Error('Supabase Storage is not configured.');
  const safePath = cleanPath(path);
  if (!safePath) throw new Error('Invalid path for signed URL');

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(safePath, expiresIn);

  if (error) throw error;

  return data.signedUrl;
}

export async function downloadFile(path) {
  if (!supabaseAdmin) throw new Error('Supabase Storage is not configured.');
  const safePath = cleanPath(path);
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .download(safePath);

  if (error) throw error;

  return Buffer.from(await data.arrayBuffer());
}