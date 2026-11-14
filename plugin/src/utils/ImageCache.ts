import { requestUrl } from "obsidian";
import type ChronoCCGPlugin from "../../main";

const CACHE_DIR = "image-cache";
const MAX_PARALLEL_DOWNLOADS = 6;
/** Cached copies are shrunk to this width (official renders are 1640px wide, ~1.3 MB each). */
export const CACHED_IMAGE_WIDTH = 400;
const WEBP_QUALITY = 0.85;

/**
 * Keeps a shrunk copy of every card image in the plugin folder, so each image is
 * downloaded once and cards still show offline. An image that isn't cached
 * yet is downloaded first and then shown from disk, so it is never fetched twice.
 */
export class ImageCache {
	private plugin: ChronoCCGPlugin | null = null;
	private cached = new Set<string>();
	private failed = new Set<string>();
	private pending = new Map<string, Promise<string | null>>();
	private queue: Array<() => void> = [];
	private running = 0;
	private encoding: { type: string; ext: string } | null = null;

	init(plugin: ChronoCCGPlugin): void {
		this.plugin = plugin;
		this.cached.clear();
		this.failed.clear();
	}

	/** Point `img` at the cached copy of `url`, downloading it first when needed. */
	setSrc(img: HTMLImageElement, url: string): void {
		const plugin = this.plugin;
		if (!plugin || !plugin.settings.cacheImages || !url.startsWith("https://") || this.failed.has(url)) {
			img.src = url;
			return;
		}
		const path = this.pathFor(url);
		if (this.cached.has(path)) {
			img.src = plugin.app.vault.adapter.getResourcePath(path);
			return;
		}
		img.addClass("is-loading");
		void this.fetch(url).then((saved) => {
			img.removeClass("is-loading");
			img.src = saved ? plugin.app.vault.adapter.getResourcePath(saved) : url;
		});
	}

	async stats(): Promise<{ files: number; bytes: number }> {
		const adapter = this.plugin?.app.vault.adapter;
		const dir = this.dir();
		if (!adapter || !dir || !(await adapter.exists(dir))) return { files: 0, bytes: 0 };
		const { files } = await adapter.list(dir);
		let bytes = 0;
		for (const f of files) bytes += (await adapter.stat(f))?.size ?? 0;
		return { files: files.length, bytes };
	}

	async clear(): Promise<void> {
		const adapter = this.plugin?.app.vault.adapter;
		const dir = this.dir();
		if (adapter && dir && (await adapter.exists(dir))) await adapter.rmdir(dir, true);
		this.cached.clear();
		this.failed.clear();
	}

	private dir(): string | null {
		const p = this.plugin;
		if (!p) return null;
		const base = p.manifest.dir ?? `${p.app.vault.configDir}/plugins/${p.manifest.id}`;
		return `${base}/${CACHE_DIR}`;
	}

	/** One flat file per URL, e.g. `cdn.playchrono.com_latest_en_us_img_cards_full_set_1_3-w400.webp`. */
	private pathFor(url: string): string {
		const u = new URL(url);
		const name = `${u.hostname}${u.pathname.replace(/\.[a-z0-9]+$/i, "")}`.replace(/[^a-z0-9.-]+/gi, "_").slice(-140);
		return `${this.dir()}/${name}-w${CACHED_IMAGE_WIDTH}.${this.format().ext}`;
	}

	/** WebP where the engine can encode it; PNG otherwise (Safari/iOS can't encode WebP). */
	private format(): { type: string; ext: string } {
		if (!this.encoding) {
			const canvas = activeDocument.createElement("canvas");
			canvas.width = canvas.height = 1;
			const webp = canvas.toDataURL("image/webp").startsWith("data:image/webp");
			this.encoding = webp ? { type: "image/webp", ext: "webp" } : { type: "image/png", ext: "png" };
		}
		return this.encoding;
	}

	private fetch(url: string): Promise<string | null> {
		let p = this.pending.get(url);
		if (!p) {
			p = this.limit(() => this.download(url)).finally(() => this.pending.delete(url));
			this.pending.set(url, p);
		}
		return p;
	}

	private async download(url: string): Promise<string | null> {
		const adapter = this.plugin?.app.vault.adapter;
		const dir = this.dir();
		if (!adapter || !dir) return null;
		const path = this.pathFor(url);
		try {
			if (!(await adapter.exists(path))) {
				const res = await requestUrl({ url, throw: false });
				const type = (res.headers["content-type"] ?? res.headers["Content-Type"] ?? "").toLowerCase();
				if (res.status < 200 || res.status >= 300 || !type.startsWith("image/")) {
					this.failed.add(url);
					return null;
				}
				if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
				await adapter.writeBinary(path, await this.shrink(res.arrayBuffer, type));
			}
			this.cached.add(path);
			return path;
		} catch {
			this.failed.add(url);
			return null;
		}
	}

	/** Re-encode an image at {@link CACHED_IMAGE_WIDTH}px wide (never upscaled). */
	private async shrink(data: ArrayBuffer, type: string): Promise<ArrayBuffer> {
		const bitmap = await createImageBitmap(new Blob([data], { type }));
		try {
			const scale = Math.min(1, CACHED_IMAGE_WIDTH / bitmap.width);
			const w = Math.max(1, Math.round(bitmap.width * scale));
			const h = Math.max(1, Math.round(bitmap.height * scale));
			// Halve first: a single large downscale step aliases in some engines.
			let src: CanvasImageSource = bitmap;
			let sw = bitmap.width;
			let sh = bitmap.height;
			while (sw / 2 >= w) {
				sw = Math.round(sw / 2);
				sh = Math.round(sh / 2);
				src = this.draw(src, sw, sh);
			}
			const out = this.draw(src, w, h);
			const { type: outType } = this.format();
			const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, outType, WEBP_QUALITY));
			if (!blob) throw new Error("image encoding failed");
			return await blob.arrayBuffer();
		} finally {
			bitmap.close();
		}
	}

	private draw(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
		const canvas = activeDocument.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("canvas unavailable");
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(src, 0, 0, w, h);
		return canvas;
	}

	private limit<T>(task: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const run = () => {
				this.running++;
				task()
					.then(resolve, reject)
					.finally(() => {
						this.running--;
						this.queue.shift()?.();
					});
			};
			if (this.running < MAX_PARALLEL_DOWNLOADS) run();
			else this.queue.push(run);
		});
	}
}

export const imageCache = new ImageCache();
