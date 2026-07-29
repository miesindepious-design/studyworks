/**
 * AI provider + model settings stored in IndexedDB.
 *
 * Keys:
 *   ai-provider  — 'gemini' | 'openai'
 *   ai-api-key   — API key for the selected provider
 *   ai-model     — model id string
 *   ai-enabled   — '1' when enabled
 */

import { settingsDB } from './helpers';

export type AIProvider = 'gemini' | 'openai';

export const PROVIDERS: { id: AIProvider; label: string; getKeyUrl: string; free: string }[] = [
  {
    id:        'gemini',
    label:     'Google Gemini',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    free:      'Free tier: 15 req/min · 1M tokens/day · no card required',
  },
  {
    id:        'openai',
    label:     'OpenAI',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    free:      'Pay-as-you-go — ~$0.00015/1K tokens on GPT-4o Mini',
  },
];

export const MODELS_BY_PROVIDER: Record<AIProvider, { id: string; label: string }[]> = {
  gemini: [
    { id: 'gemini-1.5-flash',   label: 'Gemini 1.5 Flash (free, fast)' },
    { id: 'gemini-1.5-pro',     label: 'Gemini 1.5 Pro (free, best)'   },
    { id: 'gemini-2.0-flash',   label: 'Gemini 2.0 Flash (free, fast)' },
  ],
  openai: [
    { id: 'gpt-4o-mini',     label: 'GPT-4o Mini (cheap)'  },
    { id: 'gpt-4o',          label: 'GPT-4o (best)'        },
    { id: 'gpt-3.5-turbo',   label: 'GPT-3.5 Turbo'       },
  ],
};

export interface AIConfig {
  provider: AIProvider;
  apiKey:   string;
  model:    string;
  enabled:  boolean;
  customSummaryPrompt?:   string;
  customFlashcardPrompt?: string;
  customQAPrompt?:        string;
}

export const DEFAULT_PROMPTS = {
  summary:   'Summarise the following note in 3-5 concise bullet points.\nStart each bullet with "• ". Keep each bullet under 20 words.',
  flashcard: 'Create exactly {{count}} flashcards from the note below.\nReturn a JSON object with a "flashcards" array. Each item has "question" and "answer" strings.\nKeep questions specific and answers concise (1–3 sentences max).',
  qa:        'Answer the user\'s question strictly based on the provided notes.\nIf the answer isn\'t in the notes, say so briefly. Cite note titles when referencing them.',
};

export async function getAIConfig(): Promise<AIConfig> {
  const [provider, apiKey, model, enabled, summaryP, flashcardP, qaP] = await Promise.all([
    settingsDB.get('ai-provider'),
    settingsDB.get('ai-api-key'),
    settingsDB.get('ai-model'),
    settingsDB.get('ai-enabled'),
    settingsDB.get('ai-prompt-summary'),
    settingsDB.get('ai-prompt-flashcard'),
    settingsDB.get('ai-prompt-qa'),
  ]);
  const prov = (provider || 'gemini') as AIProvider;
  const defaultModel = MODELS_BY_PROVIDER[prov][0].id;
  return {
    provider: prov,
    apiKey:   apiKey   || '',
    model:    model    || defaultModel,
    enabled:  enabled === '1',
    customSummaryPrompt:   summaryP   || undefined,
    customFlashcardPrompt: flashcardP || undefined,
    customQAPrompt:        qaP        || undefined,
  };
}

export async function saveAIConfig(config: Partial<AIConfig>): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (config.provider !== undefined) tasks.push(settingsDB.set('ai-provider', config.provider));
  if (config.apiKey   !== undefined) tasks.push(settingsDB.set('ai-api-key',  config.apiKey));
  if (config.model    !== undefined) tasks.push(settingsDB.set('ai-model',    config.model));
  if (config.enabled  !== undefined) tasks.push(settingsDB.set('ai-enabled',  config.enabled ? '1' : '0'));
  if (config.customSummaryPrompt   !== undefined) tasks.push(settingsDB.set('ai-prompt-summary',   config.customSummaryPrompt));
  if (config.customFlashcardPrompt !== undefined) tasks.push(settingsDB.set('ai-prompt-flashcard', config.customFlashcardPrompt));
  if (config.customQAPrompt        !== undefined) tasks.push(settingsDB.set('ai-prompt-qa',        config.customQAPrompt));
  await Promise.all(tasks);
}
