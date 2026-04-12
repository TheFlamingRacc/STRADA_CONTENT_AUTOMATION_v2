import { fileURLToPath } from 'url';
import EngagementService from '../services/EngagementService.js';

/**
 * Запускається за cron-розкладом з index.js.
 * Можна також запустити напряму для тесту.
 */
export async function runEngagement(users = [], nextSlotTime = null) {
  await EngagementService.runForAll(users, nextSlotTime);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runEngagement().catch(console.error);
}
