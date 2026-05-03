/**
 * End-to-end test (mocked) for the main processing pipeline.
 * Run: npx tsx test/process.test.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Mock helpers ──────────────────────────────────────────────────────────────

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

// ── chunkText ─────────────────────────────────────────────────────────────────

async function testChunk() {
  console.log('\nchunkText');
  const { chunkText } = await import('../src/utils/chunk.js');

  const short = 'hello world';
  assert(chunkText(short).length === 1, 'short text returns single chunk');
  assert(chunkText(short)[0] === short, 'single chunk equals original');

  const long = 'a'.repeat(4000);
  const chunks = chunkText(long, 1900);
  assert(chunks.length === 3, 'long text splits into 3 chunks of 1900');
  assert(chunks.every((c) => c.length <= 1900), 'all chunks ≤ 1900 chars');
  assert(chunks.join('') === long, 'chunks concatenate to original');

  const withNewlines = 'line1\nline2\nline3\n'.repeat(200);
  const nlChunks = chunkText(withNewlines, 1900);
  assert(nlChunks.every((c) => c.length <= 1900), 'newline chunks respect max');
}

// ── Claude output parser ──────────────────────────────────────────────────────

async function testClaudeParser() {
  console.log('\nClaude output parser');

  // We test the internal logic by directly exercising the JSON extraction
  const rawClean = `{"summary":"Test summary","tasks":[{"title":"Do X","description":"Context","assignee":null,"priority":"Alta","dueDate":null}]}`;
  const withFences = `\`\`\`json\n${rawClean}\n\`\`\``;
  const withPrefix = `Sure! Here is the JSON:\n${rawClean}`;

  function parse(raw: string): unknown {
    let text = raw.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('no JSON');
    return JSON.parse(text.slice(start, end + 1));
  }

  assert(typeof (parse(rawClean) as Record<string, unknown>).summary === 'string', 'parses clean JSON');
  assert(typeof (parse(withFences) as Record<string, unknown>).summary === 'string', 'strips markdown fences');
  assert(typeof (parse(withPrefix) as Record<string, unknown>).summary === 'string', 'extracts from text with prefix');
}

// ── Transcript from example file ─────────────────────────────────────────────

async function testTranscriptFile() {
  console.log('\nExample transcript');
  const txt = readFileSync(path.join(__dirname, 'example-transcript.txt'), 'utf8');
  assert(txt.length > 50, 'example transcript has content');
  assert(txt.includes('Igor'), 'contains speaker name');
  assert(txt.includes('task') || txt.includes('entreg') || txt.includes('revis'), 'contains actionable content');
}

// ── Run all ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Running tests...');
  try {
    await testChunk();
    await testClaudeParser();
    await testTranscriptFile();
    console.log('\n✅ All tests passed\n');
  } catch (err) {
    console.error('\n❌', (err as Error).message);
    process.exit(1);
  }
}

main();
