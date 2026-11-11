import { Card, CardDatabase, Syndicate } from "./types";

export interface CardQuery {
	text?: string;
	syndicates?: Syndicate[];
	types?: string[];
	rarities?: string[];
	keywords?: string[];
	/** Card must use one of these spell speeds (e.g. Immediate). Units with no speed never match. */
	spellSpeeds?: string[];
	sets?: string[];
	minCost?: number;
	maxCost?: number;
}

/**
 * In-memory, indexed card store. Cheap to build (a few hundred to a few
 * thousand cards is expected for a CCG), so we just rebuild indexes on load.
 */
export class CardRepository {
	private cards: Card[] = [];
	private byId = new Map<number, Card>();
	private byNameLower = new Map<string, Card>();
	private _version = "";
	private _source = "";

	load(db: CardDatabase): void {
		this.cards = db.cards.slice();
		this._version = db.version;
		this._source = db.source;
		this.byId.clear();
		this.byNameLower.clear();
		for (const c of this.cards) {
			this.byId.set(c.id, c);
			this.byNameLower.set(c.name.toLowerCase(), c);
		}
	}

	get version(): string {
		return this._version;
	}

	get source(): string {
		return this._source;
	}

	get size(): number {
		return this.cards.length;
	}

	all(): readonly Card[] {
		return this.cards;
	}

	getById(id: number): Card | undefined {
		return this.byId.get(id);
	}

	getByName(name: string): Card | undefined {
		return this.byNameLower.get(name.toLowerCase());
	}

	distinctSpellSpeeds(): string[] {
		const s = new Set<string>();
		for (const c of this.cards) {
			if (c.spellSpeed) s.add(c.spellSpeed);
		}
		return Array.from(s).sort((a, b) => a.localeCompare(b));
	}

	distinctRarities(): string[] {
		const s = new Set<string>();
		for (const c of this.cards) s.add(c.rarity);
		return Array.from(s).sort((a, b) => a.localeCompare(b));
	}

	distinctTypes(): string[] {
		const s = new Set<string>();
		for (const c of this.cards) s.add(c.type);
		return Array.from(s).sort((a, b) => a.localeCompare(b));
	}

	distinctKeywords(): string[] {
		const s = new Set<string>();
		for (const c of this.cards) for (const k of c.keywords) s.add(k);
		return Array.from(s).sort((a, b) => a.localeCompare(b));
	}

	distinctSets(): string[] {
		const s = new Set<string>();
		for (const c of this.cards) if (c.set) s.add(c.set);
		return Array.from(s).sort((a, b) => a.localeCompare(b));
	}

	/** Resolve "123" or "Card Name" to a Card. */
	resolve(ref: string): Card | undefined {
		const trimmed = ref.trim();
		if (/^\d+$/.test(trimmed)) {
			return this.getById(Number(trimmed));
		}
		return this.getByName(trimmed);
	}

	search(query: CardQuery, limit = 200): Card[] {
		const raw = query.text?.toLowerCase().trim() ?? "";
		const tokens = raw.split(/\s+/).filter(Boolean);
		const out: Card[] = [];
		for (const c of this.cards) {
			if (query.syndicates?.length && !query.syndicates.some((s) => c.syndicates.includes(s))) continue;
			if (query.types?.length && !query.types.includes(c.type)) continue;
			if (query.rarities?.length && !query.rarities.includes(c.rarity)) continue;
			if (query.keywords?.length && !query.keywords.every((k) => c.keywords.includes(k))) continue;
			if (query.spellSpeeds?.length) {
				const ss = c.spellSpeed ?? "";
				if (!ss || !query.spellSpeeds.includes(ss)) continue;
			}
			if (query.sets?.length && !query.sets.includes(c.set ?? "")) continue;
			if (query.minCost !== undefined && c.cost < query.minCost) continue;
			if (query.maxCost !== undefined && c.cost > query.maxCost) continue;
			if (tokens.length) {
				const hay = searchHaystack(c);
				if (tokens.some((t) => !hay.includes(t))) continue;
			}
			out.push(c);
			if (out.length >= limit) break;
		}
		return out;
	}
}

function searchHaystack(c: Card): string {
	const pieces: string[] = [
		c.name,
		c.text,
		c.type,
		c.rarity,
		c.set ?? "",
		c.flavor ?? "",
		c.artist ?? "",
		c.spellSpeed ?? "",
		String(c.id),
		String(c.cost),
		...c.keywords,
		...c.syndicates,
		...(c.subtypes ?? []),
	];
	if (c.attack !== undefined) pieces.push(String(c.attack));
	if (c.health !== undefined) pieces.push(String(c.health));
	if (c.attack !== undefined && c.health !== undefined) {
		pieces.push(`${c.attack}/${c.health}`);
	}
	return pieces.join(" ").toLowerCase();
}
