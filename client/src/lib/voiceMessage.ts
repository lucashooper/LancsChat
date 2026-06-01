import { supabase } from './supabase';

const VOICE_BUCKET = 'voice-messages';
const MAX_VOICE_BYTES = 5 * 1024 * 1024;

export const MAX_VOICE_DURATION_SECONDS = 60;

export async function uploadVoiceMessage(userId: string, blob: Blob): Promise<string> {
  if (blob.size > MAX_VOICE_BYTES) {
    throw new Error('Voice message is too large (max 5MB)');
  }

  const ext = blob.type.includes('mp4') || blob.type.includes('aac') ? 'm4a' : 'webm';
  const filePath = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(VOICE_BUCKET).upload(filePath, blob, {
    contentType: blob.type || 'audio/webm',
    upsert: false,
  });

  if (error) {
    throw new Error(
      error.message.includes('Bucket not found')
        ? "Voice messages aren't set up yet — create a public Supabase Storage bucket named 'voice-messages'"
        : error.message
    );
  }

  const { data } = supabase.storage.from(VOICE_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}
