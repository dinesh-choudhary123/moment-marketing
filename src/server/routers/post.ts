import { z } from 'zod';
import { router, publicProcedure } from '@/server/trpc';
import { postStore } from '@/server/db/store';
import { generateId } from '@/lib/utils';
import type { PostDraft } from '@/types';

const PostPlatformSchema = z.enum(['Instagram', 'Facebook', 'YouTube', 'LinkedIn', 'Twitter', 'Pinterest', 'Snapchat']);

export const postRouter = router({
  saveDraft: publicProcedure
    .input(z.object({
      id: z.string().optional(),
      calendarEntryId: z.string().optional(),
      momentId: z.string().optional(),
      platforms: z.array(PostPlatformSchema).min(1),
      title: z.string().default(''),
      contentBucket: z.string().default(''),
      subBucket: z.string().default(''),
      campaign: z.string().default(''),
      tags: z.array(z.string()).default([]),
      mediaTab: z.enum(['Static', 'Video', 'Story', 'Carousel']).default('Static'),
      mediaInputTab: z.enum(['Enter URL', 'Upload Creative', 'Generate with AI']).default('Upload Creative'),
      mediaUrl: z.string().optional(),
      caption: z.string().default(''),
      hashtags: z.array(z.string()).default([]),
      syncToAllPlatforms: z.boolean().default(true),
      expectedLikes: z.number().optional(),
      expectedComments: z.number().optional(),
      expectedShares: z.number().optional(),
    }))
    .mutation(({ input }) => {
      const now = new Date().toISOString();
      const existingId = input.id;
      const existing = existingId ? postStore.get(existingId) : undefined;

      const draft: PostDraft = {
        id: existing?.id ?? generateId(),
        calendarEntryId: input.calendarEntryId,
        momentId: input.momentId,
        platforms: input.platforms,
        title: input.title,
        contentBucket: input.contentBucket,
        subBucket: input.subBucket,
        campaign: input.campaign,
        tags: input.tags,
        mediaTab: input.mediaTab,
        mediaInputTab: input.mediaInputTab,
        mediaUrl: input.mediaUrl,
        caption: input.caption,
        hashtags: input.hashtags,
        status: existing?.status ?? 'draft',
        syncToAllPlatforms: input.syncToAllPlatforms,
        expectedLikes: input.expectedLikes,
        expectedComments: input.expectedComments,
        expectedShares: input.expectedShares,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      postStore.set(draft.id, draft);
      return draft;
    }),

  sendForApproval: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const draft = postStore.get(input.id);
      if (!draft) throw new Error('Draft not found');
      draft.status = 'pending_approval';
      draft.updatedAt = new Date().toISOString();
      postStore.set(input.id, draft);
      return draft;
    }),

  publish: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const draft = postStore.get(input.id);
      if (!draft) throw new Error('Draft not found');
      draft.status = 'published';
      draft.updatedAt = new Date().toISOString();
      postStore.set(input.id, draft);
      return draft;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => postStore.get(input.id) ?? null),
});
