import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Logger } from "../core/logger.js";
import type { SceneSpec, Storyboard } from "../director/storyboardSchema.js";

/** Fetch options for enriching scenes with free stock B-roll backgrounds. */
export interface FetchBrollOptions {
  readonly storyboard: Storyboard;
  readonly mediaDir: string;
  readonly fetchImpl?: typeof fetch;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: Logger;
}

/** Enrich scenes that specify brollQuery with free stock image data URIs (offline-safe). */
export async function enrichStoryboardWithBroll(options: FetchBrollOptions): Promise<Storyboard> {
  const fetchFn = options.fetchImpl ?? fetch;
  const env = options.env ?? process.env;
  await mkdir(options.mediaDir, { recursive: true });

  const updatedScenes: SceneSpec[] = [];
  for (const scene of options.storyboard.scenes) {
    if (!scene.brollQuery || scene.brollImageUrl || scene.archetype === "CodeWalkthrough") {
      updatedScenes.push(scene);
      continue;
    }

    try {
      const imageUrl = await resolveFreeStockImageUrl({
        query: scene.brollQuery,
        aspectRatio: options.storyboard.aspectRatio,
        fetchFn,
        env,
      });
      if (!imageUrl) {
        updatedScenes.push(scene);
        continue;
      }
      const dataUri = await downloadAsDataUri(imageUrl, fetchFn, join(options.mediaDir, `${scene.id}.jpg`));
      updatedScenes.push(dataUri ? { ...scene, brollImageUrl: dataUri } : scene);
    } catch (err) {
      options.logger?.debug("B-roll fetch skipped for scene", {
        sceneId: scene.id,
        reason: err instanceof Error ? err.message : String(err),
      });
      updatedScenes.push(scene);
    }
  }

  return { ...options.storyboard, scenes: updatedScenes };
}

/** Query Pexels, Pixabay, or keyless Wikimedia Commons for a clean background image URL. */
async function resolveFreeStockImageUrl(params: {
  query: string;
  aspectRatio: Storyboard["aspectRatio"];
  fetchFn: typeof fetch;
  env: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
  if (params.env.PEXELS_API_KEY) {
    const pexels = await queryPexels(params.query, params.aspectRatio, params.env.PEXELS_API_KEY, params.fetchFn);
    if (pexels) {
      return pexels;
    }
  }
  if (params.env.PIXABAY_API_KEY) {
    const pixabay = await queryPixabay(params.query, params.env.PIXABAY_API_KEY, params.fetchFn);
    if (pixabay) {
      return pixabay;
    }
  }
  return queryWikimediaCommons(params.query, params.fetchFn);
}

/** Query Pexels free stock photo API. */
async function queryPexels(
  query: string,
  aspectRatio: Storyboard["aspectRatio"],
  apiKey: string,
  fetchFn: typeof fetch,
): Promise<string | undefined> {
  const orientation = aspectRatio === "9:16" ? "portrait" : aspectRatio === "1:1" ? "square" : "landscape";
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=${orientation}`;
  const res = await fetchFn(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    return undefined;
  }
  const data = (await res.json()) as { photos?: Array<{ src?: { large?: string } }> };
  return data.photos?.[0]?.src?.large;
}

/** Query Pixabay free stock photo API. */
async function queryPixabay(
  query: string,
  apiKey: string,
  fetchFn: typeof fetch,
): Promise<string | undefined> {
  const url = `https://pixabay.com/api/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&image_type=photo&per_page=3`;
  const res = await fetchFn(url);
  if (!res.ok) {
    return undefined;
  }
  const data = (await res.json()) as { hits?: Array<{ webformatURL?: string }> };
  return data.hits?.[0]?.webformatURL;
}

/** Query Wikimedia Commons API (no API key required) for an open-license visual. */
async function queryWikimediaCommons(
  query: string,
  fetchFn: typeof fetch,
): Promise<string | undefined> {
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&generator=search" +
    `&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=3&prop=imageinfo&iiprop=url|mime&iiurlwidth=1280&format=json`;
  const res = await fetchFn(url, { headers: { "User-Agent": "vidgen/0.1 (open-source)" } });
  if (!res.ok) {
    return undefined;
  }
  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        { title?: string; imageinfo?: Array<{ thumburl?: string; mime?: string }> }
      >;
    };
  };
  for (const page of Object.values(data.query?.pages ?? {})) {
    const title = page.title ?? "";
    if (/diagram|map|chart|schema|logo|icon|flag/i.test(title)) {
      continue;
    }
    const info = page.imageinfo?.[0];
    if (info?.thumburl && info.mime === "image/jpeg") {
      return info.thumburl;
    }
  }
  return undefined;
}

/** Download an image locally and convert to a base64 data URI for offline Playwright sandboxing. */
async function downloadAsDataUri(
  url: string,
  fetchFn: typeof fetch,
  localCachePath: string,
): Promise<string | undefined> {
  const res = await fetchFn(url);
  if (!res.ok) {
    return undefined;
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    return undefined;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 4_000_000) {
    return undefined;
  }
  await writeFile(localCachePath, bytes);
  return `data:${contentType.split(";")[0]};base64,${bytes.toString("base64")}`;
}
