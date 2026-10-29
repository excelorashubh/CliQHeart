import { Types, type ClientSession } from 'mongoose';
import { UserModel } from '../../models/user';
import { ProfessionalEventModel } from './professional.model';

type TrackedEventType = 'profile_view' | 'post_view' | 'reel_view' | 'follow' | 'unfollow';

export async function recordProfessionalEvent(
  ownerId: string,
  viewerId: string,
  eventType: TrackedEventType,
  targetId?: string,
  mutationKey?: string,
  session?: ClientSession,
): Promise<void> {
  if (ownerId === viewerId || !Types.ObjectId.isValid(ownerId) || !Types.ObjectId.isValid(viewerId)) return;
  const owner = await UserModel.findOne({
    _id: ownerId,
    accountStatus: 'active',
    accountType: { $in: ['CREATOR', 'BUSINESS'] },
  }).select('_id').session(session ?? null).lean();
  if (!owner) return;

  const eventDay = new Date().toISOString().slice(0, 10);
  const deduplicationKey = mutationKey ??
    `${ownerId}:${viewerId}:${eventType}:${targetId ?? 'profile'}:${eventDay}`;
  try {
    await ProfessionalEventModel.updateOne(
      { deduplicationKey },
      {
        $setOnInsert: {
          ownerId,
          viewerId,
          targetId: targetId && Types.ObjectId.isValid(targetId) ? targetId : null,
          eventType,
          deduplicationKey,
          eventDay,
        },
      },
      { upsert: true, ...(session ? { session } : {}) },
    );
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) return;
    throw error;
  }
}

export function recordProfileView(ownerId: string, viewerId: string): void {
  trackWithoutBlocking(ownerId, viewerId, 'profile_view');
}

export function recordContentView(
  ownerId: string,
  viewerId: string,
  contentType: 'post' | 'reel',
  contentId: string,
): void {
  trackWithoutBlocking(ownerId, viewerId, contentType === 'post' ? 'post_view' : 'reel_view', contentId);
}

function trackWithoutBlocking(
  ownerId: string,
  viewerId: string,
  eventType: TrackedEventType,
  targetId?: string,
): void {
  void recordProfessionalEvent(ownerId, viewerId, eventType, targetId).catch((error: unknown) => {
    console.error(JSON.stringify({
      event: 'professional_analytics_write_failed',
      type: eventType,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }));
  });
}
