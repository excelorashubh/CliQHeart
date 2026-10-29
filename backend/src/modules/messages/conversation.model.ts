import { Schema, model, type InferSchemaType } from 'mongoose';

const conversationSchema = new Schema(
  {
    participantPair: {
      type: String,
      required: true,
      unique: true,
      match: /^[a-f\d]{24}:[a-f\d]{24}$/i,
    },
    participants: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
      required: true,
      validate: {
        validator: (participants: Schema.Types.ObjectId[]) =>
          participants.length === 2 &&
          String(participants[0]) !== String(participants[1]),
        message: 'A conversation must have two distinct participants.',
      },
    },
    lastMessageAt: { type: Date, default: Date.now, required: true },
    lastMessage: {
      id: { type: Schema.Types.ObjectId, ref: 'Message' },
      text: { type: String, maxlength: 4000 },
      senderId: { type: Schema.Types.ObjectId, ref: 'User' },
      createdAt: { type: Date },
    },
    unreadCounts: {
      type: Map,
      of: { type: Number, min: 0 },
      default: () => new Map(),
    },
  },
  { timestamps: true, strict: 'throw' },
);

conversationSchema.index({ participants: 1, lastMessageAt: -1 });

export type Conversation = InferSchemaType<typeof conversationSchema>;
export const ConversationModel = model<Conversation>('Conversation', conversationSchema);
