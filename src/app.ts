import { ENV } from './config/index.js';
import { logger } from './utils/logger.js';
import { initStorage } from './storage/file.repo.js';
import { startDryRun } from './modes/dry-run.js';
import { startLive } from './modes/live.js';
import { startPaper } from './modes/paper.js';
import { startDiscord } from './adapters/discord.adapter.js';
import { runOrchestratorTick } from './services/orchestrator.service.js';

const main = async () => {
  await initStorage();
  logger.info({ mode: ENV.BOT_MODE }, 'DCA Bot starting');

  if (ENV.WS_SELFTEST === '1') {
    (async () => {
      try {
        const { wsAuthSelfTest } = await import('./utils/ws.selftest.js');
        await wsAuthSelfTest();
      } catch (e) {
        logger.warn({ err: String(e) }, 'WS self-test runner error');
      }
    })();
  }

  await startDiscord();
  setInterval(() => {
    runOrchestratorTick().catch((e) => logger.error(e, 'orchestrator tick error'));
  }, 2000);

  if (ENV.BOT_MODE === 'dry') await startDryRun();
  else if (ENV.BOT_MODE === 'paper') await startPaper();
  else await startLive();
};

main().catch((err) => { console.error(err); process.exit(1); });