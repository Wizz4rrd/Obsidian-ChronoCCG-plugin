import { Card } from "../data/types";
import { ChronoSettings } from "../settings/SettingsTab";

export function resolveCardImageUrl(card: Card, settings: ChronoSettings): string {
	const style = settings.cardImageStyle ?? "game";

	if (style === "full") {
		let full: string | undefined;
		if (card.imageUrlFull && isAllowedImageUrl(card.imageUrlFull)) full = card.imageUrlFull;
		else if (card.imageUrl && isAllowedImageUrl(card.imageUrl)) full = card.imageUrl;
		if (full) return preferRuneterraFullArtUrl(full);
	}

	// game (framed) — prefer explicit game URL, then derive from legacy *-full.webp cache
	if (card.imageUrl && isAllowedImageUrl(card.imageUrl)) {
		const game = runeterraGameUrlFromStored(card.imageUrl, card.imageUrlFull);
		if (game) return game;
	}
	if (card.imageUrl && isAllowedImageUrl(card.imageUrl)) return card.imageUrl;

	const base = settings.imageBase.replace(/\/+$/, "");
	return `${base}/${settings.imageSize}/${card.id}.webp`;
}

/** Use *-full.webp when the stored URL is the unframed game file. */
function preferRuneterraFullArtUrl(url: string): string {
	try {
		const u = new URL(url);
		if (!u.hostname.endsWith("runeterra.ar")) return url;
		// e.g. …/189.webp → …/189-full.webp
		const m = u.pathname.match(/\/(\d+)\.webp$/i);
		if (m && !u.pathname.includes("-full")) {
			u.pathname = u.pathname.replace(/\/(\d+)\.webp$/i, "/$1-full.webp");
			return u.toString();
		}
		return url;
	} catch {
		return url;
	}
}

/** Map legacy cache (imageUrl = *-full only) to framed asset when possible. */
function runeterraGameUrlFromStored(imageUrl: string, imageUrlFull?: string): string | null {
	try {
		const u = new URL(imageUrl);
		if (!u.hostname.endsWith("runeterra.ar")) return null;
		if (imageUrlFull && imageUrlFull !== imageUrl && !imageUrl.includes("-full.webp")) return null;
		const m = u.pathname.match(/\/(\d+)-full\.webp$/i);
		if (m) {
			u.pathname = u.pathname.replace(/\/(\d+)-full\.webp$/i, "/$1.webp");
			return u.toString();
		}
		return null;
	} catch {
		return null;
	}
}

function isAllowedImageUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}
