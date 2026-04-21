import type { Moment, MomentType, MomentCategory, MomentPriority, Platform } from '@/types';
import { FIXED_EVENTS_KEYWORDS, BRAND_KEYWORDS } from '@/lib/constants';
import { generateId } from '@/lib/utils';

interface RawTrend {
  name: string;
  description?: string;
  imageUrl?: string;
  trendingScore: number;
  platform: Platform;
  url?: string;
  volume?: number;
  /** ISO timestamp of the original post / trend origin. If omitted, today is used. */
  originDate?: string;
}

// ─── Brand safety — topics to EXCLUDE from marketing moments ────────────────
// These are negative, tragic, or controversial topics that could damage a brand
// if associated with them via a moment marketing campaign.
const BRAND_UNSAFE_KEYWORDS = [
  // Tragedy / violence / crime
  'death', 'dead', 'died', 'killed', 'murder', 'shooting', 'stabbing', 'rape', 'assault',
  'suicide', 'terrorist', 'terrorism', 'blast', 'bomb', 'explosion', 'attack', 'war',
  'genocide', 'massacre', 'riot', 'protest turned violent', 'accident', 'crash', 'disaster',
  'earthquake', 'flood victims', 'tragedy', 'funeral', 'mourning', 'obituary',
  // Controversy / scandal
  'scandal', 'arrested', 'accused', 'allegation', 'convicted', 'corruption', 'bribe',
  'harassment', 'controversy', 'outrage', 'boycott called', 'hate speech',
  // Medical negative
  'epidemic', 'pandemic', 'disease outbreak', 'cancer death', 'hospital critical',
];

// ─── Commercial opportunity boost ───────────────────────────────────────────
// Topics that historically generate strong brand engagement and ROI
const HIGH_COMMERCIAL_KEYWORDS = [
  // Sports seasons — brands activate heavily
  'ipl', 'world cup', 'olympic', 'champions league', 'grand prix', 'wimbledon', 'fifa',
  'match day', 'final', 'tournament',
  // Festivals — massive ad spend seasons
  'diwali', 'holi', 'eid', 'christmas', 'new year', 'navratri', 'durga puja', 'ganesh',
  'pongal', 'onam', 'valentine', 'mother\'s day', 'father\'s day', 'raksha bandhan',
  // Pop culture events — viral co-creation opportunities
  'trailer', 'release', 'premiere', 'concert', 'tour', 'award show', 'oscars', 'grammy',
  'grammy', 'emmys', 'bafta', 'cannes', 'filmfare',
  // Tech moments — product launches drive engagement
  'launch', 'new product', 'announcement', 'unveiled', 'exclusive', 'first look',
  // Finance milestones
  'ipo', 'budget', 'rate cut', 'market rally', 'record high',
  // Viral challenges — brands jump on
  'challenge', 'trend', 'viral dance', 'meme wave', 'viral reel',
];

// ─── Category tags mapping — for auto-tagging ────────────────────────────────
const CATEGORY_AUTO_TAGS: Record<MomentCategory, string[]> = {
  Sports: ['sports', 'live event', 'match day'],
  Movies: ['entertainment', 'cinema', 'pop culture'],
  Meme: ['viral', 'humor', 'relatable', 'trending'],
  Entertainment: ['celebrity', 'pop culture', 'viral'],
  Music: ['music', 'artist', 'concert'],
  Marketing: ['brand', 'campaign', 'marketing'],
  Tech: ['technology', 'innovation', 'digital'],
  Food: ['food', 'lifestyle', 'trending'],
  Fashion: ['fashion', 'style', 'lifestyle'],
  Politics: ['politics', 'government', 'policy'],
  Health: ['health', 'wellness', 'lifestyle'],
  Travel: ['travel', 'tourism', 'destinations'],
  Finance: ['finance', 'economy', 'markets'],
  Gaming: ['gaming', 'esports', 'entertainment'],
};

// ─── Classification logic ────────────────────────────────────────────────────

function isBrandSafe(name: string, description: string): boolean {
  const text = (name + ' ' + description).toLowerCase();
  return !BRAND_UNSAFE_KEYWORDS.some(kw => text.includes(kw));
}

function getCommercialBoost(name: string, description: string): number {
  const text = (name + ' ' + description).toLowerCase();
  const matchCount = HIGH_COMMERCIAL_KEYWORDS.filter(kw => text.includes(kw)).length;
  if (matchCount >= 3) return 8;
  if (matchCount === 2) return 5;
  if (matchCount === 1) return 2;
  return 0;
}

// Keywords that signal a BRAND moment — brand name + a commercial/marketing action
const BRAND_MARKETING_SIGNALS = [
  'launch', 'campaign', 'ad ', 'advertisement', 'promo', 'sale', 'deal', 'offer',
  'collaboration', 'collab', 'partnership', 'sponsor', 'unveil', 'announce', 'drops',
  'new product', 'limited edition', 'rebranding', 'rebrand', 'new feature', 'update',
];

function classifyType(name: string, description: string): MomentType {
  const lower = (name + ' ' + description).toLowerCase();

  // FIXED: Annual/scheduled events with a known date — IPL season, festivals, awards etc.
  // These repeat predictably every year — brands plan well in advance
  const isFixed = FIXED_EVENTS_KEYWORDS.some(k => lower.includes(k));

  // BRAND: Only when a known brand name + a marketing/commercial action appear together
  // e.g. "Zomato launches new feature" → Brand; "Netflix trending" → Fluid (not a brand moment)
  const hasBrandName = BRAND_KEYWORDS.some(b => lower.includes(b));
  const hasBrandAction = BRAND_MARKETING_SIGNALS.some(s => lower.includes(s));
  const isBrand = hasBrandName && hasBrandAction;

  // Priority: Fixed → Brand → Fluid
  // Fixed wins because even if a brand sponsors IPL, the moment itself is Fixed
  if (isFixed) return 'Fixed';
  if (isBrand) return 'Brand';

  // FLUID: Real-time viral content — memes, trending news, viral videos, breaking news
  // These are unpredictable and fast-moving — brands must react quickly
  return 'Fluid';
}

function classifyCategory(name: string, description: string): MomentCategory {
  const text = (name + ' ' + description).toLowerCase();
  // Order matters: most specific first, broadest last
  if (/cricket|ipl|football|fifa|tennis|f1|formula|olympic|\bsport\b|match day|tournament|league|nba|nfl|rugby|world cup/.test(text)) return 'Sports';
  if (/movie|film|cinema|bollywood|hollywood|trailer|oscar|bafta|emmy|cannes|filmfare|box office/.test(text)) return 'Movies';
  if (/\bmusic\b|song|album|concert|singer|\bartist\b|band\b|tour\b|spotify|grammy|indie|rap\b|\bpop\b/.test(text)) return 'Music';
  if (/game|gaming|gta|valorant|pubg|esport|playstation|xbox|nintendo|streamer|bgmi/.test(text)) return 'Gaming';
  if (/\btech\b|\bai\b|startup|software|hardware|gadget|phone|laptop|saas|chatgpt|openai|apple|samsung|google pixel/.test(text)) return 'Tech';
  if (/food|recipe|restaurant|cuisine|\beat\b|dish|cook|chef|street food|foodie|snack/.test(text)) return 'Food';
  if (/fashion|style|clothing|outfit|wear|designer|runway|fdci|couture/.test(text)) return 'Fashion';
  if (/politic|government|election|minister|parliament|policy|\blaw\b|president|\bpm\b|modi/.test(text)) return 'Politics';
  if (/health|fitness|gym|workout|wellness|mental|yoga|diet|transformation|weight/.test(text)) return 'Health';
  if (/travel|trip|tourism|destination|holiday|flight|hotel|backpack|\bvisa\b/.test(text)) return 'Travel';
  if (/finance|stock market|crypto|bitcoin|economy|budget|invest|sensex|nifty|\bipo\b/.test(text)) return 'Finance';
  if (/meme|funny|viral meme|challenge|viral dance|reel|humor|parody|roast/.test(text)) return 'Meme';
  if (/\bbrand\b|campaign|advertis|promo|sponsor|collab|partnership/.test(text)) return 'Marketing';
  if (/netflix|disney|show|series|stream|entertainment|celebrity|reality tv|premiere|release/.test(text)) return 'Entertainment';
  return 'Entertainment';
}

function classifyPriority(score: number): MomentPriority {
  if (score >= 65) return 'High';
  if (score >= 35) return 'Medium';
  return 'Low';
}

function extractTags(name: string, description: string, category: MomentCategory): string[] {
  const text = (name + ' ' + description).toLowerCase();
  const tags = new Set<string>();

  // Add category base tags
  for (const tag of CATEGORY_AUTO_TAGS[category]) tags.add(tag);

  // Extract hashtags from text
  const hashtags = (name + ' ' + description).match(/#(\w+)/g);
  if (hashtags) {
    for (const ht of hashtags.slice(0, 5)) tags.add(ht.toLowerCase().replace('#', ''));
  }

  // Add platform-relevant keyword tags
  if (/ipl|cricket/.test(text)) tags.add('ipl');
  if (/bollywood/.test(text)) tags.add('bollywood');
  if (/viral/.test(text)) tags.add('viral');
  if (/india/.test(text)) tags.add('india');
  if (/festival|diwali|holi|eid/.test(text)) tags.add('festival');
  if (/launch|release|premiere/.test(text)) tags.add('product launch');
  if (/trend|trending/.test(text)) tags.add('trending now');

  return Array.from(tags).slice(0, 6);
}

// ─── Varied category-based fallback images (multiple per category) ────────────
// Using name's first char code as a stable seed to pick different images per moment
const CATEGORY_FALLBACK_IMAGES: Record<MomentCategory, string[]> = {
  Sports: [
    'https://images.unsplash.com/photo-1540747913346-19212a4b423f?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=800&auto=format&fit=crop',
  ],
  Movies: [
    'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1585647347483-22b66260dfff?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=800&auto=format&fit=crop',
  ],
  Meme: [
    'https://images.unsplash.com/photo-1516251193007-45ef944ab0c6?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1531747056595-07f6cbbe10ad?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1543269664-56d93c1b41a6?w=800&auto=format&fit=crop',
  ],
  Entertainment: [
    'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&auto=format&fit=crop',
  ],
  Music: [
    'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1507838153414-b4b713384a76?w=800&auto=format&fit=crop',
  ],
  Marketing: [
    'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1432888622747-4eb9a8f5a11d?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1533750349088-cd871a92f312?w=800&auto=format&fit=crop',
  ],
  Tech: [
    'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800&auto=format&fit=crop',
  ],
  Food: [
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800&auto=format&fit=crop',
  ],
  Fashion: [
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1445205170230-053b83016050?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&auto=format&fit=crop',
  ],
  Politics: [
    'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1555848962-6e79363ec58f?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=800&auto=format&fit=crop',
  ],
  Health: [
    'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1576678927484-cc907957088c?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=800&auto=format&fit=crop',
  ],
  Travel: [
    'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=800&auto=format&fit=crop',
  ],
  Finance: [
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=800&auto=format&fit=crop',
  ],
  Gaming: [
    'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?w=800&auto=format&fit=crop',
  ],
};

// Stable seed from name — picks a consistent but varied image per moment
function pickImage(name: string, arr: string[]): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  return arr[Math.abs(hash) % arr.length];
}

// Pick a keyword-specific Unsplash image — topic-matched for maximum visual relevance
function getSmartFallbackImage(name: string, description: string, category: MomentCategory): string {
  const text = (name + ' ' + description).toLowerCase();
  // Sport-specific
  if (/cricket|ipl|t20|odi|test match/.test(text)) return pickImage(name, [
    'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1540747913346-19212a4b423f?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1624526267942-ab0ff8a3e972?w=800&auto=format&fit=crop',
  ]);
  if (/football|soccer|fifa|premier league/.test(text)) return pickImage(name, [
    'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1553778263-73a83bab9b0c?w=800&auto=format&fit=crop',
  ]);
  if (/tennis|wimbledon/.test(text)) return 'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=800&auto=format&fit=crop';
  if (/f1|formula|motorsport/.test(text)) return 'https://images.unsplash.com/photo-1541447271487-09612b3f49f7?w=800&auto=format&fit=crop';
  if (/basketball|nba/.test(text)) return 'https://images.unsplash.com/photo-1546519638405-a9f1e1b1c198?w=800&auto=format&fit=crop';
  // Bollywood / cinema
  if (/bollywood|hindi film|movie|trailer|release|cinema/.test(text)) return pickImage(name, [
    'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=800&auto=format&fit=crop',
  ]);
  // Festivals
  if (/holi/.test(text)) return 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=800&auto=format&fit=crop';
  if (/diwali/.test(text)) return 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?w=800&auto=format&fit=crop';
  if (/eid/.test(text)) return 'https://images.unsplash.com/photo-1565620731358-e8c038abc8d1?w=800&auto=format&fit=crop';
  if (/christmas/.test(text)) return 'https://images.unsplash.com/photo-1512389142860-9c449e58a543?w=800&auto=format&fit=crop';
  if (/new year/.test(text)) return 'https://images.unsplash.com/photo-1467810563316-b5476525c0f9?w=800&auto=format&fit=crop';
  if (/navratri|garba|dandiya/.test(text)) return 'https://images.unsplash.com/photo-1600093463592-8e36ae95ef56?w=800&auto=format&fit=crop';
  if (/raksha|rakhi/.test(text)) return 'https://images.unsplash.com/photo-1612178537253-bccd437b730e?w=800&auto=format&fit=crop';
  if (/independence day|republic day/.test(text)) return 'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=800&auto=format&fit=crop';
  if (/women.*day|mother.*day|father.*day/.test(text)) return 'https://images.unsplash.com/photo-1607748851687-ba9a10438621?w=800&auto=format&fit=crop';
  // Tech
  if (/iphone|apple/.test(text)) return 'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?w=800&auto=format&fit=crop';
  if (/samsung|android/.test(text)) return 'https://images.unsplash.com/photo-1605236453806-6ff36851218e?w=800&auto=format&fit=crop';
  if (/ai|artificial intelligence|chatgpt|openai/.test(text)) return 'https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=800&auto=format&fit=crop';
  if (/startup|funding/.test(text)) return 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&auto=format&fit=crop';
  // Finance
  if (/budget|tax|income/.test(text)) return 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=800&auto=format&fit=crop';
  if (/stock|sensex|nifty|market|ipo/.test(text)) return 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop';
  if (/crypto|bitcoin/.test(text)) return 'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=800&auto=format&fit=crop';
  // Music
  if (/grammy|oscar|award/.test(text)) return 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=800&auto=format&fit=crop';
  if (/concert|tour|live music/.test(text)) return 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&auto=format&fit=crop';
  // Gaming
  if (/bgmi|pubg|gaming|esport/.test(text)) return pickImage(name, CATEGORY_FALLBACK_IMAGES.Gaming);
  // Fashion / brands
  if (/fashion|runway|couture/.test(text)) return pickImage(name, CATEGORY_FALLBACK_IMAGES.Fashion);
  if (/food|recipe|restaurant/.test(text)) return pickImage(name, CATEGORY_FALLBACK_IMAGES.Food);
  if (/travel|trip|tourism/.test(text)) return pickImage(name, CATEGORY_FALLBACK_IMAGES.Travel);
  if (/health|fitness|gym|yoga/.test(text)) return pickImage(name, CATEGORY_FALLBACK_IMAGES.Health);
  // Brand campaigns
  if (/campaign|ad |advertis|collab/.test(text)) return pickImage(name, CATEGORY_FALLBACK_IMAGES.Marketing);
  // Return varied category default (different image per moment name)
  return pickImage(name, CATEGORY_FALLBACK_IMAGES[category]);
}

// ─── Main classifier export ───────────────────────────────────────────────────

export function classifyTrend(raw: RawTrend): Moment | null {
  const description = raw.description ?? `Trending on ${raw.platform} with score ${raw.trendingScore}`;

  // Brand safety gate — skip topics that could damage a brand's reputation
  if (!isBrandSafe(raw.name, description)) {
    return null; // Caller should filter out nulls
  }

  const category = classifyCategory(raw.name, description);
  const commercialBoost = getCommercialBoost(raw.name, description);
  const finalScore = Math.min(100, raw.trendingScore + commercialBoost);
  const tags = extractTags(raw.name, description, category);

  // Normalize originDate → valid ISO string. Handles:
  //   • ISO strings ("2026-04-21T10:00:00Z")
  //   • RFC 2822 / RSS ("Mon, 21 Apr 2026 14:30:00 +0000")
  //   • Unix seconds or ms as number / numeric string
  //   • Plain "YYYY-MM-DD"
  // Falls back to now if unparseable so UI never shows "Invalid Date".
  const normalizedOriginIso = (() => {
    const raw0 = raw.originDate;
    if (!raw0) return new Date().toISOString();
    // numeric (epoch) — seconds if <1e12, ms otherwise
    if (typeof raw0 === 'number' || /^\d+$/.test(String(raw0))) {
      const n = Number(raw0);
      const ms = n < 1e12 ? n * 1000 : n;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }
    const d = new Date(String(raw0));
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  })();

  // GUARANTEED IMAGE: Every moment must have a visual.
  // Local paths (/images/ig/*, /api/image-proxy*) are always trusted.
  // External URLs from known-blocked CDNs get replaced with Unsplash fallbacks.
  // Instagram images should be locally cached by the scraper, not raw CDN URLs.
  const blockedDomains = ['scontent.cdninstagram.com', 'instagram.com/p/', 'preview.redd.it', 'external-preview.redd.it'];
  const isLocalOrProxy = raw.imageUrl && (raw.imageUrl.startsWith('/images/') || raw.imageUrl.startsWith('/api/'));
  const providedImage = raw.imageUrl && (isLocalOrProxy || !blockedDomains.some(d => raw.imageUrl!.includes(d)))
    ? raw.imageUrl
    : undefined;
  const imageUrl = providedImage ?? getSmartFallbackImage(raw.name, description, category);

  return {
    id: generateId(),
    name: raw.name,
    description,
    type: classifyType(raw.name, description),
    category,
    priority: classifyPriority(finalScore),
    platforms: [raw.platform],
    imageUrl,
    trendingScore: finalScore,
    date: normalizedOriginIso.slice(0, 10),
    isCustom: false,
    createdAt: normalizedOriginIso,
    tags,
  };
}
