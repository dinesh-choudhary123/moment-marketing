import { router } from './trpc';
import { momentsRouter } from './routers/moments';
import { calendarRouter } from './routers/calendar';
import { scraperRouter } from './routers/scraper';
import { postRouter } from './routers/post';

export const appRouter = router({
  moments: momentsRouter,
  calendar: calendarRouter,
  scraper: scraperRouter,
  post: postRouter,
});

export type AppRouter = typeof appRouter;
