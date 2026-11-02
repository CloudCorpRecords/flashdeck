/**
 * flashdeck types. Shared inputs/outputs and the injectable fetch shape.
 */

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok?: boolean;
  status?: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

export interface AnkiEnvelope {
  result: unknown;
  error: string | null;
}

export interface ClientOptions {
  fetchFn?: FetchFn;
  url?: string;
}

export interface CardInfo {
  cardId?: number;
  [key: string]: unknown;
}
