import { z } from 'zod';

export const workspaceIdentitySchema = z.object({
  userId: z.string().trim().min(1, 'User ID is required.'),
  workspaceId: z.string().trim().min(1, 'Workspace ID is required.'),
});
