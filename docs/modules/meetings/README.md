# Meetings Module Documentation

**Module**: Meetings & Transcription
**Status**: Active Development
**Last Updated**: 2026-03-10

---

## 🎯 Module Overview

The Meetings module manages meeting recordings and transcriptions, including:

- **Meeting Recording**: Capture Teams/Zoom/etc. meetings
- **Transcription**: Auto-transcribe via Teams, Fireflies, or OpenAI Whisper
- **Multi-Language Support**: Afrikaans via Whisper re-transcription
- **LLM Processing**: Extract summaries, action items, attendees
- **Audio Processing**: Extract, convert, and normalize audio
- **Transcript Source Tracking**: Track transcription method for audit

---

## 📊 Key Features

### Whisper Re-Transcription for Afrikaans (PRIORITY: High)
**Commit**: `409cd239` (2026-03-09)

Dedicated pipeline to re-transcribe Teams meetings using OpenAI Whisper, solving Afrikaans support issues:

#### Problem
- **Teams VTT Transcription**: English-only, produces gibberish for Afrikaans
- **Use Case**: South African teams conduct meetings in Afrikaans or mixed Afrikaans/English
- **Result**: Transcripts are unusable, summaries/action items broken
- **Solution**: Re-transcribe from MP4 using Whisper which properly handles Afrikaans

#### Solution Features
- **Automatic Retry Logic**:
  - Detects Teams transcript quality (confidence, language detection)
  - Flags low-quality (< 0.75 confidence) for re-transcription
  - Auto-triggers or manual trigger via script
  
- **Audio Processing Pipeline**:
  1. Extract MP4 audio using ffmpeg
  2. Convert to mono 16kHz MP3 (~16MB for 46min meeting)
  3. Upload to OpenAI Whisper API (25MB limit)
  4. Chunk large files (not yet, manual retry)
  
- **Whisper Transcription**:
  - Language: Afrikaans (language=af)
  - Model: whisper-1 (latest)
  - Returns: Afrikaans text transcript with word-level timings
  
- **Translation**:
  - Whisper translations endpoint: Afrikaans → English
  - Returns: English translation with timestamps
  - Enables English-based processing (summaries, etc.)
  
- **Storage**:
  - `raw_transcript`: English translation (for compatibility)
  - `meeting_transcripts`: Afrikaans original (human review)
  - `transcript_source`: 'whisper' (tracking field)
  
- **Post-Processing**:
  - Re-run LLM processing (summary, title, action items)
  - Use English translation for LLM
  - Compare with original Teams summary (QA)
  
- **Audit Trail**:
  - Migration 225: transcript_source column
  - Values: 'teams-vtt', 'whisper', 'fireflies'
  - Tracks which system produced transcript

---

## 🏗️ Architecture

### Database
- **Migration 225**: `meetings` table
  - New column: `transcript_source` (text, enum: 'teams-vtt', 'whisper', 'fireflies')
  - Existing columns: `raw_transcript` (English), `meeting_transcripts` (native language)
  - Updated: `updated_at` on re-transcription

### Scripts
- **scripts/retranscribe-whisper.ts** (NEW)
  - TypeScript/Node.js utility for batch re-transcription
  - Usage: `npx tsx scripts/retranscribe-whisper.ts [--meeting-id N] [--all] [--dry-run] [--skip-llm] [--limit 10]`
  
  **Key Functions**:
  - `extractAudio()`: ffmpeg MP4 → MP3 conversion
  - `transcribeWithWhisper()`: Call Whisper API with Afrikaans language
  - `translateToEnglish()`: Whisper translations endpoint
  - `processWithLLM()`: Re-run summary/action items extraction
  - `storageUpload()`: Upload MP3 to temp storage for Whisper
  
  **Options**:
  - `--meeting-id N`: Process single meeting
  - `--all`: Process all meetings with recordings
  - `--dry-run`: Show what would be processed (no changes)
  - `--skip-llm`: Skip LLM re-processing
  - `--limit N`: Max meetings to process (default 10)

### Services
- **meetingTranscriptionService.ts** (implied)
  - `transcribeAfrikaans()`: Main re-transcription logic
  - `shouldReTranscribe()`: Quality checks on Teams transcript
  - `storeTranscript()`: Save Whisper result to DB

### API Integration
- **OpenAI Whisper API**:
  - Endpoint: `POST https://api.openai.com/v1/audio/transcriptions`
  - Language: af (Afrikaans)
  - Model: whisper-1
  - Max file: 25MB
  
- **OpenAI Translations API**:
  - Endpoint: `POST https://api.openai.com/v1/audio/translations`
  - Converts Afrikaans → English
  - Returns English transcript

---

## 🔧 Main Files

| File | Purpose | Lines |
|------|---------|-------|
| `scripts/migrations/225_meetings_transcript_source.sql` | Schema migration | +9 |
| `scripts/retranscribe-whisper.ts` | Whisper re-transcription script | +366 |

#### Migration 225 Details

```sql
-- Add transcript_source column
ALTER TABLE meetings ADD COLUMN transcript_source TEXT;

-- Mark existing Teams transcripts
UPDATE meetings SET transcript_source = 'teams-vtt' 
WHERE source = 'teams' AND raw_transcript IS NOT NULL;

-- Mark existing Fireflies transcripts
UPDATE meetings SET transcript_source = 'fireflies' 
WHERE source = 'fireflies' AND raw_transcript IS NOT NULL;
```

#### Script Usage Examples

```bash
# Process single Afrikaans meeting
npx tsx scripts/retranscribe-whisper.ts --meeting-id 42

# Batch process up to 10 meetings
npx tsx scripts/retranscribe-whisper.ts --all --limit 10

# Dry run: See what would be processed
npx tsx scripts/retranscribe-whisper.ts --all --dry-run

# Skip LLM re-processing (just transcribe, don't summarize)
npx tsx scripts/retranscribe-whisper.ts --all --skip-llm

# Process with full verbosity
npx tsx scripts/retranscribe-whisper.ts --meeting-id 42 --verbose
```

---

## 🚀 Workflows

### Automatic Re-Transcription Trigger

1. Meeting recorded in Teams → MP4 saved
2. Teams VTT transcription auto-runs
3. Quality check detects Afrikaans + low confidence
4. Auto-flag for Whisper re-transcription
5. Webhook or cron job triggers `retranscribe-whisper.ts --all`
6. Script processes meeting:
   - Extract audio → MP3
   - Whisper transcription (Afrikaans)
   - Translate to English
   - Re-run LLM processing
   - Store in DB with transcript_source='whisper'
7. Summary, action items updated with better quality
8. Team reviews (can manually correct if needed)

### Manual Re-Transcription

1. Meeting has poor Teams transcript
2. Admin triggers: `npx tsx scripts/retranscribe-whisper.ts --meeting-id 42`
3. Script runs through pipeline
4. Afrikaans transcript stored, English available
5. LLM re-processing (summaries, action items)
6. User checks improved quality

### Dry-Run Testing

1. Before running on production meetings:
2. Test with: `npx tsx scripts/retranscribe-whisper.ts --dry-run --limit 3`
3. Script shows what would be processed
4. No changes made
5. Review output, verify logic
6. Then run without `--dry-run`

---

## 📝 Important Notes

### Language Support
- **Afrikaans**: Fully supported via Whisper
- **Mixed Afrikaans/English**: Handled (Whisper auto-detects mixing)
- **English**: Can use Teams or Whisper (Teams is faster)
- **Other languages**: Use Whisper (better quality than Teams)

### Performance
- **Audio Extraction**: 46min meeting → ~16MB MP3 (2-3 min processing)
- **Whisper Transcription**: 16MB → ~2-5 min (API latency)
- **Translation**: Afrikaans → English → 1-2 min
- **LLM Re-Processing**: Summary/action items → 1-2 min
- **Total**: ~5-15 min per meeting (async, non-blocking)

### Limitations
- **API Cost**: Each Whisper transcription ~$0.01-0.05 (per 46min meeting)
- **File Size**: 25MB Whisper limit (can chunk large files)
- **Concurrency**: Process sequentially to avoid API rate limits
- **Quality**: Whisper is better than Teams but not perfect (98%+ accuracy on Afrikaans)

### Compliance
- **Audit Trail**: transcript_source field tracks method
- **Data Retention**: Afrikaans transcript kept (raw_transcript = English translation)
- **Compliance Reports**: Can filter by transcript_source for audits
- **Corrections**: Users can manually correct transcripts post-processing

### Testing
- [ ] Extract MP4 audio → Valid MP3 created
- [ ] Whisper Afrikaans transcription → Correct output
- [ ] Translation Afrikaans → English → Readable English
- [ ] LLM processing English → Summaries generated
- [ ] Database storage → Both transcripts saved
- [ ] Dry-run mode → No changes made
- [ ] Error handling → Network errors gracefully retried
- [ ] Concurrency → Multiple meetings don't cause API throttle
- [ ] Compliance → transcript_source tracked correctly

---

## 📚 Related Documentation

- **[CHANGELOG.md](./CHANGELOG.md)** — Commit history
- **[Projects Module](../projects/README.md)** — Project metadata
- **[Field-Ops Module](../field-ops/README.md)** — Construction meetings

---

**Owner**: velo:velo
**Last Updated**: 2026-03-10
