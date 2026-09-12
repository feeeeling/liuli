export const TASK_MODES = [
  "translate",
  "ocr",
  "ocr-translate",
  "latex",
] as const;
export type TaskMode = (typeof TASK_MODES)[number];

export const AUTH_TYPES = ["api_key", "oauth"] as const;
export type AuthKind = (typeof AUTH_TYPES)[number];

export interface TaskRequest {
  id?: string;
  mode: TaskMode;
  text?: string;
  imageBase64?: string;
  mimeType?: string;
  targetLang?: string;
  sourceLang?: string;
}

export interface HealthResponse {
  ok: boolean;
  model?: string;
  provider?: string;
  vision?: boolean;
  error?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  authTypes: AuthKind[];
  configured: boolean;
  source?: string;
  loginLabel?: string;
}

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  vision: boolean;
}

export interface ModelsResponse {
  current?: string;
  models: ModelInfo[];
}

export interface LoginPromptPayload {
  id: string;
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: { id: string; label: string; description?: string }[];
}

export function isTaskMode(value: unknown): value is TaskMode {
  return (
    typeof value === "string" &&
    (TASK_MODES as readonly string[]).includes(value)
  );
}

export function isAuthKind(value: unknown): value is AuthKind {
  return (
    typeof value === "string" &&
    (AUTH_TYPES as readonly string[]).includes(value)
  );
}

export function parseTask(raw: string): TaskRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("无效 JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("无效 JSON");
  const body = parsed as Record<string, unknown>;
  if (!isTaskMode(body.mode)) throw new Error("无效 mode");
  return {
    id: typeof body.id === "string" ? body.id : undefined,
    mode: body.mode,
    text: typeof body.text === "string" ? body.text : undefined,
    imageBase64:
      typeof body.imageBase64 === "string" ? body.imageBase64 : undefined,
    mimeType: typeof body.mimeType === "string" ? body.mimeType : undefined,
    targetLang: typeof body.targetLang === "string" ? body.targetLang : "zh",
    sourceLang:
      typeof body.sourceLang === "string" ? body.sourceLang : undefined,
  };
}
