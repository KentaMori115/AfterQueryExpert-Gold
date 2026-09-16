/** Starts the service. Nothing else in the tree calls this. */
import { buildApp } from './app';
import { env } from './config/env';
import { openDatabase } from './db/client';
import { logger } from './lib/logger';

const db = openDatabase();
const app = buildApp({ db });

app.listen(env.port, () => {
  logger.info('listening', { port: env.port, databaseFile: env.databaseFile });
});
