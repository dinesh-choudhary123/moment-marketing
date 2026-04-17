import type { MomentCategory, MomentPriority, MomentType, Platform, Currency, Ownership, PostPlatform } from '@/types';

export const MOMENT_TYPES: MomentType[] = ['Fixed', 'Fluid', 'Brand'];

export const MOMENT_CATEGORIES: MomentCategory[] = [
  'Sports', 'Movies', 'Meme', 'Entertainment', 'Music',
  'Marketing', 'Tech', 'Food', 'Fashion', 'Politics',
  'Health', 'Travel', 'Finance', 'Gaming',
];

export const MOMENT_PRIORITIES: MomentPriority[] = ['High', 'Medium', 'Low'];

export const PLATFORMS: Platform[] = ['Twitter', 'Instagram', 'YouTube', 'Facebook', 'Google', 'Reddit'];

export const POST_PLATFORMS: PostPlatform[] = [
  'Instagram', 'Facebook', 'YouTube', 'LinkedIn', 'Twitter', 'Pinterest', 'Snapchat',
];

export const CURRENCIES: Currency[] = ['INR', 'USD', 'EUR', 'GBP', 'JPY'];

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

export const OWNERSHIPS: Ownership[] = ['Say Hi!', 'Small Talk', 'Conversation'];

export const CONTENT_BUCKETS = ['Brand', 'Product', 'Campaign', 'Educational', 'Engagement', 'Seasonal'];

export const PRIORITY_COLORS: Record<MomentPriority, string> = {
  High: 'bg-red-500',
  Medium: 'bg-amber-500',
  Low: 'bg-emerald-500',
};

export const TYPE_COLORS: Record<MomentType, string> = {
  Fixed: 'bg-blue-100 text-blue-700',
  Fluid: 'bg-purple-100 text-purple-700',
  Brand: 'bg-orange-100 text-orange-700',
};

export const CATEGORY_COLORS: Record<MomentCategory, string> = {
  Sports: 'bg-green-100 text-green-700',
  Movies: 'bg-pink-100 text-pink-700',
  Meme: 'bg-yellow-100 text-yellow-700',
  Entertainment: 'bg-purple-100 text-purple-700',
  Music: 'bg-red-100 text-red-700',
  Marketing: 'bg-blue-100 text-blue-700',
  Tech: 'bg-cyan-100 text-cyan-700',
  Food: 'bg-orange-100 text-orange-700',
  Fashion: 'bg-pink-100 text-pink-700',
  Politics: 'bg-slate-100 text-slate-700',
  Health: 'bg-emerald-100 text-emerald-700',
  Travel: 'bg-sky-100 text-sky-700',
  Finance: 'bg-indigo-100 text-indigo-700',
  Gaming: 'bg-violet-100 text-violet-700',
};

// Dictionary of fixed/annual events for classifier
export const FIXED_EVENTS_KEYWORDS = [
  'ipl', 'cricket', 'world cup', 'champions league', 'fifa', 'olympic',
  'diwali', 'holi', 'eid', 'christmas', 'new year', 'independence day',
  'republic day', 'valentine', 'halloween', 'thanksgiving', 'easter',
  'budget', 'election', 'icc', 'wimbledon', 'formula 1', 'f1',
  'super bowl', 'oscars', 'grammy', 'emmys', 'bafta', 'cannes',
  'raksha', 'navratri', 'ganesh', 'pongal', 'onam',
];

// Known brand keywords for classifier
export const BRAND_KEYWORDS = [
  'zomato', 'swiggy', 'amazon', 'flipkart', 'netflix', 'disney',
  'apple', 'google', 'microsoft', 'meta', 'twitter', 'instagram',
  'reliance', 'tata', 'infosys', 'wipro', 'hdfc', 'sbi', 'airtel',
  'jio', 'ola', 'uber', 'byju', 'zepto', 'blinkit', 'dunzo',
  'kitkat', 'cadbury', 'amul', 'haldirams', 'parle', 'britannia',
  'myntra', 'nykaa', 'meesho', 'razorpay', 'paytm', 'phonepe',
];

export const PLATFORM_CHAR_LIMITS: Record<PostPlatform, number> = {
  Instagram: 2200,
  Facebook: 63206,
  YouTube: 5000,
  LinkedIn: 3000,
  Twitter: 280,
  Pinterest: 500,
  Snapchat: 250,
};
