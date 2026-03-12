export interface LocalModelClientConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface ModelJsonResponse {
  text: string;
}

export class LocalModelClient {
  constructor(private readonly config: LocalModelClientConfig) {}

  async generateText(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(
        `${this.config.baseUrl.replace(/\/$/, "")}/api/generate`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: this.config.model,
            prompt,
            stream: false,
            options: {
              temperature: 0.3
            }
          }),
          signal: controller.signal
        }
      );

      if (!response.ok) {
        throw new Error(`Local model request failed: ${response.status}`);
      }

      const data = (await response.json()) as { response?: string };

      if (!data.response || typeof data.response !== "string") {
        throw new Error("Local model returned empty response");
      }

      return data.response.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  async generateJson(prompt: string): Promise<ModelJsonResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(
        `${this.config.baseUrl.replace(/\/$/, "")}/api/generate`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: this.config.model,
            prompt,
            format: "json",
            stream: false,
            options: {
              temperature: 0
            }
          }),
          signal: controller.signal
        }
      );

      if (!response.ok) {
        throw new Error(`Local model request failed: ${response.status}`);
      }

      const data = (await response.json()) as { response?: string };

      if (!data.response || typeof data.response !== "string") {
        throw new Error("Local model returned empty response");
      }

      return { text: data.response };
    } finally {
      clearTimeout(timer);
    }
  }
}
