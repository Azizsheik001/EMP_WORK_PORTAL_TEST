import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_DOCUMENT_BUCKET || 'documents';

if (!supabaseUrl || !serviceRoleKey) {
  console.warn('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

export async function uploadFile(path, buffer, contentType = 'application/pdf') {
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType,
      upsert: true,
    });

  if (error) throw error;

  return path;
}

export async function uploadPdf(path, buffer, contentType = 'application/pdf') {
  return uploadFile(path, buffer, contentType);
}

export async function createSignedUrl(path, expiresIn = 60 * 10) {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error) throw error;

  return data.signedUrl;
}

export async function downloadFile(path) {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .download(path);

  if (error) throw error;

  return Buffer.from(await data.arrayBuffer());
}