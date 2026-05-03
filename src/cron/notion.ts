import { Client } from '@notionhq/client';
import { config } from '../config.js';
import { chunkText } from '../utils/chunk.js';
import { logger } from '../utils/logger.js';
import type { ClaudeResult } from './claude.js';

export interface NotionResult {
  meetingPageId: string;
  meetingPageUrl: string;
  tasksCreated: Array<{ title: string; notionPageId: string }>;
}

const notion = new Client({ auth: config.notion.token });

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: Error | null = null;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err as Error;
      const isRateLimit =
        typeof err === 'object' && err !== null && 'status' in err && (err as { status: number }).status === 429;
      if (isRateLimit) {
        const wait = 1000 * Math.pow(2, i);
        logger.warn(`Notion rate limit on ${label}, retrying in ${wait}ms`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
  throw lastErr!;
}

export async function createMeetingPage(
  fileName: string,
  fileId: string,
  fileDate: string,
  summary: string,
): Promise<string> {
  const page = await withRetry(
    () =>
      notion.pages.create({
        parent: { database_id: config.notion.meetingRecordingsDbId },
        properties: {
          Nome: { title: [{ text: { content: fileName } }] },
          Resumo: { rich_text: [{ text: { content: summary.slice(0, 2000) } }] },
          'Data da Call': { date: { start: fileDate.split('T')[0] } },
          'Arquivo Drive': {
            url: `https://drive.google.com/file/d/${fileId}/view`,
          },
        },
        children: [
          {
            object: 'block',
            type: 'heading_2',
            heading_2: { rich_text: [{ text: { content: 'Transcrição completa' } }] },
          },
        ],
      }),
    'createMeetingPage',
  );

  logger.info('Notion meeting page created', { pageId: page.id });
  return page.id;
}

export async function appendTranscriptChunks(pageId: string, transcript: string): Promise<void> {
  const chunks = chunkText(transcript, 1900);
  const blocks = chunks.map((text) => ({
    object: 'block' as const,
    type: 'paragraph' as const,
    paragraph: { rich_text: [{ text: { content: text } }] },
  }));

  for (let i = 0; i < blocks.length; i += 100) {
    await withRetry(
      () =>
        notion.blocks.children.append({
          block_id: pageId,
          children: blocks.slice(i, i + 100),
        }),
      `appendTranscript batch ${i}`,
    );
  }

  logger.info('Transcript chunks appended', { pageId, chunks: blocks.length });
}

export async function createTasks(
  tasks: ClaudeResult['tasks'],
  fileName: string,
): Promise<Array<{ title: string; notionPageId: string }>> {
  const created: Array<{ title: string; notionPageId: string }> = [];

  for (const task of tasks) {
    const properties: Record<string, unknown> = {
      Nome: { title: [{ text: { content: task.title.slice(0, 100) } }] },
      Descrição: { rich_text: [{ text: { content: task.description.slice(0, 2000) } }] },
      Prioridade: { select: { name: task.priority } },
      Origem: { rich_text: [{ text: { content: fileName.slice(0, 2000) } }] },
    };

    if (task.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)) {
      properties['Prazo'] = { date: { start: task.dueDate } };
    }

    const page = await withRetry(
      () =>
        notion.pages.create({
          parent: { database_id: config.notion.tarefasDbId },
          properties,
        }),
      `createTask "${task.title}"`,
    );

    created.push({ title: task.title, notionPageId: page.id });
    logger.info('Notion task created', { title: task.title, pageId: page.id });
  }

  return created;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
