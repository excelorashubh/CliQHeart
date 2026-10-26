import type { HydratedDocument } from 'mongoose';
import { UserModel, type User } from '../../models/user';
import { userProfileInputSchema } from './user.validation';

export class UserService {
  buildDraft(input: unknown): HydratedDocument<User> {
    const profile = userProfileInputSchema.parse(input);
    return new UserModel(profile);
  }
}
