#!/usr/bin/env node
/**
 * Ingest knowledge documents into chat_knowledge table with embeddings.
 * 
 * Usage: node scripts/ingest-knowledge.js [--force]
 *   --force: Re-ingest even if source already exists
 * 
 * Reads from docs/ and knowledge files, chunks them, embeds with OpenAI, stores in pgvector.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load env
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
const envPath2 = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath2)) {
  const envContent = fs.readFileSync(envPath2, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim();
  }
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHUNK_SIZE = 800; // tokens ~= words * 1.3, so ~600 words per chunk
const CHUNK_OVERLAP = 100;
const FORCE = process.argv.includes('--force');

if (!OPENAI_API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }
if (!DATABASE_URL) { console.error('Missing DATABASE_URL'); process.exit(1); }

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── Knowledge sources ──────────────────────────────────────────

const SOURCES = [
  {
    id: 'user-manual',
    label: 'FibreFlow User Manual',
    path: path.join(__dirname, '..', 'docs', 'user-manuals', 'source', 'fibreflow-complete.md'),
  },
];

// Also scan for any .md files in docs/ root
const docsDir = path.join(__dirname, '..', 'docs');
if (fs.existsSync(docsDir)) {
  for (const f of fs.readdirSync(docsDir)) {
    if (f.endsWith('.md') && f !== 'README.md') {
      const fullPath = path.join(docsDir, f);
      if (!SOURCES.find(s => s.path === fullPath)) {
        SOURCES.push({ id: `docs/${f}`, label: f.replace('.md', ''), path: fullPath });
      }
    }
  }
}

// Check for knowledge base in workspace
const knowledgePath = '/home/hein/.openclaw/workspace/fibreflow-knowledge.md';
if (fs.existsSync(knowledgePath)) {
  SOURCES.push({ id: 'knowledge-base', label: 'FibreFlow Knowledge Base', path: knowledgePath });
}

// ── Chunking ───────────────────────────────────────────────────

function chunkBySection(text, source) {
  const chunks = [];
  // Split by ## headings
  const sections = text.split(/(?=^## )/m);
  
  for (const section of sections) {
    const headingMatch = section.match(/^##+ (.+)/m);
    const sectionTitle = headingMatch ? headingMatch[1].trim() : 'Introduction';
    
    // Strip image markdown to save tokens
    const cleaned = section
      .replace(/!\[.*?\]\(.*?\)\n?\*.*?\*\n?/g, '')
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .trim();
    
    if (!cleaned || cleaned.length < 20) continue;
    
    // If section is small enough, keep as one chunk
    const words = cleaned.split(/\s+/);
    if (words.length <= CHUNK_SIZE) {
      chunks.push({ content: cleaned, section: sectionTitle, source });
      continue;
    }
    
    // Split large sections into overlapping chunks by paragraphs
    const paragraphs = cleaned.split(/\n\n+/);
    let currentChunk = [];
    let currentWords = 0;
    let chunkIdx = 0;
    
    for (const para of paragraphs) {
      const paraWords = para.split(/\s+/).length;
      
      if (currentWords + paraWords > CHUNK_SIZE && currentChunk.length > 0) {
        chunks.push({
          content: currentChunk.join('\n\n'),
          section: `${sectionTitle} (part ${chunkIdx + 1})`,
          source,
        });
        chunkIdx++;
        
        // Keep last paragraph for overlap
        const lastPara = currentChunk[currentChunk.length - 1];
        currentChunk = [lastPara];
        currentWords = lastPara.split(/\s+/).length;
      }
      
      currentChunk.push(para);
      currentWords += paraWords;
    }
    
    if (currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.join('\n\n'),
        section: chunkIdx > 0 ? `${sectionTitle} (part ${chunkIdx + 1})` : sectionTitle,
        source,
      });
    }
  }
  
  return chunks;
}

// ── Embedding ──────────────────────────────────────────────────

async function embedBatch(texts) {
  const batchSize = 50; // OpenAI limit is higher, but be safe
  const allEmbeddings = [];
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });
    
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embeddings error: ${response.status} ${err}`);
    }
    
    const data = await response.json();
    for (const item of data.data) {
      allEmbeddings.push(item.embedding);
    }
    
    if (i + batchSize < texts.length) {
      console.log(`  Embedded ${i + batchSize}/${texts.length} chunks...`);
    }
  }
  
  return allEmbeddings;
}

// ── DB Schema Ingestion ────────────────────────────────────────

async function ingestDbSchema() {
  console.log('\n📊 Ingesting database schema...');
  
  // Check if already ingested
  if (!FORCE) {
    const existing = await pool.query("SELECT COUNT(*) as count FROM chat_knowledge WHERE source = 'db-schema'");
    if (parseInt(existing.rows[0].count) > 0) {
      console.log('  Already ingested (use --force to re-ingest)');
      return;
    }
  }
  
  // Delete old schema entries
  await pool.query("DELETE FROM chat_knowledge WHERE source = 'db-schema'");
  
  // Get all tables with columns
  const result = await pool.query(`
    SELECT t.table_name, 
           string_agg(c.column_name || ' ' || c.data_type, ', ' ORDER BY c.ordinal_position) as columns
    FROM information_schema.tables t
    JOIN information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE t.table_schema = 'public' AND t.table_type IN ('BASE TABLE', 'VIEW')
    GROUP BY t.table_name
    ORDER BY t.table_name
  `);
  
  // Group tables into logical chunks
  const chunks = [];
  let currentChunk = [];
  let currentSize = 0;
  
  for (const row of result.rows) {
    const entry = `${row.table_name}: ${row.columns}`;
    const entrySize = entry.split(/\s+/).length;
    
    if (currentSize + entrySize > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push({
        content: 'DATABASE SCHEMA:\n' + currentChunk.join('\n\n'),
        section: `DB Schema (tables ${currentChunk.length} tables)`,
        source: 'db-schema',
      });
      currentChunk = [];
      currentSize = 0;
    }
    
    currentChunk.push(entry);
    currentSize += entrySize;
  }
  
  if (currentChunk.length > 0) {
    chunks.push({
      content: 'DATABASE SCHEMA:\n' + currentChunk.join('\n\n'),
      section: `DB Schema (${currentChunk.length} tables)`,
      source: 'db-schema',
    });
  }
  
  console.log(`  ${result.rows.length} tables → ${chunks.length} chunks`);
  
  // Embed and store
  const texts = chunks.map(c => c.content);
  const embeddings = await embedBatch(texts);
  
  for (let i = 0; i < chunks.length; i++) {
    await pool.query(
      'INSERT INTO chat_knowledge (source, section, chunk_index, content, embedding) VALUES ($1, $2, $3, $4, $5)',
      [chunks[i].source, chunks[i].section, i, chunks[i].content, JSON.stringify(embeddings[i])]
    );
  }
  
  console.log(`  ✅ Stored ${chunks.length} schema chunks`);
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('🧠 FibreFlow Knowledge Ingestion\n');
  
  let totalChunks = 0;
  
  for (const source of SOURCES) {
    console.log(`📄 Processing: ${source.label} (${source.id})`);
    
    if (!fs.existsSync(source.path)) {
      console.log(`  ⚠️  File not found: ${source.path}`);
      continue;
    }
    
    // Check if already ingested
    if (!FORCE) {
      const existing = await pool.query('SELECT COUNT(*) as count FROM chat_knowledge WHERE source = $1', [source.id]);
      if (parseInt(existing.rows[0].count) > 0) {
        console.log(`  Already ingested (${existing.rows[0].count} chunks). Use --force to re-ingest.`);
        continue;
      }
    }
    
    // Delete old entries for this source
    await pool.query('DELETE FROM chat_knowledge WHERE source = $1', [source.id]);
    
    const text = fs.readFileSync(source.path, 'utf-8');
    console.log(`  ${text.length} chars, ${text.split(/\s+/).length} words`);
    
    const chunks = chunkBySection(text, source.id);
    console.log(`  → ${chunks.length} chunks`);
    
    if (chunks.length === 0) continue;
    
    // Embed all chunks
    const texts = chunks.map(c => c.content);
    console.log(`  Embedding ${texts.length} chunks...`);
    const embeddings = await embedBatch(texts);
    
    // Store in DB
    for (let i = 0; i < chunks.length; i++) {
      await pool.query(
        'INSERT INTO chat_knowledge (source, section, chunk_index, content, embedding, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          chunks[i].source,
          chunks[i].section,
          i,
          chunks[i].content,
          JSON.stringify(embeddings[i]),
          JSON.stringify({ label: source.label }),
        ]
      );
    }
    
    console.log(`  ✅ Stored ${chunks.length} chunks`);
    totalChunks += chunks.length;
  }
  
  // Also ingest DB schema
  await ingestDbSchema();
  
  // Final count
  const total = await pool.query('SELECT COUNT(*) as count FROM chat_knowledge');
  console.log(`\n✅ Done! Total knowledge chunks: ${total.rows[0].count}`);
  
  await pool.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
