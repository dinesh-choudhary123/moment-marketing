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

  // Generate a 2-3 sentence "why is this trending?" blurb. Uses Gemini 1.5 Flash
  // free tier if GEMINI_API_KEY is set; otherwise falls back to a smart heuristic.
  // Result is cached on the moment itself so subsequent opens are instant.
  generateContext: publicProcedure
    .input(z.object({ momentId: z.string(), force: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      const moment = momentsStore.get(input.momentId);
      if (!moment) throw new Error('Moment not found');
      // Only serve cache if it's an AI result (prefixed with marker) and not forced
      if (!input.force && moment.context && moment.context.startsWith('[ai]')) {
        return { context: moment.context.slice(4).trim(), source: 'cache' as const };
      }

      const geminiKey = process.env.GEMINI_API_KEY;
      let context = '';
      let source: 'ai' | 'heuristic' = 'heuristic';

      if (geminiKey) {
        try {
          const prompt = `You are a sharp social-media analyst who follows Indian and global pop culture in real time. A specific post is trending RIGHT NOW on ${moment.platforms.join(', ')}.

POST TITLE: "${moment.name}"
RAW SOURCE CAPTION / METADATA: "${moment.description}"
PLATFORM: ${moment.platforms.join(', ')}
CATEGORY: ${moment.category}
TAGS: ${moment.tags.join(', ') || 'none'}

Your job: explain in 2-3 sentences WHAT THE TITLE IS LITERALLY TALKING ABOUT and WHY the internet is reacting to it right now — the specific joke, twist, controversy, celebrity drama, news hook, cricket moment, political flare-up, or cultural reference. Read the title carefully and infer the real-world event. Use concrete nouns and names, not categories.

HARD RULES:
- Do NOT write "this is a [category] moment" or any generic category framing.
- Do NOT say "engagement metrics confirm" or mention upvote counts.
- Do NOT hedge ("it seems", "likely", "possibly") — be confident and specific.
- Do NOT repeat the title verbatim.
- If the title is ambiguous (e.g. just a meme image description), describe the meme format and what about it makes people remix it.
- Write for an Indian marketing team deciding within 2 hours whether to post a reaction.

Output only the 2-3 sentence explanation, no preamble.`;

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.8, maxOutputTokens: 260 },
              }),
              signal: AbortSignal.timeout(20_000),
            },
          );
          if (res.ok) {
            const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (text && text.length > 20) {
              context = text;
              source = 'ai';
            }
          } else {
            console.warn('[generateContext] Gemini error', res.status, (await res.text()).slice(0, 300));
          }
        } catch (e) {
          console.warn('[generateContext] Gemini fetch failed:', e);
        }
      } else {
        console.warn('[generateContext] GEMINI_API_KEY not set — using heuristic');
      }

      if (!context) {
        // Heuristic fallback — synthesize a meaningful blurb from available data
        const platform = moment.platforms[0] ?? 'social media';
        const scoreLabel = moment.trendingScore >= 90 ? 'explosively viral'
          : moment.trendingScore >= 75 ? 'high-engagement'
          : moment.trendingScore >= 60 ? 'steady-climbing'
          : 'emerging';
        const catAngle: Record<string, string> = {
          Sports: 'Fans are reacting to a live result, upset, or highlight moment — expect peak chatter in the 6-hour window after the event.',
          Movies: 'This is tied to a release, trailer, or cast controversy. Audiences are sharing opinions and reaction clips.',
          Meme: 'A relatable format or joke has gone viral. The humor comes from remixing it to fit new situations.',
          Entertainment: 'Celebrity news, reality-TV twists, or award-show buzz is driving the conversation.',
          Music: 'A new release, leaked clip, or artist drama is fueling shares — fandom loyalty amplifies reach.',
          Tech: 'A product launch, leak, or controversy is making rounds. Tech Twitter and Reddit tend to debate implications for days.',
          Finance: 'Market moves, earnings surprises, or policy news are being dissected — tone is often cautionary or sarcastic.',
          Fashion: 'A celebrity look, runway moment, or style debate is driving saves and shares on visual platforms.',
          Politics: 'A statement, vote, or event is polarizing audiences — handle with care; tone matters more than speed.',
          Health: 'A study, viral claim, or wellness trend is circulating — credibility signals matter for brand safety.',
          Travel: 'A destination, experience, or travel hack has caught aspirational attention — high save-rate content.',
          Food: 'A recipe, restaurant, or food fail is going viral — fast to replicate with user-generated content.',
          Gaming: 'A release, update, or esports moment is trending — gamers share clips and hot takes in real time.',
          Marketing: 'A brand campaign or ad is being praised or roasted — other brands can hitchhike with a timely reaction.',
        };
        const angle = catAngle[moment.category] ?? 'The conversation is being shaped by reactions, remixes, and hot takes in real time.';
        const stats = moment.description.includes('•') || moment.description.includes('likes') || moment.description.includes('upvotes')
          ? `Engagement metrics (${moment.description}) confirm it's currently active, not evergreen.`
          : `It's scoring ${moment.trendingScore}/100 on our trend index.`;
        context = `This is a ${scoreLabel} ${moment.category.toLowerCase()} moment on ${platform}. ${angle} ${stats}`;
      }

      // Only cache AI results — heuristics should retry next time (maybe key arrives)
      if (source === 'ai') {
        moment.context = '[ai]' + context;
        momentsStore.set(moment.id, moment);
      }
      return { context, source };
    }),

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
