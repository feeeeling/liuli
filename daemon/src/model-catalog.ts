import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

type CatalogRuntime = Pick<ModelRuntime, "hasConfiguredAuth" | "refresh"> & {
  getProviders(): readonly { id: string }[];
};

/** Refresh the SDK's persisted remote catalogs, coalescing concurrent UI requests. */
export class LiveModelCatalog {
  private pending: Promise<string | undefined> | undefined;

  constructor(
    private readonly runtime: CatalogRuntime,
    private readonly timeoutMs = 10_000,
  ) {}

  refresh(): Promise<string | undefined> {
    this.pending ??= this.fetch().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async fetch(): Promise<string | undefined> {
    if (process.env.PI_OFFLINE !== undefined) {
      return "离线模式：使用本地模型列表";
    }
    const providers = this.runtime.getProviders()
      .filter((provider) => this.runtime.hasConfiguredAuth(provider.id))
      .map((provider) => provider.id);
    if (providers.length === 0) return;

    try {
      const result = await this.runtime.refresh({
        allowNetwork: true,
        force: true,
        providers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (result.aborted) return "模型列表刷新超时，使用已有列表，可稍后重试";
      if (result.errors.size > 0) {
        return `部分模型列表刷新失败（${[...result.errors.keys()].join("、")}），保留已有列表`;
      }
    } catch {
      return "模型列表刷新失败，使用已有列表，可稍后重试";
    }
  }
}
