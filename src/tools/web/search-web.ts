import { z } from "zod";
import type { ToolDefinition } from "../../types/tool.js";

const inputSchema = z.object({
  query: z.string().min(1).optional(),
  engine: z.enum(["auto", "google", "bing", "baidu"]).default("auto"),
  topic: z.enum(["general", "ai", "tech", "finance"]).default("general"),
  site: z.enum(["all", "xinhua", "caixin", "36kr", "cls", "eastmoney"]).default("all"),
  timeRange: z.enum(["any", "24h", "7d"]).default("any"),
  limit: z.number().int().positive().max(20).default(8)
});

type SearchEngine = "auto" | "google" | "bing" | "baidu";
type Topic = "general" | "ai" | "tech" | "finance";
type Site = "all" | "xinhua" | "caixin" | "36kr" | "cls" | "eastmoney";
type TimeRange = "any" | "24h" | "7d";

interface NewsItem {
  title: string;
  url: string;
  source?: string;
  publishedAt?: string;
}

export function createWebSearchTool(networkEnabled: boolean): ToolDefinition<
  z.infer<typeof inputSchema>,
  {
    query: string;
    engine: SearchEngine;
    topic: Topic;
    site: Site;
    timeRange: TimeRange;
    source: string;
    fetchedAt: string;
    items: NewsItem[];
    degraded?: boolean;
  }
> {
  return {
    name: "web_search",
    description: "Search current web/news topics and return clickable links",
    riskLevel: "low",
    inputSchema,
    async run(input) {
      if (!networkEnabled) {
        return {
          ok: false,
          error: "Network access is disabled. Set NETWORK_ENABLED=true to enable web search."
        };
      }

      const topic = input.topic;
      const engine = input.engine;
      const site = input.site;
      const timeRange = input.timeRange;

      const topicQueryMap: Record<Topic, string> = {
        general: "今日 热点 新闻",
        ai: "AI 人工智能 今日热点",
        tech: "科技 行业 今日热点",
        finance: "财经 经济 市场 今日热点"
      };

      const baseQuery = input.query?.trim() || topicQueryMap[topic];
      const query = buildQuery(baseQuery, engine, site, timeRange).slice(0, 180);
      const limit = input.limit;

      try {
        const queryVariants = uniqueNonEmpty([
          query,
          baseQuery,
          topicQueryMap[topic],
          "今日 热点 新闻"
        ]).map((item) => item.slice(0, 180));

        const allCandidates = [
          {
            source: "google_news_rss",
            buildUrl: (q: string) =>
              "https://news.google.com/rss/search?q=" +
              encodeURIComponent(q) +
              "&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
            parser: parseGoogleNewsRss
          },
          {
            source: "bing_news_rss",
            buildUrl: (q: string) =>
              "https://www.bing.com/news/search?q=" +
              encodeURIComponent(q) +
              "&setlang=zh-cn&format=rss",
            parser: parseGenericRss
          },
          {
            source: "baidu_news_html",
            buildUrl: (q: string) =>
              "https://www.baidu.com/s?tn=news&ie=utf-8&wd=" +
              encodeURIComponent(q),
            parser: parseBaiduNewsHtml
          }
        ];

        const candidates =
          engine === "auto"
            ? allCandidates
            : allCandidates.filter((item) => item.source.startsWith(engine));

        const errors: string[] = [];
        let selectedSource = "";
        let items: NewsItem[] = [];

        for (const candidate of candidates) {
          for (const variant of queryVariants) {
            for (let attempt = 1; attempt <= 2; attempt++) {
              try {
                const text = await fetchTextWithTimeout(candidate.buildUrl(variant), 12000);
                const parsedItems = candidate.parser(text).slice(0, limit);
                if (parsedItems.length === 0) {
                  errors.push(`${candidate.source}:${variant}:empty_result`);
                  continue;
                }
                selectedSource = candidate.source;
                items = parsedItems;
                break;
              } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                errors.push(`${candidate.source}:${variant}:attempt_${attempt}:${msg}`);
              }
            }
            if (items.length > 0) break;
          }
          if (items.length > 0) break;
        }

        if (items.length === 0) {
          return {
            ok: true,
            data: {
              query,
              engine,
              topic,
              site,
              timeRange,
              source: "fallback_links",
              fetchedAt: new Date().toISOString(),
              items: buildFallbackHotLinks(engine, topic, site).slice(0, limit),
              degraded: true
            },
            metadata: {
              warning: `Web search degraded. ${errors.slice(0, 4).join(" | ")}`
            }
          };
        }

        return {
          ok: true,
          data: {
            query,
            engine,
            topic,
            site,
            timeRange,
            source: selectedSource,
            fetchedAt: new Date().toISOString(),
            items
          }
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}

function buildQuery(baseQuery: string, engine: SearchEngine, site: Site, timeRange: TimeRange) {
  if (engine === "baidu") {
    const siteHints: Record<Site, string> = {
      all: "",
      xinhua: "新华网",
      caixin: "财新",
      "36kr": "36Kr",
      cls: "财联社",
      eastmoney: "东方财富"
    };
    const timeHints: Record<TimeRange, string> = {
      any: "",
      "24h": "最近一天",
      "7d": "最近一周"
    };

    return [baseQuery, siteHints[site], timeHints[timeRange]].filter(Boolean).join(" ");
  }

  const siteQueryMap: Record<Site, string> = {
    all: "",
    xinhua: "site:xinhuanet.com",
    caixin: "site:caixin.com",
    "36kr": "site:36kr.com",
    cls: "site:cls.cn",
    eastmoney: "site:eastmoney.com"
  };
  const timeQueryMap: Record<TimeRange, string> = {
    any: "",
    "24h": "when:1d",
    "7d": "when:7d"
  };

  return [baseQuery, siteQueryMap[site], timeQueryMap[timeRange]].filter(Boolean).join(" ");
}

function parseGoogleNewsRss(xml: string): NewsItem[] {
  const rows: NewsItem[] = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  for (const block of itemBlocks) {
    const title = decodeHtmlEntities(extractTag(block, "title") || "").trim();
    const url = decodeHtmlEntities(extractTag(block, "link") || "").trim();
    const source = decodeHtmlEntities(extractTag(block, "source") || "").trim();
    const publishedAt = (extractTag(block, "pubDate") || "").trim();

    if (!title || !url) continue;
    rows.push({
      title,
      url,
      ...(source ? { source } : {}),
      ...(publishedAt ? { publishedAt } : {})
    });
  }

  return rows;
}

function parseGenericRss(xml: string): NewsItem[] {
  const rows: NewsItem[] = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  for (const block of itemBlocks) {
    const title = decodeHtmlEntities(extractTag(block, "title") || "").trim();
    const url = decodeHtmlEntities(extractTag(block, "link") || "").trim();
    const source = decodeHtmlEntities(
      extractTag(block, "source") || extractTag(block, "News:Source") || ""
    ).trim();
    const publishedAt = (extractTag(block, "pubDate") || "").trim();

    if (!title || !url) continue;
    rows.push({
      title,
      url,
      ...(source ? { source } : {}),
      ...(publishedAt ? { publishedAt } : {})
    });
  }

  return rows;
}

function parseBaiduNewsHtml(html: string): NewsItem[] {
  const rows: NewsItem[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a[^>]+href="(https?:\/\/[^\"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const navTitlePattern = /^(?:登录|网页|图片|笔记|地图|贴吧|视频|音乐|文库|知道|百科|更多)$/i;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) && rows.length < 80) {
    const url = decodeHtmlEntities(match[1] || "").trim();
    const title = decodeHtmlEntities(stripHtmlTags(match[2] || "")).trim();

    if (!url || !title) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    if (navTitlePattern.test(title)) continue;
    if (title.length < 6) continue;

    const lowerUrl = url.toLowerCase();
    const isBaiduSearchNav =
      /\/s\?|\/img\?|\/video\?|\/f\?|\/map\.baidu\.com|passport\.baidu\.com/.test(lowerUrl);
    const isBaiduRedirect = lowerUrl.includes("baidu.com/link?url=");
    if (!isBaiduRedirect && isBaiduSearchNav) continue;

    seen.add(url);
    rows.push({ title, url, source: "baidu" });
  }

  return rows;
}

async function fetchTextWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "local-agent/1.0"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ?? null;
}

function decodeHtmlEntities(text: string) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x2F;", "/");
}

function stripHtmlTags(text: string) {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function uniqueNonEmpty(items: string[]) {
  const set = new Set<string>();
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    set.add(trimmed);
  }
  return [...set.values()];
}

function buildFallbackHotLinks(engine: SearchEngine, topic: Topic, site: Site): NewsItem[] {
  const topicLabelMap: Record<Topic, string> = {
    general: "综合",
    ai: "AI",
    tech: "科技",
    finance: "财经"
  };

  const siteLinks: Record<string, NewsItem> = {
    xinhua: { title: "新华网新闻首页", url: "https://www.xinhuanet.com/" },
    caixin: { title: "财新网", url: "https://www.caixin.com/" },
    "36kr": { title: "36Kr", url: "https://36kr.com/" },
    cls: { title: "财联社", url: "https://www.cls.cn/" },
    eastmoney: { title: "东方财富", url: "https://www.eastmoney.com/" }
  };

  const baiduBase: NewsItem[] = [
    {
      title: `${topicLabelMap[topic]}热点（百度新闻）`,
      url: `https://www.baidu.com/s?tn=news&wd=${encodeURIComponent(topicLabelMap[topic] + " 热点")}`
    },
    {
      title: "百度新闻首页",
      url: "https://news.baidu.com/"
    }
  ];

  const standardBase: NewsItem[] = [
    {
      title: `${topicLabelMap[topic]}热点（Google News）`,
      url: `https://news.google.com/search?q=${encodeURIComponent(topicLabelMap[topic] + " 热点")}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
    },
    {
      title: `${topicLabelMap[topic]}热点（Bing News）`,
      url: `https://www.bing.com/news/search?q=${encodeURIComponent(topicLabelMap[topic] + " 热点")}&setlang=zh-cn`
    },
    {
      title: "新浪新闻首页",
      url: "https://news.sina.com.cn/"
    }
  ];

  const base =
    engine === "baidu"
      ? [...baiduBase]
      : engine === "google"
        ? [standardBase[0], ...baiduBase, standardBase[2]]
        : engine === "bing"
          ? [standardBase[1], ...baiduBase, standardBase[2]]
          : [...standardBase, ...baiduBase];

  if (site !== "all" && siteLinks[site]) {
    return [siteLinks[site], ...base];
  }

  return [
    ...base,
    siteLinks.xinhua,
    siteLinks.caixin,
    siteLinks["36kr"],
    siteLinks.cls,
    siteLinks.eastmoney
  ];
}
