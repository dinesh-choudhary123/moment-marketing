export type MomentType = 'Fixed' | 'Fluid' | 'Brand';

export type MomentCategory =
  | 'Sports' | 'Movies' | 'Meme' | 'Entertainment' | 'Music'
  | 'Marketing' | 'Tech' | 'Food' | 'Fashion' | 'Politics'
  | 'Health' | 'Travel' | 'Finance' | 'Gaming';

export type MomentPriority = 'High' | 'Medium' | 'Low';

export type Platform =
  | 'Twitter' | 'Instagram' | 'YouTube' | 'Facebook' | 'Google' | 'Reddit';

export type PostPlatform =
  | 'Instagram' | 'Facebook' | 'YouTube' | 'LinkedIn' | 'Twitter' | 'Pinterest' | 'Snapchat';

export type MediaTab = 'Static' | 'Video' | 'Story' | 'Carousel';
export type MediaInputTab = 'Enter URL' | 'Upload Creative' | 'Generate with AI';

export type Ownership = 'Say Hi!' | 'Small Talk' | 'Conversation';

export type Currency = 'INR' | 'USD' | 'EUR' | 'GBP' | 'JPY';

export interface Moment {
  id: string;
  name: string;
  description: string;
  type: MomentType;
  category: MomentCategory;
  priority: MomentPriority;
  platforms: Platform[];
  imageUrl?: string;
  trendingScore: number;
  date?: string;
  isCustom: boolean;
  createdAt: string;
  tags: string[];
}

export interface CalendarEntry {
  id: string;
  momentId: string;
  moment: Moment;
  date: string;
  day: string;
  ownership: Ownership;
  creativeBudget: number;
  mediaBudget: number;
  currency: Currency;
  benchmarks: BenchmarkEntry[];
  createdAt: string;
}

export interface BenchmarkEntry {
  id: string;
  calendarEntryId: string;
  type: string;
  brandName: string;
  url: string;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  autoFetched: boolean;
  createdAt: string;
}

export interface PostDraft {
  id: string;
  calendarEntryId?: string;
  momentId?: string;
  platforms: PostPlatform[];
  title: string;
  contentBucket: string;
  subBucket: string;
  campaign: string;
  tags: string[];
  mediaTab: MediaTab;
  mediaInputTab: MediaInputTab;
  mediaUrl?: string;
  caption: string;
  hashtags: string[];
  status: 'draft' | 'pending_approval' | 'published';
  syncToAllPlatforms: boolean;
  expectedLikes?: number;
  expectedComments?: number;
  expectedShares?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MomentsFilterState {
  search: string;
  types: MomentType[];
  categories: MomentCategory[];
  priorities: MomentPriority[];
  platforms: Platform[];
  month: string | null;
}

export interface CalendarFilterState {
  tab: 'available' | 'my-calendar';
  ownership: Ownership | 'All';
  currency: Currency;
}

export interface ScraperStatus {
  lastScrapedAt: string | null;
  totalMoments: number;
  byPlatform: Partial<Record<Platform, number>>;
  isRunning: boolean;
}
