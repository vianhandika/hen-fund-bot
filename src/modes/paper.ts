import { runOrchestratorTick } from '../services/orchestrator.service.js';

export const startPaper = async () => {
  // Jalankan satu tick; interval utama sudah di app.ts
  await runOrchestratorTick();
};
