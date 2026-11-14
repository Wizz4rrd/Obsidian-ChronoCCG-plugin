import { Card, CardDatabase, Syndicate, SYNDICATES } from "./types";
import { asOptionalText, asText } from "../utils/text";

/**
 * Normalizer for the official card files
 * (`https://cdn.playchrono.com/latest/en_us/data/set/{setId}/CardsInSet{setId}.json`).
 * Kept free of `obsidian` imports so it can be unit-tested.
 *
 * Every field is treated as optional, as the publisher asks: unknown fields
 * are ignored and new ones may appear without notice.
 */

export const OFFICIAL_CDN = "https://cdn.playchrono.com/latest";
export const OFFICIAL_SOURCE = "playchrono.com";

type Json = Record<string, unknown>;

/** `raw` is the concatenation of every set file. A card listed in several sets keeps its most recent version. */
export function normalizeOfficial(raw: unknown[]): CardDatabase {
	const byId = new Map<number, { card: Card; effective: number }>();
	for (const entry of raw) {
		const card = normalizeOfficialCard(entry);
		if (!card) continue;
		const effective = toFiniteNumber(asObject(asObject(entry)?.CurrentAttributes)?.EffectiveDateTicks) ?? 0;
		const prev = byId.get(card.id);
		if (!prev || effective > prev.effective) byId.set(card.id, { card, effective });
	}
	return {
		version: new Date().toISOString().slice(0, 10),
		source: OFFICIAL_SOURCE,
		cards: Array.from(byId.values(), (v) => v.card),
	};
}

export function normalizeOfficialCard(raw: unknown): Card | null {
	const r = asObject(raw);
	if (!r) return null;
	const id = Number(r.CardID);
	if (!Number.isInteger(id) || id <= 0) return null;
	const a = asObject(r.CurrentAttributes) ?? asObject(r.BaseAttributes) ?? {};

	// e.g. "Agent", "Immortalized Agent", "Action (Fast)", "Action (Slow), Token", "Token".
	const typeParts = asText(a.CardType)
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);
	const isToken = typeParts.includes("Token") || asText(asObject(a.Rarity)?.Name) === "Token";
	const isImmortalized = a.IsImmortalized === true || typeParts.includes("Immortalized Agent");
	const main = typeParts.find((p) => p !== "Token") ?? "";
	const action = main.match(/^Action\s*\(([^)]+)\)/i);
	const strength = toFiniteNumber(a.Strength);
	const durability = toFiniteNumber(a.Durability);

	let type: string;
	if (action) type = "Action";
	else if (main) type = main;
	// A bare "Token" is a summoned Agent when it has stats.
	else type = (strength ?? 0) > 0 || (durability ?? 0) > 0 ? "Agent" : "Token";
	const isAgent = /agent/i.test(type);

	const set = asObject(a.Set);
	const setId = Number(set?.SetID);
	const artName = asOptionalText(asObject(a.CardArt)?.ImageName);
	const imageUrl = Number.isInteger(setId) && setId > 0 ? `${OFFICIAL_CDN}/en_us/img/cards/full/set/${setId}/${id}.png` : undefined;
	const imageUrlFull =
		imageUrl && artName && /^[\w-]+$/.test(artName) ? `${OFFICIAL_CDN}/en_us/img/cards/set/${setId}/4/${artName}.png` : undefined;

	return {
		id,
		name: asOptionalText(r.LocalizedName) ?? asOptionalText(r.Name) ?? `Card ${id}`,
		syndicates: toSyndicates(asObject(a.Syndicate)?.Name),
		type,
		cost: toFiniteNumber(a.PowerCost) ?? 0,
		attack: isAgent ? strength : undefined,
		health: isAgent ? durability : undefined,
		rarity: asOptionalText(asObject(a.Rarity)?.Name) ?? "Common",
		keywords: keywordsOf(r),
		subtypes: isToken ? ["Token"] : undefined,
		spellSpeed: action ? action[1].trim() : undefined,
		text: cleanText(a.LocalizedEffect ?? a.Effect),
		flavor: asOptionalText(cleanText(a.LocalizedFlavourText ?? asObject(a.FlavourText)?.Text)),
		set: asOptionalText(set?.Name),
		artist: asOptionalText(asObject(a.Artist)?.Name),
		// Immortalized sides and tokens are separate cards that can't be put in a deck.
		collectible: isImmortalized || isToken ? false : undefined,
		imageUrl,
		imageUrlFull,
	};
}

function keywordsOf(r: Json): string[] {
	const data = asObject(r.GameplayProperties)?.KeywordData;
	if (!Array.isArray(data)) return [];
	const out = new Set<string>();
	for (const k of data) {
		const name = asOptionalText(asObject(k)?.KeywordName);
		if (name) out.add(name);
	}
	return Array.from(out);
}

function toSyndicates(value: unknown): Syndicate[] {
	const name = asText(value).toLowerCase();
	const match = SYNDICATES.find((s) => s.toLowerCase() === name);
	return match ? [match] : [];
}

/** Plain rules text: "\r\n" → "\n", no trailing spaces. */
function cleanText(value: unknown): string {
	return asText(value)
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t]+\n/g, "\n")
		.trim();
}

function asObject(value: unknown): Json | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}
