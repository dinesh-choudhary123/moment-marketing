import { z } from 'zod';
import { router, publicProcedure } from '@/server/trpc';
import { momentsStore, calendarStore, getMoments } from '@/server/db/store';
import { generateId, getDayName } from '@/lib/utils';
import type { CalendarEntry, Moment } from '@/types';

const MomentTypeSchema = z.enum(['Fixed', 'Fluid', 'Brand']);
const CategorySchema = z.enum(['Sports', 'Movies', 'Meme', 'Entertainment', 'Music', 'Marketing', 'Tech', 'Food', 'Fashion', 'Politics', 'Health', 'Travel', 'Finance', 'Gaming']);
const PrioritySchema = z.enum(['High', 'Medium', 'Low']);
const PlatformSchema = z.enum(['Twitter', 'Instagram', 'YouTube', 'Facebook', 'Google', 'Reddit']);

export const momentsRouter = router({
  list: publicProcedure
    .input(z.object({
      search: z.string().optional(),
      types: z.array(MomentTypeSchema).optional(),
      categories: z.array(CategorySchema).optional(),
      priorities: z.array(PrioritySchema).optional(),
      platforms: z.array(PlatformSchema).optional(),
      month: z.string().nullable().optional(),
    }))
    .query(({ input }) => {
      let moments = getMoments();

      if (input.search) {
        const q = input.search.toLowerCase();
        moments = moments.filter(m =>
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.tags.some(t => t.toLowerCase().includes(q)),
        );
      }
      if (input.types?.length) {
        moments = moments.filter(m => input.types!.includes(m.type));
      }
      if (input.categories?.length) {
        moments = moments.filter(m => input.categories!.includes(m.category));
      }
      if (input.priorities?.length) {
        moments = moments.filter(m => input.priorities!.includes(m.priority));
      }
      if (input.platforms?.length) {
        moments = moments.filter(m => m.platforms.some(p => input.platforms!.includes(p)));
      }
      if (input.month) {
        moments = moments.filter(m => m.date?.startsWith(input.month!));
      }

      return moments;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => momentsStore.get(input.id) ?? null),

  createCustom: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      type: MomentTypeSchema,
      category: CategorySchema,
      priority: PrioritySchema,
      platforms: z.array(PlatformSchema).min(1),
      date: z.string().optional(),
      imageUrl: z.string().url().optional().or(z.literal('')),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(({ input }) => {
      const moment: Moment = {
        id: generateId(),
        name: input.name,
        description: input.description,
        type: input.type,
        category: input.category,
        priority: input.priority,
        platforms: input.platforms,
        date: input.date,
        imageUrl: input.imageUrl || undefined,
        trendingScore: input.priority === 'High' ? 80 : input.priority === 'Medium' ? 55 : 30,
        isCustom: true,
        createdAt: new Date().toISOString(),
        tags: input.tags ?? [],
      };
      momentsStore.set(moment.id, moment);
      return moment;
    }),

  addToCalendar: publicProcedure
    .input(z.object({
      momentId: z.string(),
      date: z.string(),
      ownership: z.enum(['Say Hi!', 'Small Talk', 'Conversation']).optional(),
    }))
    .mutation(({ input }) => {
      const moment = momentsStore.get(input.momentId);
      if (!moment) throw new Error('Moment not found');

      // Check if already added
      const existing = Array.from(calendarStore.values()).find(
        e => e.momentId === input.momentId && e.date === input.date,
      );
      if (existing) return existing;

      const entry: CalendarEntry = {
        id: generateId(),
        momentId: input.momentId,
        moment,
        date: input.date,
        day: getDayName(input.date),
        ownership: input.ownership ?? 'Say Hi!',
        creativeBudget: 500,
        mediaBudget: 1000,
        currency: 'INR',
        benchmarks: [],
        createdAt: new Date().toISOString(),
      };
      calendarStore.set(entry.id, entry);
      return entry;
    }),

  deleteCustom: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const moment = momentsStore.get(input.id);
      if (!moment?.isCustom) throw new Error('Can only delete custom moments');
      momentsStore.delete(input.id);
      return { success: true };
    }),
});
