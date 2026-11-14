import { Plugin, requestUrl } from "obsidian";
import { Card, CardDatabase, Syndicate, SYNDICATES } from "./types";
import { normalizeOfficial, OFFICIAL_CDN } from "./officialCards";
import { asOptionalText, asText } from "../utils/text";

export type DataSourceId = "bundled" | "official" | "custom";

export interface DataSourceConfig {
	id: DataSourceId;
	/** For "custom" — full URL returning JSON we can normalize. */
	url?: string;
}

const CACHE_FILE = "card-cache.json";

/** Safety stop for the set discovery loop (sets are numbered 1, 2, … until a 404). */
const MAX_OFFICIAL_SETS = 100;

/** Pulls card datasets from supported sources and normalizes card data. */
export class DataSync {
	constructor(private plugin: Plugin) {}

	async fetch(source: DataSourceConfig): Promise<CardDatabase> {
		switch (source.id) {
			case "official":
				return this.fetchOfficial();
			case "custom":
				if (!source.url) throw new Error("Custom data source requires a URL.");
				return this.fetchCustom(source.url);
			case "bundled":
			default:
				throw new Error("Bundled source is loaded directly, not via DataSync.fetch.");
		}
	}

	private async fetchOfficial(): Promise<CardDatabase> {
		const raw: unknown[] = [];
		for (let setId = 1; setId <= MAX_OFFICIAL_SETS; setId++) {
			const set = await this.requestJson(`${OFFICIAL_CDN}/en_us/data/set/${setId}/CardsInSet${setId}.json`, {
				allowNotFound: true,
			});
			if (set === null) break;
			if (Array.isArray(set)) raw.push(...(set as unknown[]));
		}
		return normalizeOfficial(raw);
	}

	private async fetchCustom(url: string): Promise<CardDatabase> {
		const raw = await this.requestJson(url);
		return this.normalize(raw, url);
	}

	/** GET `url` as JSON. With `allowNotFound`, a 404 resolves to null. */
	private async requestJson(url: string, opts: { allowNotFound?: boolean } = {}): Promise<unknown> {
		const res = await requestUrl({ url, throw: false });
		if (opts.allowNotFound && res.status === 404) return null;
		if (res.status < 200 || res.status >= 300) {
			throw new Error(`HTTP ${res.status} fetching ${url}`);
		}
		const ct = (res.headers?.["content-type"] ?? res.headers?.["Content-Type"] ?? "").toLowerCase();
		const text = res.text ?? "";
		const looksLikeHtml = ct.includes("text/html") || /^\s*<(!doctype|html)/i.test(text);
		if (looksLikeHtml) {
			throw new Error(
				`Endpoint returned HTML, not JSON (${url}). ` +
					`The configured URL likely points at a web page rather than a data file. ` +
					`Ask the data-source maintainer for the canonical JSON URL, then set it in Settings → Custom URL.`,
			);
		}
		try {
			return res.json ?? JSON.parse(text);
		} catch (err) {
			throw new Error(`Could not parse JSON from ${url}: ${(err as Error).message}`);
		}
	}

	/** Defensive normalizer: accepts either an array or {cards: [...]}. */
	private normalize(raw: unknown, source: string): CardDatabase {
		const list = Array.isArray(raw)
			? raw
			: Array.isArray((raw as { cards?: unknown[] })?.cards)
				? (raw as { cards: unknown[] }).cards
				: [];
		const cards: Card[] = [];
		for (const entry of list) {
			const c = this.normalizeCard(entry);
			if (c) cards.push(c);
		}
		return {
			version: new Date().toISOString().slice(0, 10),
			source,
			cards,
		};
	}

	private normalizeCard(raw: unknown): Card | null {
		if (!raw || typeof raw !== "object") return null;
		const r = raw as Record<string, unknown>;
		const id = Number(r.id ?? r.cardId ?? r.code);
		if (!Number.isFinite(id)) return null;
		const name = asText(r.name ?? r.title) || `Card ${id}`;
		const syndicates = this.normalizeSyndicates(r.syndicates ?? r.syndicate ?? r.region ?? r.regions);
		const attack = toFiniteNumber(r.attack);
		const health = toFiniteNumber(r.health);
		const subtypes = Array.isArray(r.subtypes)
			? r.subtypes.map(asText)
			: r.subtype
				? [asText(r.subtype)]
				: [];
		const spellSpeed = asOptionalText(r.spellSpeed ?? r.spellSpeedRef);
		return {
			id,
			name,
			syndicates,
			type: asText(r.type) || "Unit",
			cost: Number(r.cost ?? 0) || 0,
			attack,
			health,
			rarity: asText(r.rarity) || "Common",
			keywords: Array.isArray(r.keywords) ? r.keywords.map(asText) : [],
			subtypes: subtypes.length ? subtypes : undefined,
			spellSpeed,
			text: asText(r.text ?? r.description),
			flavor: asOptionalText(r.flavor),
			set: asOptionalText(r.set),
			artist: asOptionalText(r.artist),
			collectible: r.collectible === false ? false : undefined,
			imageUrl: sanitizeRemoteImageUrl(asOptionalText(r.imageUrl)),
			imageUrlFull: sanitizeRemoteImageUrl(asOptionalText(r.imageUrlFull)),
		};
	}

	private normalizeSyndicates(value: unknown): Syndicate[] {
		const arr = Array.isArray(value) ? value : value ? [value] : [];
		const out: Syndicate[] = [];
		for (const v of arr) {
			const name = asText(v);
			const match = SYNDICATES.find((s) => s.toLowerCase() === name.toLowerCase());
			if (match) out.push(match);
		}
		return out;
	}

	// ---- cache (vault-relative under the plugin folder) -------------------

	private cachePath(): string {
		const dir = this.plugin.manifest.dir ?? `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
		return `${dir}/${CACHE_FILE}`;
	}

	async writeCache(db: CardDatabase): Promise<void> {
		await this.plugin.app.vault.adapter.write(this.cachePath(), JSON.stringify(db));
	}

	async readCache(): Promise<CardDatabase | null> {
		const p = this.cachePath();
		const adapter = this.plugin.app.vault.adapter;
		if (!(await adapter.exists(p))) return null;
		try {
			return JSON.parse(await adapter.read(p)) as CardDatabase;
		} catch {
			return null;
		}
	}
}

function toFiniteNumber(value: unknown): number | undefined {
	if (value === undefined || value === null) return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}

function sanitizeRemoteImageUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:") return undefined;
		return url.toString();
	} catch {
		return undefined;
	}
}
