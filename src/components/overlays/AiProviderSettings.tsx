import { useCallback } from "react";
import type { FC } from "react";
import type { Settings } from "../../types/browser";
import { Section, Field, Select, TextInput } from "./SettingsPanel.parts";

/**
 * Provider / model / credential controls for the bundled Pi agent. Split
 * out of SettingsPanel to keep that component under the 200-line cap
 * (AGENTS.md §3.4). Writes flow through the parent's `update` so the
 * single settings:set path (and Pi-respawn side effect) is preserved.
 */

/** Built-in Pi providers (provider id = auth.json key). See providers.md. */
const PROVIDERS: ReadonlyArray<readonly [string, string]> = [
  ["anthropic", "Anthropic (Claude)"],
  ["openai", "OpenAI"],
  ["google", "Google Gemini"],
  ["deepseek", "DeepSeek"],
  ["groq", "Groq"],
  ["mistral", "Mistral"],
  ["xai", "xAI (Grok)"],
  ["openrouter", "OpenRouter"],
  ["cerebras", "Cerebras"],
  ["together", "Together AI"],
  ["fireworks", "Fireworks"],
];

interface Props {
  settings: Partial<Settings> | null;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export const AiProviderSettings: FC<Props> = ({ settings, update }) => {
  const provider = settings?.aiProvider ?? "anthropic";
  const apiKeys = settings?.aiApiKeys ?? {};
  const models = settings?.aiModels ?? {};
  const baseUrls = settings?.aiBaseUrls ?? {};
  const onProvider = useCallback(
    (v: string) => update("aiProvider", v),
    [update],
  );
  // Model, key, and base URL are all provider-scoped — write into the
  // active provider's slot so switching providers never carries one
  // provider's model/endpoint/secret over to another.
  const onModel = useCallback(
    (v: string) => update("aiModels", { ...models, [provider]: v }),
    [update, models, provider],
  );
  const onApiKey = useCallback(
    (v: string) => update("aiApiKeys", { ...apiKeys, [provider]: v }),
    [update, apiKeys, provider],
  );
  const onBaseUrl = useCallback(
    (v: string) => update("aiBaseUrls", { ...baseUrls, [provider]: v }),
    [update, baseUrls, provider],
  );

  return (
    <Section title="AI Provider">
      <Field label="Provider">
        <Select value={provider} onChange={onProvider} options={PROVIDERS} />
      </Field>
      <Field label="Model">
        <TextInput
          value={models[provider] ?? ""}
          onChange={onModel}
          placeholder="provider default"
        />
      </Field>
      <Field label="API key">
        <TextInput
          value={apiKeys[provider] ?? ""}
          onChange={onApiKey}
          placeholder="sk-…"
          type="password"
        />
      </Field>
      <Field label="Base URL (optional)">
        <TextInput
          value={baseUrls[provider] ?? ""}
          onChange={onBaseUrl}
          placeholder="https://api.example.com/v1"
        />
      </Field>
    </Section>
  );
};
