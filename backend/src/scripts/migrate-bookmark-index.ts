import { BookmarkModel } from '../modules/content/bookmark.model';
import { closeDatabase, connectDatabase } from '../db/mongoose';
import { loadConfig } from '../config/env';

async function migrateBookmarkIndex(): Promise<void> {
  const config = loadConfig();
  await connectDatabase(config.MONGODB_URI, config.MONGODB_DB_NAME);
  try {
    const collection = BookmarkModel.collection;
    const collectionExists = await collection.db
      .listCollections({ name: collection.collectionName }, { nameOnly: true })
      .hasNext();
    const indexes = collectionExists ? await collection.indexes() : [];
    const typedIndexName = 'bookmark_user_type_content_unique';
    const typedIndex = indexes.find((index) => index.name === typedIndexName);

    if (typedIndex && (
      typedIndex.key.userId !== 1 ||
      typedIndex.key.contentType !== 1 ||
      typedIndex.key.postId !== 1 ||
      typedIndex.unique !== true
    )) {
      throw new Error(`Unexpected index definition for ${typedIndexName}.`);
    }

    if (!typedIndex) {
      await collection.createIndex(
        { userId: 1, contentType: 1, postId: 1 },
        { unique: true, name: typedIndexName },
      );
    }

    const legacyIndex = indexes.find((index) =>
      index.name === 'bookmark_user_post_unique' &&
      index.key.userId === 1 &&
      index.key.postId === 1 &&
      !('contentType' in index.key),
    );
    if (legacyIndex?.name) {
      await collection.dropIndex(legacyIndex.name);
    }
    console.info(JSON.stringify({ event: 'bookmark_index_migration_complete' }));
  } finally {
    await closeDatabase();
  }
}

migrateBookmarkIndex().catch((error: unknown) => {
  console.error('Bookmark index migration failed.', error);
  process.exitCode = 1;
});
