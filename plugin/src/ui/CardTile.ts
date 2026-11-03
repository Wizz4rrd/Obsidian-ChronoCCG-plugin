import { Card } from "../data/types";
import { ChronoSettings } from "../settings/SettingsTab";
import { resolveCardImageUrl } from "../utils/imageUrl";

export interface RenderCardOptions {
	size?: "thumb" | "full";
	showText?: boolean;
	/** Deck quantity; prepended to the meta line (compact, no extra row). */
	deckCount?: number;
}

/** Renders a card tile into `parent`. Pure DOM — works in any container. */
export function renderCardTile(
	parent: HTMLElement,
	card: Card,
	settings: ChronoSettings,
	opts: RenderCardOptions = {},
): HTMLElement {
	const tile = parent.createDiv({ cls: ["chrono-card-tile", syndicateClass(card)] });
	tile.dataset.cardId = String(card.id);

	const visual = tile.createDiv({ cls: "chrono-card-tile-visual" });
	const img = visual.createEl("img", {
		attr: {
			src: resolveCardImageUrl(card, settings),
			alt: card.name,
			loading: "lazy",
		},
	});
	if (opts.size === "full") img.addClass("chrono-card-img-full");

	tile.createDiv({ cls: "chrono-card-name", text: card.name });

	const meta = tile.createDiv({ cls: "chrono-card-meta" });
	const parts: string[] = [];
	parts.push(`${card.cost}⌬`);
	if (card.attack !== undefined && card.health !== undefined) {
		parts.push(`${card.attack}/${card.health}`);
	}
	parts.push(card.syndicates.join(" · ") || "—");
	parts.push(card.rarity);
	const metaBody = parts.join(" • ");
	meta.empty();
	if (opts.deckCount !== undefined && opts.deckCount >= 1) {
		meta.createSpan({ cls: "chrono-deck-qty-inline", text: `×${opts.deckCount}` });
		meta.append(" • ");
	}
	meta.append(metaBody);

	if (opts.showText && card.keywords.length) {
		tile.createDiv({ cls: "chrono-card-kw", text: card.keywords.join(" · ") });
	}
	if (opts.showText && card.text) {
		tile.createDiv({ cls: "chrono-card-text", text: card.text });
	}

	return tile;
}

/** CSS class carrying the card's (first) syndicate colour, e.g. `chrono-synd-phasetide`. */
export function syndicateClass(card: Card): string {
	const s = card.syndicates[0];
	return s ? `chrono-synd-${s.toLowerCase()}` : "chrono-synd-none";
}
