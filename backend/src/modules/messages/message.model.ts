import { Schema, model, type InferSchemaType } from 'mongoose';

const messageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 4000,
    },
  },
  { timestamps: true, strict: 'throw' },
);

messageSchema.index({ conversationId: 1, createdAt: -1 });

export type Message = InferSchemaType<typeof messageSchema>;
export const MessageModel = model<Message>('Message', messageSchema);
