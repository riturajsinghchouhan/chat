// GIPHY proxy: keeps the API key on the server. Attribution ("Powered by GIPHY") is shown in the picker.
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

const API = 'https://api.giphy.com/v1/gifs';
const PAGE = 24;
const cache = new Map(); // key -> { at, data }
const CACHE_MS = 60 * 1000;

export const schemas = {
  trending: z.object({ offset: z.coerce.number().int().min(0).max(4999).default(0) }),
  search: z.object({
    q: z.string().trim().min(1).max(50),
    offset: z.coerce.number().int().min(0).max(4999).default(0),
  }),
};

function mapGif(g) {
  const img = g.images || {};
  const full = img.downsized_medium?.url ? img.downsized_medium : img.original || img.fixed_height;
  const preview = img.fixed_width_downsampled?.url ? img.fixed_width_downsampled : img.fixed_width || full;
  return {
    providerId: g.id,
    title: (g.title || 'GIF').slice(0, 200),
    url: full?.url,
    previewUrl: preview?.url,
    width: Number(full?.width) || undefined,
    height: Number(full?.height) || undefined,
  };
}

async function fetchGiphy(path, params) {
  if (!env.GIPHY_API_KEY) throw new AppError(503, 'GIF search is not configured on this server', 'GIF_NOT_CONFIGURED');
  const qs = new URLSearchParams({ api_key: env.GIPHY_API_KEY, limit: String(PAGE), rating: 'pg-13', ...params });
  const key = `${path}?${new URLSearchParams(params)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  let response;
  try {
    response = await fetch(`${API}/${path}?${qs}`, { signal: AbortSignal.timeout(8000) });
  } catch (err) {
    logger.error('GIPHY unreachable', { err: err.message });
    throw new AppError(502, 'GIF service is unreachable', 'GIF_UPSTREAM');
  }
  if (response.status === 429) {
    logger.warn('GIPHY rate limit reached');
    throw new AppError(429, 'GIF rate limit reached, try again shortly', 'GIF_RATE_LIMIT');
  }
  if (!response.ok) {
    logger.error('GIPHY error response', { status: response.status });
    throw new AppError(502, 'GIF service error', 'GIF_UPSTREAM');
  }
  const json = await response.json();
  const data = {
    gifs: (json.data || []).map(mapGif).filter((g) => g.url),
    nextOffset: (json.pagination?.offset || 0) + (json.pagination?.count || 0),
    hasMore: (json.pagination?.offset || 0) + (json.pagination?.count || 0) < (json.pagination?.total_count || 0),
  };
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

export async function trending(req, res) {
  res.json(await fetchGiphy('trending', { offset: String(req.q.offset) }));
}

export async function search(req, res) {
  res.json(await fetchGiphy('search', { q: req.q.q, offset: String(req.q.offset) }));
}
