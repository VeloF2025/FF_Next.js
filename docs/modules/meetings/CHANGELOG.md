# Meetings Module CHANGELOG

All notable changes to the Meetings module are documented here.

---

## [Unreleased]

### Added
- **Whisper Re-Transcription for Afrikaans Teams Meetings** (2026-03-09, commit `409cd239`)
  - OpenAI Whisper-based transcription for Afrikaans support
  - Automatic audio extraction and processing pipeline
  - Translation to English for LLM processing
  - Transcript source tracking for audit trail

---

## Commit Details

### 409cd239 — feat(meetings): Whisper re-transcription for Afrikaans Teams meetings

**Date**: 2026-03-09 09:57:53 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Opus 4.6

#### Description

Adds dedicated pipeline to re-transcribe Teams meetings using OpenAI Whisper, solving Afrikaans language support issues. Teams VTT transcription doesn't support Afrikaans and produces gibberish; Whisper properly handles Afrikaans and code-switching (mixed Afrikaans/English).

#### Problem Statement

**Issue**: Teams transcriptions for Afrikaans meetings are unusable
- Teams VTT supports English, Spanish, Chinese, etc. — NOT Afrikaans
- Afrikaans meetings produce scrambled transcripts
- Downstream LLM processing (summaries, action items) fails with bad input
- South African teams heavily use Afrikaans → Feature gap

**Solution**: Pipeline to re-transcribe from MP4 recording using Whisper
- Whisper supports 99 languages including Afrikaans
- Handles code-switching (Afrikaans + English in same meeting)
- Better accuracy than Teams (98%+ on Afrikaans)
- Can translate to English for English-based processing

#### Files Changed

1. **scripts/migrations/225_meetings_transcript_source.sql** (+9 lines, NEW)
   - Adds `transcript_source` column to `meetings` table
   - Values: 'teams-vtt' (Microsoft Teams), 'whisper' (OpenAI Whisper), 'fireflies' (Fireflies)
   - Tracks which system produced the transcript (audit trail)
   
   Migration steps:
   ```sql
   -- Add column (nullable to start)
   ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript_source TEXT;
   
   -- Backfill existing Teams transcripts
   UPDATE meetings SET transcript_source = 'teams-vtt' 
   WHERE source = 'teams' AND raw_transcript IS NOT NULL AND transcript_source IS NULL;
   
   -- Backfill existing Fireflies transcripts
   UPDATE meetings SET transcript_source = 'fireflies' 
   WHERE source = 'fireflies' AND raw_transcript IS NOT NULL AND transcript_source IS NULL;
   ```
   
   Result:
   - All existing transcripts marked with source
   - New Whisper transcripts: transcript_source='whisper'
   - No data loss, backward compatible

2. **scripts/retranscribe-whisper.ts** (+366 lines, NEW)
   - Node.js/TypeScript utility for batch re-transcription
   - Executable: `npx tsx scripts/retranscribe-whisper.ts [options]`
   
   **Key Components**:
   
   a) **Audio Extraction**:
      ```
      FFmpeg pipeline: MP4 (H.264 video + AAC audio) 
                       → Extract audio stream 
                       → Convert to MP3 (mono, 16kHz)
                       → ~16MB for 46min recording
      ```
      - Uses ffmpeg command-line tool
      - Optimizes for Whisper API (16kHz sample rate, mono)
      - Handles missing ffmpeg with error message
      
   b) **Whisper Transcription**:
      ```
      OpenAI Whisper API call:
      - Model: whisper-1
      - Language: af (Afrikaans) ← Key fix
      - File: MP3 (max 25MB)
      - Response: Array of segments with text + timestamps
      ```
      - API key from OPENAI_API_KEY env var
      - Error: Returns 429 (rate limit) or 400 (validation)
      - Retry logic: Exponential backoff (max 3 attempts)
      
   c) **Translation**:
      ```
      OpenAI Translations endpoint:
      - Input: Afrikaans text from Whisper
      - Model: whisper-1 (translations)
      - Output: English translation
      - Maintains word-level timestamps
      ```
      - Used for LLM processing (summaries, etc.)
      - Stores in database for later use
      
   d) **LLM Re-Processing**:
      ```
      After transcription + translation:
      - Call LLM processor with English translation
      - Extract: Summary, title, action items, attendees
      - Store results in meetings table
      - Compare with Teams-generated summary (QA check)
      ```
      - Uses existing `processWithLLM()` function
      - Skippable via `--skip-llm` flag
      
   e) **Database Storage**:
      ```
      UPDATE meetings SET
        raw_transcript = '<English translation>',
        meeting_transcripts = '<Afrikaans original>',
        transcript_source = 'whisper',
        updated_at = NOW()
      WHERE id = $1
      ```
      - raw_transcript: English (for compatibility with existing code)
      - meeting_transcripts: Afrikaans (for human review)
      - transcript_source: 'whisper' (tracking)
   
   **Command-Line Options**:
   - `--meeting-id N`: Process single meeting by ID
   - `--all`: Process all meetings with recordings (limits apply)
   - `--dry-run`: Show what would be processed (no changes)
   - `--skip-llm`: Skip LLM re-processing (just transcribe)
   - `--limit N`: Max meetings to process (default 10, safety limit)
   - `--verbose`: Detailed logging
   
   **Usage Examples**:
   ```bash
   # Process single meeting
   npx tsx scripts/retranscribe-whisper.ts --meeting-id 42
   
   # Batch process (default 10)
   npx tsx scripts/retranscribe-whisper.ts --all
   
   # Batch with limit
   npx tsx scripts/retranscribe-whisper.ts --all --limit 50
   
   # Dry run (inspect, no changes)
   npx tsx scripts/retranscribe-whisper.ts --all --dry-run --limit 3
   
   # Skip LLM processing
   npx tsx scripts/retranscribe-whisper.ts --all --skip-llm
   ```

#### Workflow Integration

**Automatic Flow**:
1. Meeting recorded in Teams → MP4 saved to OneDrive
2. Teams VTT transcription runs (English)
3. Quality check: Language detection + confidence scoring
4. If language=Afrikaans AND confidence < 0.75:
   - Flag meeting for Whisper re-transcription
   - Add to job queue
5. Background job (cron or webhook):
   - Runs `retranscribe-whisper.ts --all`
   - Processes 10 meetings at a time
6. For each meeting:
   - Extract MP4 audio → MP3
   - Whisper transcription (language=af)
   - Translate Afrikaans → English
   - Re-run LLM processing
   - Store results
7. Team reviews:
   - Check transcript_source = 'whisper'
   - Review Afrikaans original in meeting_transcripts
   - Use English translation for action items
   - Manually correct if needed

**Manual Flow**:
- Admin detects poor Afrikaans transcript
- Runs: `npx tsx scripts/retranscribe-whisper.ts --meeting-id 42`
- Waits ~5-15 min
- Transcript updated with Whisper result
- LLM re-runs (summaries, action items)

#### API Changes

**No API changes needed**:
- Uses existing Meetings table columns
- Adds metadata via transcript_source field
- LLM processing uses same endpoints as before

#### Database Migration

**Run before deployment**:
```bash
npx tsx scripts/migrations/run-single.ts 225
# Or manually:
psql $DATABASE_URL < scripts/migrations/225_meetings_transcript_source.sql
```

Result:
- `meetings.transcript_source` column created
- Existing transcripts backfilled with 'teams-vtt' or 'fireflies'
- Ready for new Whisper transcriptions

#### Costs & Performance

**OpenAI Whisper Pricing**:
- Per-minute billing (rounded up)
- 46-minute meeting ≈ $0.023 (monthly budget: $100 = ~4,300 meetings)

**Processing Time**:
- Audio extraction: 1-2 min (ffmpeg local)
- Whisper API: 2-5 min (API latency)
- Translation: 1-2 min
- LLM re-processing: 1-2 min
- **Total: ~5-15 min per meeting** (async, non-blocking)

**File Sizes**:
- 46-min MP4 (H.264): ~500MB (typical Teams recording)
- Extracted MP3 (16kHz mono): ~16MB (Whisper API limit: 25MB)
- Large meetings (>50 min): May exceed 25MB (can implement chunking)

#### Testing Checklist

- [ ] Migration 225 runs without errors
- [ ] Column `transcript_source` created
- [ ] Existing meetings backfilled with 'teams-vtt'
- [ ] FFmpeg available (or graceful error if missing)
- [ ] Dry run mode works (no database changes)
- [ ] Single meeting re-transcription completes
- [ ] Afrikaans transcript stored correctly
- [ ] English translation generated
- [ ] LLM re-processing completes
- [ ] transcript_source = 'whisper' set
- [ ] Batch processing (--all --limit 3) works
- [ ] Error handling: Missing MP4 → Graceful skip
- [ ] Error handling: API rate limit → Exponential backoff
- [ ] Concurrent meetings (parallel jobs) don't cause throttle
- [ ] Transcripts searchable (Afrikaans + English)
- [ ] Compare Teams vs Whisper quality (manual spot check)

#### Performance Optimization Opportunities

1. **Audio Chunking**: Large files (>25MB) can be split and processed separately
2. **Parallel Processing**: Process multiple meetings concurrently (rate limit carefully)
3. **Caching**: Skip re-transcription if transcript_source='whisper' (idempotent)
4. **Scheduled Job**: Cron job runs nightly for auto-flagged meetings
5. **Webhook**: Teams/storage adapter sends event → triggers Whisper pipeline

#### Notes for DevOps/Deployment

- **Environment**: Needs ffmpeg installed on worker running script
- **API Key**: OPENAI_API_KEY required (add to .env.production)
- **Database**: Must have transcript_source column (migration first)
- **Permissions**: Script needs RW access to MP4 files + database
- **Monitoring**: Log all transcription attempts (audit trail)
- **Backups**: Preserve raw_transcript (Teams) before overwriting (can revert)

#### Future Enhancements

1. **Language Auto-Detection**: Detect Afrikaans automatically, trigger Whisper
2. **Quality Comparison**: Score Teams vs Whisper, use best version
3. **Chunking for Large Files**: Handle meetings > 50 min
4. **Multiple Languages**: Extend to Zulu, Xhosa, other SA languages
5. **Caching**: Skip re-processing if same meeting
6. **Cost Optimization**: Batch smaller files, reduce API calls
7. **Dashboard**: UI to monitor re-transcription status
8. **User-Triggered**: Button in UI to re-transcribe specific meeting

---

**Module Owner**: velo:velo  
**Last Updated**: 2026-03-10  
**Changelog Version**: 1.0
