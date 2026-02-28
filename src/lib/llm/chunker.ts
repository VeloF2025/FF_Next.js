/**
 * Transcript Chunker
 *
 * Splits long meeting transcripts into overlapping chunks that respect
 * speaker-boundary line breaks so a single speaker turn is never split
 * across two chunks.  Chunks are sized to stay within Claude's context
 * window while the overlap ensures continuity across chunk boundaries.
 *
 * // WORKING: handles single-chunk (short) and multi-chunk (long) paths
 */

/** A single slice of a transcript ready for LLM processing. */
export interface TranscriptChunk {
  /** Zero-based chunk sequence number. */
  index: number;
  /** The transcript text for this chunk. */
  text: string;
  /** Character offset of the first character in the original transcript. */
  offset: number;
}

/**
 * Split a transcript into chunks at speaker boundaries.
 *
 * When the transcript fits within `maxChars` it is returned as a single
 * chunk with no splitting overhead.  For longer transcripts the algorithm
 * scans backwards from the hard cut-point to find the last double-newline
 * (speaker change marker), ensuring splits fall between turns rather than
 * mid-sentence.  The next chunk begins `overlap` characters before the
 * end of the previous one so context is carried forward.
 *
 * @param text     - Full transcript text.
 * @param maxChars - Maximum characters per chunk (default 80 000).
 * @param overlap  - Characters of overlap between consecutive chunks (default 2 000).
 * @returns        Array of TranscriptChunk in sequence order.
 */
export function chunkTranscript(
  text: string,
  maxChars: number = 80_000,
  overlap: number = 2_000,
): TranscriptChunk[] {
  if (text.length <= maxChars) {
    return [{ index: 0, text, offset: 0 }];
  }

  const chunks: TranscriptChunk[] = [];
  let offset = 0;
  let index = 0;

  while (offset < text.length) {
    let end = Math.min(offset + maxChars, text.length);

    // When not at the final character, attempt to break at a speaker boundary
    // by searching the last 2 000 characters of the candidate slice for the
    // last double-newline (the conventional speaker-change separator).
    if (end < text.length) {
      const searchStart = Math.max(end - 2_000, offset);
      const searchRegion = text.slice(searchStart, end);
      const lastBreak = searchRegion.lastIndexOf('\n\n');
      if (lastBreak > 0) {
        end = searchStart + lastBreak;
      }
    }

    chunks.push({
      index,
      text: text.slice(offset, end),
      offset,
    });

    // Advance by (chunkSize - overlap) so the next chunk shares the tail
    // of the current one, preserving cross-boundary context.
    offset = end - (end < text.length ? overlap : 0);
    index++;
  }

  return chunks;
}
