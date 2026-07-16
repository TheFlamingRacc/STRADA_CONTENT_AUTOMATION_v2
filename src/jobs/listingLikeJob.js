import { fileURLToPath } from 'url';
import EngagementService from '../services/EngagementService.js';

/**
 * Запускається за cron-розкладом з index.js (окремі слоти лайків оголошень).
 * Можна також запустити напряму для тесту: npm run listing-like.
 */
export async function runListingLike(users = [], nextSlotTime = null) {
  await EngagementService.runListingLikeForAll(users, nextSlotTime);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { getUsers } = await import('../config.js');
  runListingLike(getUsers()).catch(console.error);
}
