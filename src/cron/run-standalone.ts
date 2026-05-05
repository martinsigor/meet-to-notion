/**
 * Standalone runner — executa o pipeline Meet → Notion uma vez e sai.
 * Usado pela Routine do claude.ai (sem servidor HTTP).
 * As credenciais vêm de variáveis de ambiente (não do .env).
 */
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getDb, createRun, updateRun, isFileProcessed, markFileSuccess, markFileError, saveTask, getLastSuccessfulRunTime } from '../db.js';
import { getMostRecentFile, listNewFiles } from './drive.js';
import { extractTranscript } from './transcript.js';
import { analyzeTranscript } from './claude.js';
import { createMeetingPage, appendTranscriptChunks, createTasks, isAlreadyInNotion } from './notion.js';

const MIN_TRANSCRIPT_CHARS = 50;
const MODE = process.argv[2] ?? 'cron'; // 'cron' | 'latest'

async function main() {
  logger.info('Standalone runner iniciado', { mode: MODE });
  getDb(); // inicializa SQLite

  const runId = createRun();
  let filesFound = 0, processed = 0, skipped = 0, errored = 0;
  const errors: string[] = [];

  try {
    const files = MODE === 'latest'
      ? await getMostRecentFile().then(f => f ? [f] : [])
      : await listNewFiles(
          getLastSuccessfulRunTime() ??
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        );

    filesFound = files.length;
    logger.info(`${filesFound} arquivo(s) encontrado(s)`);

    for (const file of files) {
      // Deduplicação: verifica SQLite local primeiro, depois o Notion (para ambientes cloud sem SQLite persistente)
      if (isFileProcessed(file.id)) {
        logger.info('Já processado (SQLite), pulando', { name: file.name });
        skipped++;
        continue;
      }

      if (await isAlreadyInNotion(file.id)) {
        logger.info('Já existe no Notion, pulando', { name: file.name });
        skipped++;
        continue;
      }

      let step = '';
      try {
        step = 'extração da transcrição';
        const { transcript } = await extractTranscript(file.id, file.name, file.createdTime);

        if (transcript.length < MIN_TRANSCRIPT_CHARS) {
          logger.warn('Transcrição muito curta, pulando', { chars: transcript.length });
          skipped++;
          continue;
        }

        step = 'análise por IA';
        const result = await analyzeTranscript(transcript);

        step = 'criação da página no Notion';
        const pageId = await createMeetingPage(file.name, file.id, file.createdTime, result.summary);

        step = 'upload da transcrição';
        await appendTranscriptChunks(pageId, transcript);

        step = 'criação das tasks';
        const tasks = await createTasks(result.tasks, file.name);

        markFileSuccess(file.id, file.name, pageId, tasks.length);
        for (const t of tasks) saveTask(runId, file.id, t.title, '', t.notionPageId);
        processed++;
        logger.info('✓ Processado com sucesso', { name: file.name, tasks: tasks.length });

      } catch (err) {
        const msg = `[${step}] ${err instanceof Error ? err.message : String(err)}`;
        logger.error('✗ Erro', { name: file.name, error: msg });
        markFileError(file.id, file.name, msg);
        errors.push(`${file.name}: ${msg}`);
        errored++;
      }
    }

    const status = errored === 0 ? 'success' : processed === 0 ? 'error' : 'partial';
    updateRun(runId, { filesFound, filesProcessed: processed, filesSkipped: skipped, filesErrored: errored, status });

    logger.info('Runner finalizado', { status, filesFound, processed, skipped, errored });
    if (errors.length) {
      logger.error('Erros encontrados:\n' + errors.join('\n'));
      process.exit(1);
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Erro fatal', { error: msg });
    updateRun(runId, { filesFound: 0, filesProcessed: 0, filesSkipped: 0, filesErrored: 0, status: 'error', errorMessage: msg });
    process.exit(1);
  }
}

main();
