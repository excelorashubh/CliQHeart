import mongoose from 'mongoose';

let connectionPromise: Promise<typeof mongoose> | undefined;

mongoose.connection.on('disconnected', () => {
  console.warn(JSON.stringify({ level: 'warn', event: 'database_disconnected' }));
});
mongoose.connection.on('reconnected', () => {
  console.info(JSON.stringify({ level: 'info', event: 'database_reconnected' }));
});
mongoose.connection.on('error', () => {
  console.error(JSON.stringify({ level: 'error', event: 'database_connection_error' }));
});

export async function connectDatabase(uri: string, databaseName: string): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(uri, {
      dbName: databaseName,
      serverSelectionTimeoutMS: 5000,
    });
  }

  try {
    await connectionPromise;
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'database_connected',
        database: databaseName,
      }),
    );
  } finally {
    connectionPromise = undefined;
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function closeDatabase(): Promise<void> {
  await connectionPromise?.catch(() => undefined);
  connectionPromise = undefined;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
