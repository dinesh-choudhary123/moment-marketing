import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/root';

// Allow long-running mutations (e.g. Apify scraping can take 60-120s)
export const maxDuration = 300;

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => ({}),
  });

export { handler as GET, handler as POST };
