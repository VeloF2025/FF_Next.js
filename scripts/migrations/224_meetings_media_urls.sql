-- Migration 224: Add audio_url and video_url to meetings for Fireflies media
-- These store signed CDN URLs from Fireflies (audio.mp3, video.mp4)
-- Teams meetings use recording_path (local file); Fireflies uses these URLs

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS audio_url TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS video_url TEXT;
