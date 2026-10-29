import { createServer, type Server } from 'node:http';
import { createApp } from './app';
import { loadConfig } from './config/env';
import { closeDatabase, connectDatabase } from './db/mongoose';
import { attachRealtimeServer, closeRealtimeDependencies } from './modules/messages/realtime';

async function start(): Promise<void> {
  const config = loadConfig();
  const server = createServer(createApp({ config }));
  await attachRealtimeServer(server, config);

  const shutdown = createShutdownHandler(server);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  server.once('error', () => {
    console.error('CliQHeart API server failed to start.');
    process.exitCode = 1;
    void Promise.all([closeDatabase(), closeRealtimeDependencies()]).catch(() => {
      process.exitCode = 1;
    });
  });

  server.listen(config.PORT, config.HOST, () => {
    if (config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'info') {
      console.info(
        JSON.stringify({
          level: 'info',
          event: 'server_listening',
          app: config.APP_NAME,
          host: config.HOST,
          port: config.PORT,
          version: config.APP_VERSION,
        }),
      );
    }
  });

  void connectDatabase(config.MONGODB_URI, config.MONGODB_DB_NAME).catch(() => {
    console.error(JSON.stringify({
      level: 'error',
      event: 'database_connection_failed',
      database: config.MONGODB_DB_NAME,
    }));
  });
}

function createShutdownHandler(server: Server): () => void {
  let shuttingDown = false;

  return () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    server.close((serverError) => {
      void Promise.all([closeDatabase(), closeRealtimeDependencies()])
        .catch(() => {
          process.exitCode = 1;
        })
        .finally(() => {
          if (serverError) {
            process.exitCode = 1;
          }
        });
    });
  };
}

void start().catch(async () => {
  await Promise.all([closeDatabase(), closeRealtimeDependencies()]).catch(() => undefined);
  console.error('CliQHeart API startup failed. Check configuration and database availability.');
  process.exitCode = 1;
});
