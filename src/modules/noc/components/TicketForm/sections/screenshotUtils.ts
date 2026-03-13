/**
 * Screenshot/media utility functions for DevOps ticket creation
 */

export type MediaType = 'image' | 'video' | 'audio';

export interface MediaPreview {
  dataUrl: string;
  name: string;
  type: MediaType;
}

const MAX_DIMENSION = 1280;

export const ACCEPTED_TYPES = 'image/*,video/*,audio/*,.mp4,.webm,.mov,.mp3,.wav,.ogg,.m4a';

export const ANALYSING_MESSAGES: Record<MediaType, { title: string; subtitle: string }> = {
  image: {
    title: 'Analysing screenshot with AI...',
    subtitle: 'Extracting error details, module, and environment',
  },
  video: {
    title: 'Processing screen recording...',
    subtitle: 'Extracting frames + transcribing audio — this may take 30-60 seconds',
  },
  audio: {
    title: 'Transcribing voice memo...',
    subtitle: 'Converting speech to text and extracting issue details',
  },
};

export function getMediaType(file: File): MediaType {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma'].includes(ext)) return 'audio';
  return 'image';
}

export function getMaxSize(type: MediaType): number {
  return type === 'image' ? 10 : 50; // MB
}

/** Resize image client-side using canvas to stay within VLM limits */
export function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas not supported'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/** Create a video thumbnail from the first frame */
export function createVideoThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadeddata = () => {
      video.currentTime = 0.5;
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(video.videoWidth, 320);
      canvas.height = Math.min(video.videoHeight, 240);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } else {
        resolve('');
      }
      URL.revokeObjectURL(video.src);
    };
    video.onerror = () => resolve('');
    video.src = URL.createObjectURL(file);
  });
}

export function extractApiFields(data: Record<string, string>): Record<string, string> {
  const fields: Record<string, string> = {};
  if (data.title) fields.title = data.title;
  if (data.description) fields.description = data.description;
  if (data.affected_module) fields.affected_module = data.affected_module;
  if (data.environment) fields.environment = data.environment;
  if (data.error_url) fields.error_url = data.error_url;
  if (data.stack_trace) fields.stack_trace = data.stack_trace;
  if (data.steps_to_reproduce) fields.steps_to_reproduce = data.steps_to_reproduce;
  if (data.browser_info) fields.browser_info = data.browser_info;
  if (data.priority_suggestion) fields.priority_suggestion = data.priority_suggestion;
  return fields;
}
