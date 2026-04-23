// Supabase Storage helper for file attachments.
// Derives the Supabase URL from DATABASE_URL when SUPABASE_URL is not set.
// Requires SUPABASE_SERVICE_ROLE_KEY to be configured for server-side uploads.

import { createClient } from '@supabase/supabase-js';

const BUCKET = process.env.SUPABASE_BUCKET || 'idea-attachments';
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

let cachedClient = null;
let cachedError = null;

function deriveSupabaseUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL.replace(/\/$/, '');
  const dbUrl = process.env.DATABASE_URL || '';
  // Example host: aws-0-us-west-2.pooler.supabase.com → project ref is encoded in the username: postgres.<ref>
  const m = dbUrl.match(/postgres\.([a-z0-9]+):/i);
  if (m) return `https://${m[1]}.supabase.co`;
  return '';
}

export function getStorage() {
  if (cachedClient) return cachedClient;
  if (cachedError) throw cachedError;
  const url = deriveSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    cachedError = new Error(
      'Supabase Storage not configured. Set SUPABASE_SERVICE_ROLE_KEY (and optionally SUPABASE_URL) in backend/.env.'
    );
    throw cachedError;
  }
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

let _bucketReady = false;
export async function ensureBucket() {
  if (_bucketReady) return;
  const supabase = getStorage();
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  const exists = buckets?.some((b) => b.name === BUCKET);
  if (!exists) {
    const { error: createErr } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (createErr && !/already exists/i.test(createErr.message || '')) throw createErr;
  }
  _bucketReady = true;
}

export async function uploadAttachment({ pathKey, buffer, contentType }) {
  const supabase = getStorage();
  await ensureBucket();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(pathKey, buffer, { contentType: contentType || 'application/octet-stream', upsert: false });
  if (error) throw error;
  return { bucket: BUCKET, path: pathKey };
}

export async function getSignedUrl(pathKey) {
  const supabase = getStorage();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pathKey, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeAttachment(pathKey) {
  const supabase = getStorage();
  const { error } = await supabase.storage.from(BUCKET).remove([pathKey]);
  if (error) throw error;
}

export function storageConfigured() {
  try {
    getStorage();
    return true;
  } catch {
    return false;
  }
}
