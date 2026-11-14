import { setIcon } from "obsidian";
import { Syndicate } from "../data/types";
import { imageCache } from "../utils/ImageCache";

const ICON_BASE = "https://playchrono.com/assets/icons/syndicates";

/** Shown when the official icon can't be loaded (offline before it was ever saved). */
const FALLBACK_ICONS: Record<Syndicate, string> = {
	Lifeblood: "droplet",
	Sungrace: "sun",
	Silence: "volume-x",
	Singularity: "orbit",
	Splintergleam: "gem",
	Phasetide: "waves",
};

export function syndicateIconUrl(s: Syndicate): string {
	return `${ICON_BASE}/${s.toLowerCase()}.webp`;
}

/** Official syndicate icon (saved with the card images), decorative: the syndicate name is always next to it. */
export function renderSyndicateIcon(parent: HTMLElement, s: Syndicate): HTMLElement {
	const el = parent.createSpan({ cls: ["chrono-synd-icon", `chrono-synd-${s.toLowerCase()}`], attr: { "aria-hidden": "true" } });
	const img = el.createEl("img", { attr: { alt: "" } });
	img.addEventListener(
		"error",
		() => {
			img.remove();
			setIcon(el, FALLBACK_ICONS[s]);
		},
		{ once: true },
	);
	imageCache.setSrc(img, syndicateIconUrl(s));
	return el;
}
