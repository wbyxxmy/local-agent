import { z } from "zod";
import type { ToolDefinition } from "../../types/tool.js";

const inputSchema = z.object({
  query: z.string().min(1).optional(),
  topic: z.enum(["general", "ai", "tech", "finance"]).default("general"),
  site: z.enum(["all", "xinhua", "caixin", "36kr", "cls", "eastmoney"]).default("all"),
  timeRange: z.enum(["any", "24h", "7d"]).default("any"),
  limit: z.number().int().positive().max(20).default(8)
});

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
    topic: "general" | "ai" | "tech" | "finance";
    site: "all" | "xinhua" | "caixin" | "36kr" | "cls" | "eastmoney";
    timeRange: "any" | "24h" | "7d";
    source: string;
    fetchedAt: string;
    items: NewsItem[];
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

      const topicQueryMap: Record<"general" | "ai" | "tech" | "finance", string> = {
        general: "今日 热点 新闻",
        ai: "AI 人工智能 今日热点",
        tech: "科技 行业 今日热点",
        finance: "财经 经济 市场 今日热点"
      };

      const topic = input.topic;
      const site = input.site;
      const timeRange = input.timeRange;
      const siteQueryMap: Record<typeof site, string> = {
        all: "",
        xinhua: "site:xinhuanet.com",
        caixin: "site:caixin.com",
        "36kr": "site:36kr.com",
        cls: "site:cls.cn",
        eastmoney: "site:eastmoney.com"
      };
      const timeQueryMap: Record<typeof timeRange, string> = {
        any: "",
        "24h": "when:1d",
        "7d": "when:7d"
      };

      const baseQuery = input.query?.trim() || topicQueryMap[topic];
      const composedQuery = [baseQuery, siteQueryMap[site], timeQueryMap[timeRange]]
        .filter(Boolean)
        .join(" ");
      const query = composedQuery.slice(0, 180);
      const limit = input.limit;

      try {
        const urls = [
          {
            source: "google_news_rss",
            url:
              "https://news.google.com/rss/search?q=" +
              encodeURIComponent(query) +
              "&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
            parser: parseGoogleNewsRss
          },
          {
            source: "bing_news_rss",
            url:
              "https://www.bing.com/news/search?q=" +
              encodeURIComponent(query) +
              "&setlang=zh-cn&format=rss",
            parser: parseGenericRss
          }
        ];

        const errors: string[] = [];
        let selectedSource = "";
        let items: NewsItem[] = [];

        for (const candidate of urls) {
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              const xml = await fetchTextWithTimeout(candidate.url, 9000);
              const parsedItems = candidate.parser(xml).slice(0, limit);
              if (parsedItems.length === 0) {
                errors.push(`${candidate.source}:empty_result`);
                continue;
              }
              selectedSource = candidate.source;
              items = parsedItems;
              break;
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              errors.push(`${candidate.source}:attempt_${attempt}:${msg}`);
            }
          }
          if (items.length > 0) break;
        }

        if (items.length === 0) {
          return {
            ok: false,
            error: `Web search failed. ${errors.slice(0, 4).join(" | ")}`
          };
        }

        return {
          ok: true,
          data: {
            query,
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
