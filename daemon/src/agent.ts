import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildContinuePrompt, buildUserPrompt, SYSTEM_PROMPT } from "./prompts.ts";
import { createWikiTools } from "./wiki.ts";
import type {
  AuthKind,
  HealthResponse,
  LoginPromptPayload,
  ModelsResponse,
  ProviderInfo,
  TaskRequest,
} from "./types.ts";

export interface RunHandlers {
  onDelta: (text: string) => void;
}

export interface LoginHandlers {
  onEvent: (event: AuthEvent) => void;
  onPrompt: (prompt: LoginPromptPayload) => void;
}

type RuntimeModel = Awaited<ReturnType<ModelRuntime["getAvailable"]>>[number];
type AuthEvent = {
  type: string;
  url?: string;
  instructions?: string;
  message?: string;
  userCode?: string;
  verificationUri?: string;
  links?: { url: string; label?: string }[];
};
type AuthPrompt = {
  type: LoginPromptPayload["type"];
  message: string;
  placeholder?: string;
  options?: { id: string; label: string; description?: string }[];
  signal?: AbortSignal;
};

const HOME_DIR = path.join(os.homedir(), ".liuli");

function ensureHome(): string {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  return HOME_DIR;
}

function modelKey(model: RuntimeModel): string {
  return `${model.provider}/${model.id}`;
}

function isVision(model: RuntimeModel): boolean {
  return model.input.includes("image");
}

function pickModel(
  available: readonly RuntimeModel[],
  prefer: string | undefined,
  preferVision: boolean,
): RuntimeModel | undefined {
  if (available.length === 0) return undefined;
  if (prefer) {
    const found = available.find(
      (m) =>
        m.id === prefer ||
        modelKey(m) === prefer ||
        m.name === prefer,
    );
    if (found) return found;
  }
  const env = process.env.LIULI_MODEL?.trim();
  if (env) {
    const found = available.find(
      (m) => m.id === env || modelKey(m) === env || m.name === env,
    );
    if (found) return found;
  }
  const pool = preferVision
    ? available.filter((m) => isVision(m))
    : available;
  const search = pool.length > 0 ? pool : available;
  const preferred = [
    "grok-4.6",
    "grok-4.5",
    "grok-4",
    "grok-3",
    "gpt-4.1",
    "gpt-4o",
    "gemini-2.5",
    "claude-sonnet",
  ];
  for (const needle of preferred) {
    const found = search.find(
      (m) => m.id.includes(needle) || m.name.toLowerCase().includes(needle),
    );
    if (found) return found;
  }
  return search[0];
}

export class LiuliAgent {
  private runtime: ModelRuntime | undefined;
  private session: AgentSession | undefined;
  private model: RuntimeModel | undefined;
  private preferredModel: string | undefined;
  private running = Promise.resolve();
  private abortCurrent: (() => void) | undefined;
  private promptWaiters = new Map<
    string,
    { resolve: (value: string) => void; reject: (error: Error) => void }
  >();
  private loginAbort: AbortController | undefined;
  private wikiRoot = "";
  private readonly wikiTools = createWikiTools(() => this.wikiRoot);

  async start(): Promise<HealthResponse> {
    ensureHome();
    this.runtime = await ModelRuntime.create();
    const available = await this.runtime.getAvailable();
    this.model = pickModel(available, this.preferredModel, true);
    if (this.model) {
      await this.recreateSession();
    }
    return this.health();
  }

  health(): HealthResponse {
    if (!this.runtime) {
      return { ok: false, error: "daemon 尚未就绪" };
    }
    if (!this.model) {
      return {
        ok: false,
        error: "没有可用模型。请在设置里登录一个供应商。",
      };
    }
    return {
      ok: true,
      model: this.model.id,
      provider: String(this.model.provider),
      vision: isVision(this.model),
    };
  }

  async abort(): Promise<void> {
    this.abortCurrent?.();
    if (this.session?.isStreaming) {
      await this.session.abort();
    }
  }

  cancelLogin(): void {
    this.loginAbort?.abort();
    for (const [id, waiter] of this.promptWaiters) {
      waiter.reject(new Error("Login cancelled"));
      this.promptWaiters.delete(id);
    }
  }

  answerPrompt(id: string, value: string): void {
    const waiter = this.promptWaiters.get(id);
    if (!waiter) throw new Error("没有等待中的登录提问");
    this.promptWaiters.delete(id);
    waiter.resolve(value);
  }

  listProviders(): ProviderInfo[] {
    if (!this.runtime) return [];
    return this.runtime.getProviders().map((provider) => {
      const authTypes: AuthKind[] = [];
      if (provider.auth.apiKey?.login) authTypes.push("api_key");
      if (provider.auth.oauth) authTypes.push("oauth");
      const status = this.runtime?.getProviderAuthStatus(provider.id);
      return {
        id: provider.id,
        name: provider.name,
        authTypes,
        configured: Boolean(status?.configured),
        source: status?.label ?? status?.source,
        loginLabel: provider.auth.oauth?.loginLabel ?? provider.auth.oauth?.name,
      };
    });
  }

  async listModels(): Promise<ModelsResponse> {
    if (!this.runtime) return { models: [] };
    const available = await this.runtime.getAvailable();
    return {
      current: this.model ? modelKey(this.model) : undefined,
      models: available.map((m) => ({
        id: m.id,
        provider: String(m.provider),
        name: m.name,
        vision: isVision(m),
      })),
    };
  }

  async setModel(id: string): Promise<HealthResponse> {
    if (!this.runtime) throw new Error("daemon 尚未就绪");
    this.preferredModel = id;
    const available = await this.runtime.getAvailable();
    const next = pickModel(available, id, false);
    if (!next) throw new Error(`找不到模型 ${id}`);
    this.model = next;
    if (this.session) {
      await this.session.setModel(next);
    } else {
      await this.recreateSession();
    }
    return this.health();
  }

  async login(
    providerId: string,
    type: AuthKind,
    handlers: LoginHandlers,
    apiKey?: string,
  ): Promise<void> {
    if (!this.runtime) throw new Error("daemon 尚未就绪");
    this.cancelLogin();
    const ac = new AbortController();
    this.loginAbort = ac;

    try {
      const interaction = {
        signal: ac.signal,
        notify: (event: AuthEvent) => {
          console.log(`[liuli] login event ${event.type}`);
          handlers.onEvent(event);
        },
        prompt: async (prompt: AuthPrompt) => {
          console.log(`[liuli] login prompt ${prompt.type}: ${prompt.message}`);
          if (prompt.type === "select") {
            const browser = prompt.options?.find(
              (option) =>
                option.id === "browser" || /browser/i.test(option.label),
            );
            if (browser) {
              console.log(`[liuli] auto-select ${browser.id}`);
              return browser.id;
            }
          }
          if (
            apiKey &&
            (prompt.type === "secret" || prompt.type === "text")
          ) {
            return apiKey;
          }
          const id = randomUUID();
          const payload: LoginPromptPayload = {
            id,
            type: prompt.type,
            message: prompt.message,
            placeholder: prompt.placeholder,
            options:
              prompt.type === "select"
                ? [...prompt.options]
                : undefined,
          };
          handlers.onPrompt(payload);
          return await new Promise<string>((resolve, reject) => {
            this.promptWaiters.set(id, { resolve, reject });
            const abort = () => {
              this.promptWaiters.delete(id);
              reject(new Error("Login cancelled"));
            };
            ac.signal.addEventListener("abort", abort, { once: true });
            prompt.signal?.addEventListener("abort", abort, { once: true });
          });
        },
      };
      try {
        await this.runtime.login(providerId, type, interaction);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("Node.js environments")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
        await this.runtime.login(providerId, type, interaction);
      }
      const available = await this.runtime.getAvailable();
      if (!this.model) {
        this.model = pickModel(available, this.preferredModel, true);
        if (this.model) await this.recreateSession();
      }
    } finally {
      if (this.loginAbort === ac) this.loginAbort = undefined;
    }
  }

  async logout(providerId: string): Promise<void> {
    if (!this.runtime) throw new Error("daemon 尚未就绪");
    await this.runtime.logout(providerId);
    const available = await this.runtime.getAvailable();
    if (
      this.model &&
      !available.some((m) => modelKey(m) === modelKey(this.model as RuntimeModel))
    ) {
      this.model = pickModel(available, this.preferredModel, true);
      if (this.model) {
        await this.session?.setModel(this.model);
      } else {
        this.session?.dispose();
        this.session = undefined;
      }
    }
  }

  async run(task: TaskRequest, handlers: RunHandlers): Promise<string> {
    const gate = this.running.then(() => this.runExclusive(task, handlers));
    this.running = gate.then(
      () => undefined,
      () => undefined,
    );
    return gate;
  }

  private async runExclusive(
    task: TaskRequest,
    handlers: RunHandlers,
  ): Promise<string> {
    if (!this.session || !this.model) {
      const started = await this.start();
      if (!started.ok) throw new Error(started.error ?? "daemon 启动失败");
    }

    const session = this.session;
    if (!session) throw new Error("session 不可用");

    if (session.isStreaming) {
      await session.abort();
    }

    const continuing =
      task.keepSession === true &&
      (task.action === "explain" || task.action === "followup");
    if (!continuing) {
      session.agent.state.messages = [];
    }

    this.wikiRoot = task.wikiRoot?.trim() ?? "";
    const useWiki =
      Boolean(this.wikiRoot) &&
      (task.action === "explain" || task.action === "followup");
    session.setActiveToolsByName(useWiki ? ["wiki_search", "wiki_read"] : []);

    const hasImage = Boolean(task.imageBase64) && !continuing;
    if (hasImage && this.model && !isVision(this.model)) {
      throw new Error(
        `当前模型 ${modelKey(this.model)} 不支持图像，请在设置里换成带视觉的模型`,
      );
    }

    const hasHistory = session.agent.state.messages.length > 0;
    if (
      (task.action === "explain" || task.action === "followup") &&
      !hasHistory &&
      !task.context?.trim() &&
      !task.text?.trim() &&
      !task.imageBase64
    ) {
      throw new Error("没有可继续的对话");
    }

    const prompt =
      task.action === "explain" || task.action === "followup"
        ? buildContinuePrompt({
            action: task.action,
            text: task.text,
            context: task.context,
            reading: task.reading,
            wikiAvailable: useWiki,
            seedContext: !hasHistory,
            targetLang: task.targetLang,
          })
        : buildUserPrompt({
            mode: task.mode,
            text: task.text,
            hasImage,
            targetLang: task.targetLang,
            sourceLang: task.sourceLang,
          });

    let full = "";
    const unsub = session.subscribe((event: AgentSessionEvent) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        const delta = event.assistantMessageEvent.delta;
        full += delta;
        handlers.onDelta(delta);
      }
    });

    let aborted = false;
    this.abortCurrent = () => {
      aborted = true;
      void session.abort();
    };

    try {
      await session.prompt(prompt, {
        expandPromptTemplates: false,
        images: hasImage
          ? [
              {
                type: "image",
                data: task.imageBase64 as string,
                mimeType: task.mimeType || "image/png",
              },
            ]
          : undefined,
      });
      const error = session.agent.state.errorMessage;
      if (error) throw new Error(error);
      if (aborted) throw new Error("已取消");
      return full;
    } finally {
      unsub();
      this.abortCurrent = undefined;
    }
  }

  dispose(): void {
    this.cancelLogin();
    this.session?.dispose();
    this.session = undefined;
  }

  private async recreateSession(): Promise<void> {
    this.session?.dispose();
    if (!this.model) return;
    const cwd = ensureHome();
    const agentDir = getAgentDir();
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: () => SYSTEM_PROMPT,
      appendSystemPromptOverride: () => [],
      agentsFilesOverride: () => ({ agentsFiles: [] }),
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd,
      agentDir,
      model: this.model,
      thinkingLevel: "off",
      modelRuntime: this.runtime,
      resourceLoader: loader,
      noTools: "builtin",
      customTools: this.wikiTools,
      tools: ["wiki_search", "wiki_read"],
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: true, maxRetries: 2 },
      }),
    });
    session.setActiveToolsByName([]);
    this.session = session;
  }
}
