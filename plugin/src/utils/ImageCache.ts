import { normalizePath, requestUrl } from "obsidian";
import type ChronoVaultPlugin from "../../main";
import { fitWidth, pngSize } from "./imageSize";

/** The folder in the plugin folder ("Card image folder": plugin folder). */
const CACHE_DIR = "image-cache";
/** The folder in the vault's attachment folder ("Card image folder": attachments folder). */
const VAULT_DIR = "ChronoVault";
const MAX_PARALLEL_DOWNLOADS = 6;
/** "Download all" leaves the other download slots to the images on screen. */
const DOWNLOAD_ALL_PARALLEL = 4;
/** Cached copies are shrunk to this width (official renders are 1640px wide, ~1.3 MB each). */
export const CACHED_IMAGE_WIDTH = 400;
/** Rough sizes for the "download all" estimate: an official render, and its cached copy. */
export const ORIGINAL_IMAGE_KB = 1300;
export const CACHED_IMAGE_KB = 35;
const WEBP_QUALITY = 0.85;
/**
 * Formats saved images can have: WebP where the engine can encode it, PNG
 * otherwise (iOS). Every device shows both, so a device uses an image another
 * one saved in its format; WebP first, it's the smaller one (about 8× here).
 * A device that can encode WebP converts the PNGs it finds.
 */
const FORMATS = ["webp", "png"];
/** Start loading an image this far before it scrolls into view. */
const PRELOAD_MARGIN = "400px";

export interface DownloadProgress {
	done: number;
	total: number;
	failed: number;
	running: boolean;
	cancelled: boolean;
}

/**
 * Keeps a shrunk copy of every card image (in the attachment folder or the
 * plugin folder, see the "Card image folder" setting), so each image is
 * downloaded once and cards still show offline. An image that isn't cached
 * yet is downloaded (when it comes near the viewport) and then shown from disk,
 * so it is never fetched twice.
 */
export class ImageCache {
	private plugin: ChronoVaultPlugin | null = null;
	/** The folder the images are saved in, once {@link relocate} has run. */
	private folder: string | null = null;
	private ready: Promise<void> = Promise.resolve();
	/** File names in the cache folder: read once, then kept up to date. */
	private onDisk = new Set<string>();
	private index: Promise<void> | null = null;
	/** Bumped by {@link clear} so work started before it is dropped. */
	private generation = 0;
	/**
	 * One resource URL per cached file. Desktop Obsidian adds `?<Date.now()>` to
	 * paths outside the vault index, so asking again for every render would miss
	 * the browser's image cache and read and decode the file again each time.
	 */
	private urls = new Map<string, string>();
	private failed = new Set<string>();
	private pending = new Map<string, Promise<string | null>>();
	private queue: Array<() => void> = [];
	private running = 0;
	private encoding: { type: string; ext: string } | null = null;
	private observers = new Map<Window, IntersectionObserver>();
	/** Original URL of each cached file, to point the images on screen elsewhere when the cache is cleared. */
	private sources = new Map<string, string>();
	/** Windows images were shown in (main window and popouts). */
	private windows = new Set<Window>();
	private onVisible = new WeakMap<Element, () => void>();
	private job: { progress: DownloadProgress; controller: AbortController } | null = null;
	private downloadListeners = new Set<(p: DownloadProgress) => void>();

	init(plugin: ChronoVaultPlugin): void {
		this.plugin = plugin;
		this.reset();
		this.ready = this.relocate();
		void this.loadIndex();
	}

	/**
	 * Use the folder the settings say, moving the saved images there when it
	 * changed: the "Card image folder" setting, the vault's attachment folder,
	 * or images saved in the plugin folder before that setting existed.
	 */
	relocate(): Promise<void> {
		this.ready = this.ready.then(() => this.move()).catch(() => {});
		return this.ready;
	}

	/** Point `img` at the cached copy of `url`, downloading it first when needed. */
	setSrc(img: HTMLImageElement, url: string): void {
		const plugin = this.plugin;
		if (!plugin || !plugin.settings.cacheImages || !url.startsWith("https://") || this.failed.has(url)) {
			img.src = url;
			return;
		}
		const name = this.savedName(url) ?? this.fileName(url);
		this.sources.set(name, url);
		this.track(img.win);
		if (this.onDisk.has(name)) {
			img.src = this.resourceUrl(name);
			return;
		}
		img.addClass("is-loading");
		this.whenVisible(img, () => {
			void this.fetch(url).then((saved) => {
				img.removeClass("is-loading");
				img.src = saved ? this.resourceUrl(saved) : url;
			});
		});
	}

	/** Stop waiting for the images in `container` to scroll into view (it is about to be emptied). */
	forget(container: HTMLElement): void {
		const observer = this.observers.get(container.win);
		container.querySelectorAll("img.is-loading").forEach((img) => {
			if (this.onVisible.delete(img)) observer?.unobserve(img);
		});
	}

	/** How many of `urls` are saved. */
	async savedCount(urls: string[]): Promise<number> {
		await this.loadIndex();
		return new Set(urls.filter((u) => this.savedName(u))).size;
	}

	/** Progress of the running (or last) {@link downloadAll}. */
	get downloadProgress(): DownloadProgress | null {
		return this.job ? { ...this.job.progress } : null;
	}

	/** Get told about {@link downloadAll} progress. Returns the unsubscribe function. */
	onDownloadProgress(listener: (p: DownloadProgress) => void): () => void {
		this.downloadListeners.add(listener);
		return () => this.downloadListeners.delete(listener);
	}

	/** Download and shrink every image in `urls` that isn't saved yet, a few at a time. */
	async downloadAll(urls: string[]): Promise<DownloadProgress> {
		if (this.job?.progress.running) return { ...this.job.progress };
		await this.loadIndex();
		const todo = Array.from(new Set(urls)).filter((u) => u.startsWith("https://") && !this.savedName(u));
		const job = { progress: { done: 0, total: todo.length, failed: 0, running: true, cancelled: false }, controller: new AbortController() };
		this.job = job;
		const emit = () => this.downloadListeners.forEach((l) => l({ ...job.progress }));
		emit();
		const generation = this.generation;
		const stopped = () => job.controller.signal.aborted || generation !== this.generation;
		const worker = async () => {
			for (let url = todo.shift(); url && !stopped(); url = todo.shift()) {
				if (!(await this.fetch(url))) job.progress.failed++;
				job.progress.done++;
				emit();
			}
		};
		await Promise.all(Array.from({ length: DOWNLOAD_ALL_PARALLEL }, worker));
		job.progress.running = false;
		job.progress.cancelled = stopped();
		emit();
		return { ...job.progress };
	}

	/** Stop {@link downloadAll} after the images being downloaded right now. */
	cancelDownload(): void {
		this.job?.controller.abort();
	}

	async stats(): Promise<{ files: number; bytes: number }> {
		await this.ready;
		const adapter = this.plugin?.app.vault.adapter;
		const dir = this.dir();
		if (!adapter || !dir || !(await adapter.exists(dir))) return { files: 0, bytes: 0 };
		const { files } = await adapter.list(dir);
		let bytes = 0;
		for (const f of files) bytes += (await adapter.stat(f))?.size ?? 0;
		return { files: files.length, bytes };
	}

	async clear(): Promise<void> {
		await this.ready;
		this.generation++;
		const adapter = this.plugin?.app.vault.adapter;
		const dir = this.dir();
		if (adapter && dir && (await adapter.exists(dir))) await adapter.rmdir(dir, true);
		const shown = this.shown();
		this.reset();
		this.index = Promise.resolve();
		// Images on screen point at files that are gone: load them again (downloaded again, or the original when saving is off).
		this.reload(shown);
	}

	/** Stop all work: called when the plugin unloads. */
	destroy(): void {
		this.cancelDownload();
		this.generation++;
		for (const observer of this.observers.values()) observer.disconnect();
		this.observers.clear();
		this.onVisible = new WeakMap();
		this.windows.clear();
		this.downloadListeners.clear();
		this.reset();
		// Downloads still queued find no plugin and return right away.
		this.plugin = null;
	}

	/** Downloads are allowed: not with the "Bundled" (offline) data source. */
	get online(): boolean {
		return this.plugin?.settings.dataSource !== "bundled";
	}

	/** The images on screen that show a saved file: resource URL → original URL. */
	private shown(): Map<string, string> {
		const shown = new Map<string, string>();
		for (const [name, resource] of this.urls) {
			const url = this.sources.get(name);
			if (url) shown.set(resource, url);
		}
		return shown;
	}

	private reload(shown: Map<string, string>): void {
		for (const win of this.windows) {
			win.document.querySelectorAll("img").forEach((img) => {
				const url = shown.get(img.getAttribute("src") ?? "");
				if (url) this.setSrc(img, url);
			});
		}
	}

	private async move(): Promise<void> {
		const plugin = this.plugin;
		if (!plugin) return;
		const to = this.targetDir(plugin);
		// Before the setting existed, images were always in the plugin folder.
		const from = plugin.settings.imageCacheDir || this.pluginDir(plugin);
		if (from !== to) {
			// Downloads still writing to the old folder are dropped; images keep showing from it until the move is done.
			this.generation++;
			await this.moveFiles(from, to);
			const shown = this.shown();
			this.folder = to;
			this.reset();
			this.reload(shown);
		} else this.folder = to;
		if (plugin.settings.imageCacheDir !== to) {
			plugin.settings.imageCacheDir = to;
			await plugin.saveSettings();
		}
	}

	/** Move the files of `from` into `to` (a file already there wins), then remove `from`. */
	private async moveFiles(from: string, to: string): Promise<void> {
		const adapter = this.plugin?.app.vault.adapter;
		if (!adapter || !(await adapter.exists(from))) return;
		const { files } = await adapter.list(from);
		if (files.length && !(await adapter.exists(to))) await adapter.mkdir(to);
		for (const file of files) {
			const target = `${to}/${file.slice(file.lastIndexOf("/") + 1)}`;
			try {
				if (await adapter.exists(target)) await adapter.remove(file);
				else await adapter.rename(file, target);
			} catch {
				// Left behind: downloaded again when it's needed.
			}
		}
		await adapter.rmdir(from, true).catch(() => {});
	}

	private pluginDir(p: ChronoVaultPlugin): string {
		const base = p.manifest.dir ?? `${p.app.vault.configDir}/plugins/${p.manifest.id}`;
		return `${base}/${CACHE_DIR}`;
	}

	private targetDir(p: ChronoVaultPlugin): string {
		if (p.settings.imageFolder === "plugin") return this.pluginDir(p);
		const parent = attachmentFolder(p);
		return normalizePath(parent ? `${parent}/${VAULT_DIR}` : VAULT_DIR);
	}

	private track(win: Window | undefined): void {
		if (!win || this.windows.has(win)) return;
		this.windows.add(win);
		// A closed popout window: forget it and its observer.
		win.addEventListener(
			"unload",
			() => {
				this.windows.delete(win);
				this.observers.get(win)?.disconnect();
				this.observers.delete(win);
			},
			{ once: true },
		);
	}

	private reset(): void {
		this.onDisk.clear();
		this.urls.clear();
		this.sources.clear();
		this.failed.clear();
		this.index = null;
	}

	private loadIndex(): Promise<void> {
		return (this.index ??= this.ready.then(() => this.readIndex()));
	}

	private async readIndex(): Promise<void> {
		const adapter = this.plugin?.app.vault.adapter;
		const dir = this.dir();
		if (!adapter || !dir) return;
		const generation = this.generation;
		try {
			if (!(await adapter.exists(dir))) return;
			const { files } = await adapter.list(dir);
			if (generation !== this.generation) return;
			for (const f of files) this.onDisk.add(f.slice(f.lastIndexOf("/") + 1));
			await this.dropDuplicates(dir);
			// In the background: the images show from the PNGs meanwhile.
			void this.convertToWebp(dir, generation);
		} catch {
			// Each image is checked again before it is downloaded.
		}
	}

	private dir(): string | null {
		return this.plugin ? this.folder : null;
	}

	/** One flat file per URL, e.g. `cdn.playchrono.com_latest_en_us_img_cards_full_set_1_3-w400.webp`, in this device's format. */
	private fileName(url: string): string {
		return `${this.baseName(url)}.${this.format().ext}`;
	}

	private baseName(url: string): string {
		const u = new URL(url);
		const name = `${u.hostname}${u.pathname.replace(/\.[a-z0-9]+$/i, "")}`.replace(/[^a-z0-9.-]+/gi, "_").slice(-140);
		return `${name}-w${CACHED_IMAGE_WIDTH}`;
	}

	/** The saved file of `url` in any format (see FORMATS), or null. */
	private savedName(url: string): string | null {
		const base = this.baseName(url);
		for (const ext of FORMATS) if (this.onDisk.has(`${base}.${ext}`)) return `${base}.${ext}`;
		return null;
	}

	/** Re-encode the PNGs (saved by iOS) as WebP, when this device can, and delete them. */
	private async convertToWebp(dir: string, generation: number): Promise<void> {
		const adapter = this.plugin?.app.vault.adapter;
		if (!adapter || this.format().ext !== "webp") return;
		const pngs = Array.from(this.onDisk).filter((n) => n.endsWith(".png"));
		for (const png of pngs) {
			if (generation !== this.generation) return;
			const webp = `${png.slice(0, -".png".length)}.webp`;
			try {
				const data = await this.limit(async () => this.shrink(await adapter.readBinary(`${dir}/${png}`), "image/png"));
				if (generation !== this.generation) return;
				await adapter.writeBinary(`${dir}/${webp}`, data);
				this.onDisk.add(webp);
				await adapter.remove(`${dir}/${png}`);
				this.onDisk.delete(png);
			} catch {
				// Kept as PNG: it still shows.
			}
		}
	}

	/** An image saved in both formats (by two devices) keeps only the first of FORMATS. */
	private async dropDuplicates(dir: string): Promise<void> {
		const adapter = this.plugin?.app.vault.adapter;
		if (!adapter) return;
		for (const name of Array.from(this.onDisk)) {
			const dot = name.lastIndexOf(".");
			const ext = name.slice(dot + 1);
			const keep = FORMATS.find((f) => this.onDisk.has(`${name.slice(0, dot)}.${f}`));
			if (!keep || keep === ext || !FORMATS.includes(ext)) continue;
			try {
				await adapter.remove(`${dir}/${name}`);
				this.onDisk.delete(name);
			} catch {
				// Kept: it's only used when the other one is gone.
			}
		}
	}

	private resourceUrl(name: string): string {
		let url = this.urls.get(name);
		if (!url) {
			url = this.plugin?.app.vault.adapter.getResourcePath(`${this.dir()}/${name}`) ?? "";
			this.urls.set(name, url);
		}
		return url;
	}

	/** Run `load` once `img` is near the viewport of its window. */
	private whenVisible(img: HTMLImageElement, load: () => void): void {
		// Each window has its own constructor; an observer only sees its own window's elements.
		const win = img.win as (Window & { IntersectionObserver?: typeof IntersectionObserver }) | undefined;
		if (!win?.IntersectionObserver) return load();
		let observer = this.observers.get(win);
		if (!observer) {
			observer = new win.IntersectionObserver(
				(entries, obs) => {
					for (const entry of entries) {
						if (!entry.isIntersecting) continue;
						obs.unobserve(entry.target);
						const run = this.onVisible.get(entry.target);
						this.onVisible.delete(entry.target);
						run?.();
					}
				},
				{ rootMargin: PRELOAD_MARGIN },
			);
			this.observers.set(win, observer);
		}
		this.onVisible.set(img, load);
		observer.observe(img);
	}

	/** WebP where the engine can encode it; PNG otherwise (Safari/iOS can't encode WebP). */
	private format(): { type: string; ext: string } {
		if (!this.encoding) {
			const canvas = createEl("canvas");
			canvas.width = canvas.height = 1;
			const webp = canvas.toDataURL("image/webp").startsWith("data:image/webp");
			this.encoding = webp ? { type: "image/webp", ext: "webp" } : { type: "image/png", ext: "png" };
		}
		return this.encoding;
	}

	private fetch(url: string): Promise<string | null> {
		let p = this.pending.get(url);
		if (!p) {
			p = this.locate(url).finally(() => this.pending.delete(url));
			this.pending.set(url, p);
		}
		return p;
	}

	/** File name of the cached copy, downloading it when it isn't on disk. */
	private async locate(url: string): Promise<string | null> {
		await this.loadIndex();
		return this.savedName(url) ?? this.limit(() => this.download(url));
	}

	private async download(url: string): Promise<string | null> {
		const adapter = this.plugin?.app.vault.adapter;
		const dir = this.dir();
		if (!adapter || !dir) return null;
		const name = this.fileName(url);
		const path = `${dir}/${name}`;
		// A download that was still running when the cache was cleared must not write into it again.
		const generation = this.generation;
		const cleared = () => generation !== this.generation;
		try {
			if (!(await adapter.exists(path))) {
				const res = await requestUrl({ url, throw: false });
				const type = (res.headers["content-type"] ?? res.headers["Content-Type"] ?? "").toLowerCase();
				if (res.status < 200 || res.status >= 300 || !type.startsWith("image/")) {
					this.failed.add(url);
					return null;
				}
				const data = await this.shrink(res.arrayBuffer, type);
				if (cleared()) return null;
				if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
				await adapter.writeBinary(path, data);
				if (cleared()) {
					await adapter.remove(path).catch(() => {});
					return null;
				}
			}
			if (cleared()) return null;
			this.onDisk.add(name);
			return name;
		} catch {
			if (!cleared()) this.failed.add(url);
			return null;
		}
	}

	/** Re-encode an image at {@link CACHED_IMAGE_WIDTH}px wide (never upscaled). */
	private async shrink(data: ArrayBuffer, type: string): Promise<ArrayBuffer> {
		const blob = new Blob([data], { type });
		const source = pngSize(new Uint8Array(data));
		const target = source ? fitWidth(source.width, source.height, CACHED_IMAGE_WIDTH) : null;
		// With resize options the engine decodes and scales off the main thread.
		const bitmap =
			source && target && target.width < source.width
				? await createImageBitmap(blob, { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: "high" })
				: await createImageBitmap(blob);
		try {
			const { width: w, height: h } = fitWidth(bitmap.width, bitmap.height, CACHED_IMAGE_WIDTH);
			// Not a PNG, or the engine ignored the resize options: scale on a canvas.
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
			const encoded = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, outType, WEBP_QUALITY));
			if (!encoded) throw new Error("image encoding failed");
			return await encoded.arrayBuffer();
		} finally {
			bitmap.close();
		}
	}

	private draw(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
		const canvas = createEl("canvas");
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

/**
 * The vault's attachment folder ("Files and links" → "Default location for new
 * attachments"), "" for the vault root. "Same folder as current file" and
 * "In subfolder under current folder" are taken from the notes folder: images
 * aren't attached to one note.
 */
function attachmentFolder(p: ChronoVaultPlugin): string {
	// Not in the API's types, but every desktop and mobile version has it.
	const setting = (p.app.vault as unknown as { getConfig?: (key: string) => unknown }).getConfig?.("attachmentFolderPath");
	const value = typeof setting === "string" ? setting.trim() : "";
	if (value.startsWith("./")) {
		return [p.settings.notesFolder.trim(), value.slice(2).trim()].filter(Boolean).join("/");
	}
	return value === "/" ? "" : value.replace(/^\/+|\/+$/g, "");
}

export const imageCache = new ImageCache();
