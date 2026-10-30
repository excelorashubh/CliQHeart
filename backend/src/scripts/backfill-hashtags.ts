import mongoose from 'mongoose';
import { loadConfig } from '../config/env';
import { closeDatabase, connectDatabase } from '../db/mongoose';
import { HashtagModel } from '../modules/content/hashtag.model';
import { PostModel } from '../modules/content/post.model';
import { ReelModel } from '../modules/content/reel.model';

const pageSize = 500;

async function backfillHashtags(): Promise<void> {
  const config = loadConfig();
  const counts = new Map<string, number>();
  let updatedContent = 0;
  try {
    await connectDatabase(config.MONGODB_URI, config.MONGODB_DB_NAME);
    for (const collectionName of [PostModel.collection.name, ReelModel.collection.name]) {
      const collection = mongoose.connection.collection(collectionName);
      const operations: Parameters<typeof collection.bulkWrite>[0][number][] = [];
      const cursor = collection.find({}, { projection: { _id: 1, caption: 1, hashtags: 1 } });
      for await (const content of cursor) {
        const hashtags = extractHashtags(typeof content.caption === 'string' ? content.caption : '');
        hashtags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
        if (JSON.stringify(content.hashtags ?? []) !== JSON.stringify(hashtags)) {
          operations.push({
            updateOne: {
              filter: { _id: content._id },
              update: { $set: { hashtags } },
            },
          });
        }
        if (operations.length >= pageSize) {
          await collection.bulkWrite(operations);
          updatedContent += operations.length;
          operations.length = 0;
        }
      }
      if (operations.length) {
        await collection.bulkWrite(operations);
        updatedContent += operations.length;
      }
    }

    await HashtagModel.updateMany({}, { $set: { usageCount: 0 } });
    const hashtagOperations = [...counts].map(([normalizedName, usageCount]) => ({
      updateOne: {
        filter: { normalizedName },
        update: {
          $set: { name: normalizedName, normalizedName, usageCount },
        },
        upsert: true,
      },
    }));
    for (let index = 0; index < hashtagOperations.length; index += pageSize) {
      await HashtagModel.bulkWrite(hashtagOperations.slice(index, index + pageSize));
    }
    console.info(JSON.stringify({
      event: 'hashtag_backfill_completed',
      updatedContent,
      hashtagCount: counts.size,
    }));
  } finally {
    await closeDatabase();
  }
}

function extractHashtags(caption: string): string[] {
  const tags = new Set<string>();
  for (const match of caption.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const normalized = (match[1] ?? '').normalize('NFKC').toLocaleLowerCase('en-US');
    if (/^[\p{L}\p{N}_]{1,50}$/u.test(normalized)) tags.add(normalized);
  }
  return [...tags];
}

void backfillHashtags().catch(() => {
  console.error('Hashtag backfill failed; rerun the command after reviewing database connectivity and content.');
  process.exitCode = 1;
});
