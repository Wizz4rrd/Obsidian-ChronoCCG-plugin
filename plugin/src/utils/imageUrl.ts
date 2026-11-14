import { Card } from "../data/types";
import { ChronoSettings } from "../settings/SettingsTab";
import { imageCache } from "./ImageCache";

/** Show `card`'s image in `img`, from the local image cache when enabled. */
export function setCardImage(img: HTMLImageElement, card: Card, settings: ChronoSettings): void {
	const url = resolveCardImageUrl(card, settings);
	if (url) imageCache.setSrc(img, url);
	else img.addClass("is-missing");
}

/** Framed card, or the illustration when "Full art only" is selected. Null when the card has no image. */
export function resolveCardImageUrl(card: Card, settings: ChronoSettings): string | null {
	if (settings.cardImageStyle === "full" && card.imageUrlFull && isAllowedImageUrl(card.imageUrlFull)) {
		return card.imageUrlFull;
	}
	if (card.imageUrl && isAllowedImageUrl(card.imageUrl)) return card.imageUrl;
	if (card.imageUrlFull && isAllowedImageUrl(card.imageUrlFull)) return card.imageUrlFull;
	return null;
}

function isAllowedImageUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

/** Image URL of every card that has one, in the selected style. */
export function cardImageUrls(cards: readonly Card[], settings: ChronoSettings): string[] {
	const urls = new Set<string>();
	for (const card of cards) {
		const url = resolveCardImageUrl(card, settings);
		if (url) urls.add(url);
	}
	return Array.from(urls);
}
