import { getAccessToken } from './drive.js';
import { logger } from '../utils/logger.js';

export interface TranscriptResult {
  transcript: string;
  fileName: string;
  fileId: string;
  fileDate: string;
}

function normalize(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

interface DocTab {
  tabProperties?: { title?: string };
  documentTab?: { body?: { content?: DocContent[] } };
  childTabs?: DocTab[];
}

interface DocContent {
  paragraph?: { elements?: Array<{ textRun?: { content?: string } }> };
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: DocContent[] }> }> };
  sectionBreak?: unknown;
}

function walkTabs(tabs: DocTab[]): DocTab[] {
  const result: DocTab[] = [];
  for (const tab of tabs) {
    result.push(tab);
    if (tab.childTabs?.length) {
      result.push(...walkTabs(tab.childTabs));
    }
  }
  return result;
}

function extractText(contents: DocContent[]): string {
  let text = '';
  for (const item of contents) {
    if (item.paragraph?.elements) {
      for (const el of item.paragraph.elements) {
        if (el.textRun?.content) text += el.textRun.content;
      }
    }
    if (item.table?.tableRows) {
      for (const row of item.table.tableRows) {
        for (const cell of row.tableCells ?? []) {
          if (cell.content) text += extractText(cell.content);
        }
      }
    }
  }
  return text;
}

export async function extractTranscript(
  fileId: string,
  fileName: string,
  fileDate: string,
): Promise<TranscriptResult> {
  const token = await getAccessToken();
  const url = `https://docs.googleapis.com/v1/documents/${fileId}?includeTabsContent=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Docs API error: ${res.status} ${body}`);
  }

  const doc = (await res.json()) as { tabs?: DocTab[] };

  if (!doc.tabs?.length) {
    throw new Error(`Document has no tabs`);
  }

  const allTabs = walkTabs(doc.tabs);
  const transcriptTab = allTabs.find((tab) => {
    const title = tab.tabProperties?.title ?? '';
    const n = normalize(title);
    return n.includes('transcricao') || n.includes('transcript');
  });

  if (!transcriptTab) {
    const available = allTabs
      .map((t) => t.tabProperties?.title ?? '(unnamed)')
      .join(', ');
    throw new Error(`Tab "Transcrição" not found. Available tabs: ${available}`);
  }

  const body = transcriptTab.documentTab?.body?.content ?? [];
  const transcript = extractText(body).trim();

  logger.info('Transcript extracted', { fileId, chars: transcript.length });

  return { transcript, fileName, fileId, fileDate };
}
