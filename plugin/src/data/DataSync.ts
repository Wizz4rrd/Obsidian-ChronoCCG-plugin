import { Plugin, requestUrl } from "obsidian";
import { Card, CardDatabase, Syndicate, SYNDICATES } from "./types";
import { asOptionalText, asText } from "../utils/text";

export type DataSourceId = "bundled" | "runeterra-ar" | "custom";

export interface DataSourceConfig {
	id: DataSourceId;
	/** For "custom" — full URL returning JSON we can normalize. */
	url?: string;
}

const CACHE_FILE = "card-cache.json";

/** Pulls card datasets from supported sources and normalizes card data. */
export class DataSync {
	constructor(private plugin: Plugin) {}

	async fetch(source: DataSourceConfig): Promise<CardDatabase> {
		switch (source.id) {
			case "runeterra-ar":
				return this.fetchRuneterraAr();
			case "custom":
				if (!source.url) throw new Error("Custom data source requires a URL.");
				return this.fetchCustom(source.url);
			case "bundled":
			default:
				throw new Error("Bundled source is loaded directly, not via DataSync.fetch.");
		}
	}

	private async fetchRuneterraAr(): Promise<CardDatabase> {
		// Confirmed endpoint (POST). `take` is large enough to cover the entire
		// pool in one request; the server returns whatever exists.
		const url = "https://www.runeterra.ar/api/cards/builder/get/en_us?game=chrono&take=2000";
		const raw = await this.postJson(url, {});
		return this.normalizeRuneterraAr(raw);
	}

	private async fetchCustom(url: string): Promise<CardDatabase> {
		const raw = await this.getJson(url);
		return this.normalize(raw, url);
	}

	private async getJson(url: string): Promise<unknown> {
		return this.requestJson(url, "GET");
	}

	private async postJson(url: string, body: unknown): Promise<unknown> {
		return this.requestJson(url, "POST", JSON.stringify(body));
	}

	private async requestJson(url: string, method: "GET" | "POST", body?: string): Promise<unknown> {
		const res = await requestUrl({
			url,
			method,
			body,
			contentType: method === "POST" ? "application/json" : undefined,
			throw: false,
		});
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

	/** Normalizer for the runeterra.ar /api/cards/builder/get/{lang} response. */
	private normalizeRuneterraAr(raw: unknown): CardDatabase {
		const list = Array.isArray((raw as { cards?: unknown[] })?.cards)
			? (raw as { cards: unknown[] }).cards
			: [];
		const cards: Card[] = [];
		for (const entry of list) {
			const c = this.normalizeRuneterraArCard(entry);
			if (c) cards.push(c);
		}
		return {
			version: new Date().toISOString().slice(0, 10),
			source: "runeterra.ar",
			cards,
		};
	}

	private normalizeRuneterraArCard(raw: unknown): Card | null {
		if (!raw || typeof raw !== "object") return null;
		const r = raw as Record<string, unknown>;
		const id = Number(r.cardId ?? r.cardCode);
		if (!Number.isFinite(id)) return null;
		const regionRefs = Array.isArray(r.regionRefs)
			? (r.regionRefs as unknown[]).map(asText)
			: r.regionRef
				? [asText(r.regionRef)]
				: [];
		const syndicates = this.normalizeSyndicates(regionRefs);
		const assets = (r.assets as Array<{ fullAbsolutePath?: string; gameAbsolutePath?: string }>) ?? [];
		const game = sanitizeRemoteImageUrl(assets[0]?.gameAbsolutePath);
		const fullArt = sanitizeRemoteImageUrl(assets[0]?.fullAbsolutePath);
		// game = framed card (cost/stats/text on image); fullArt = illustration-only crop.
		const imageUrl = game ?? fullArt;
		const imageUrlFull = fullArt && game && fullArt !== game ? fullArt : undefined;
		const keywords = Array.isArray(r.keywordRefs)
			? (r.keywordRefs as unknown[]).map(asText)
			: Array.isArray(r.keywords)
				? (r.keywords as unknown[]).map(asText)
				: [];
		const subtypes = Array.isArray(r.subtypes)
			? (r.subtypes as unknown[]).map(asText)
			: r.subtype
				? [asText(r.subtype)]
				: [];
		const spellSpeed = asOptionalText(r.spellSpeedRef ?? r.spellSpeed);
		const attack = toFiniteNumber(r.attack);
		const health = toFiniteNumber(r.health);
		const textParts = [r.descriptionRaw, r.description, r.levelupDescriptionRaw, r.levelupDescription]
			.map(asText)
			.filter((v) => v.trim() !== "");
		return {
			id,
			name: asText(r.name) || `Card ${id}`,
			syndicates,
			type: asText(r.typeRef ?? r.type) || "Unit",
			cost: Number(r.cost ?? 0) || 0,
			attack,
			health,
			rarity: asText(r.rarityRef ?? r.rarity) || "Common",
			keywords,
			subtypes: subtypes.length ? subtypes : undefined,
			spellSpeed,
			text: textParts.join("\n"),
			flavor: asOptionalText(r.flavorText),
			set: asOptionalText(r.set),
			artist: asOptionalText(r.artistName),
			collectible: r.collectible === false ? false : undefined,
			imageUrl,
			imageUrlFull,
		};
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
