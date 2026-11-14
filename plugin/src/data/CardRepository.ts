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
	/** Card costs one of these; {@link COST_FILTER_MAX} stands for that cost and above. */
	costs?: ReadonlySet<number>;
}

/** Highest cost filter: "7+". */
export const COST_FILTER_MAX = 7;

/** The cost filter a card falls under (7 and above all count as 7+). */
export function costBucket(cost: number): number {
	return Math.min(Math.max(0, cost), COST_FILTER_MAX);
}

/** The flipped side of an Agent that immortalizes; a separate card that can't be put in a deck. */
export function isImmortalized(card: Card): boolean {
	return /immortali[sz]ed/i.test(card.type);
}

/** How far before an immortalized card its base can be (tokens it creates may sit in between). */
const MAX_BASE_DISTANCE = 3;

/**
 * In-memory, indexed card store. Cheap to build (a few hundred to a few
 * thousand cards is expected for a CCG), so we just rebuild indexes on load.
 */
export class CardRepository {
	private cards: Card[] = [];
	private byId = new Map<number, Card>();
	private byNameLower = new Map<string, Card>();
	/** Base card ↔ immortalized side, both ways. */
	private sides = new Map<number, number>();
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
		this.sides.clear();
		for (const c of this.cards) {
			const base = isImmortalized(c) ? this.baseOf(c) : undefined;
			if (!base) continue;
			this.sides.set(c.id, base.id);
			this.sides.set(base.id, c.id);
		}
	}

	/**
	 * The data doesn't link the two sides, but the immortalized side always
	 * comes right after its base Agent, sometimes after the tokens it creates.
	 */
	private baseOf(immortal: Card): Card | undefined {
		for (let id = immortal.id - 1; id >= immortal.id - MAX_BASE_DISTANCE; id--) {
			const c = this.byId.get(id);
			if (!c || c.subtypes?.includes("Token")) continue;
			return /agent/i.test(c.type) && !isImmortalized(c) && !this.sides.has(c.id) ? c : undefined;
		}
		return undefined;
	}

	/** The immortalized side of a base Agent, or the base Agent of an immortalized side. */
	otherSide(card: Card): Card | undefined {
		const id = this.sides.get(card.id);
		return id === undefined ? undefined : this.byId.get(id);
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

	/** Cards matching `query`, cheapest first (then by name), at most `limit` of them. */
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
			if (query.costs?.size && !query.costs.has(costBucket(c.cost))) continue;
			if (tokens.length) {
				const hay = searchHaystack(c);
				if (tokens.some((t) => !hay.includes(t))) continue;
			}
			out.push(c);
		}
		return out.sort(byCostThenName).slice(0, limit);
	}
}

function byCostThenName(a: Card, b: Card): number {
	return a.cost - b.cost || a.name.localeCompare(b.name);
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
