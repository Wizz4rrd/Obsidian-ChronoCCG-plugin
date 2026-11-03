import { App, Modal, Platform } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { Card } from "../data/types";
import { resolveCardImageUrl } from "../utils/imageUrl";
import { syndicateClass } from "./CardTile";

/**
 * Floating card preview shown while hovering a card reference (tiles, deck
 * rows, inline `chrono:` refs). One element per document, reused.
 * On mobile there is no hover, so callers open {@link CardDetailModal} on tap.
 */
const POPOVER_CLASS = "chrono-card-popover";

export function showCardPopover(plugin: ChronoCCGPlugin, card: Card, evt: MouseEvent): void {
	if (!plugin.settings.hoverPreviews || Platform.isMobile) return;
	const doc = (evt.target as Node | null)?.ownerDocument ?? document;
	let pop = doc.body.querySelector<HTMLElement>(`.${POPOVER_CLASS}`);
	if (!pop) pop = doc.body.createDiv({ cls: POPOVER_CLASS });
	if (pop.dataset.cardId !== String(card.id)) {
		pop.empty();
		pop.dataset.cardId = String(card.id);
		pop.createEl("img", {
			attr: { src: resolveCardImageUrl(card, { ...plugin.settings, imageSize: "full" }), alt: card.name },
		});
		const info = pop.createDiv({ cls: "chrono-card-popover-info" });
		info.createDiv({ cls: "chrono-card-popover-name", text: card.name });
		info.createDiv({ cls: "chrono-card-popover-meta", text: cardMetaLine(card) });
		if (card.keywords.length) info.createDiv({ cls: "chrono-card-popover-kw", text: card.keywords.join(" · ") });
		if (card.text) info.createDiv({ cls: "chrono-card-popover-text", text: card.text });
	}
	pop.addClass("is-visible");
	positionPopover(pop, evt);
}

export function hideCardPopover(doc: Document = document): void {
	doc.body.querySelector(`.${POPOVER_CLASS}`)?.removeClass("is-visible");
}

function positionPopover(pop: HTMLElement, evt: MouseEvent): void {
	const win = pop.ownerDocument.defaultView ?? window;
	const w = 260;
	const h = pop.offsetHeight || 420;
	let x = evt.clientX + 18;
	let y = evt.clientY - h / 3;
	if (x + w > win.innerWidth - 8) x = evt.clientX - w - 18;
	y = Math.max(8, Math.min(y, win.innerHeight - h - 8));
	pop.style.setProperty("--chrono-pop-x", `${Math.max(8, x)}px`);
	pop.style.setProperty("--chrono-pop-y", `${y}px`);
}

/** Wire hover (desktop) and tap (mobile) previews onto any element. */
export function attachCardPreview(plugin: ChronoCCGPlugin, el: HTMLElement, card: Card, opts: { tapToOpen?: boolean } = {}): void {
	el.addEventListener("mouseenter", (evt) => showCardPopover(plugin, card, evt));
	el.addEventListener("mousemove", (evt) => showCardPopover(plugin, card, evt));
	el.addEventListener("mouseleave", () => hideCardPopover(el.ownerDocument));
	if (opts.tapToOpen) {
		el.addEventListener("click", (evt) => {
			if (evt.defaultPrevented) return;
			hideCardPopover(el.ownerDocument);
			new CardDetailModal(plugin.app, plugin, card).open();
		});
	}
}

export function cardMetaLine(card: Card): string {
	const parts = [`${card.cost} energy`, card.type];
	if (card.spellSpeed) parts.push(card.spellSpeed);
	if (card.attack !== undefined && card.health !== undefined && /agent|unit/i.test(card.type)) {
		parts.push(`${card.attack}/${card.health}`);
	}
	parts.push(card.syndicates.join(" / ") || "Neutral", card.rarity);
	if (card.set) parts.push(card.set);
	return parts.join(" • ");
}

/** Big card view with details and quick actions. */
export class CardDetailModal extends Modal {
	constructor(app: App, private plugin: ChronoCCGPlugin, private card: Card) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, card } = this;
		this.modalEl.addClass("chrono-card-modal");
		contentEl.empty();
		const wrap = contentEl.createDiv({ cls: "chrono-card-modal-body" });
		wrap.createEl("img", {
			cls: "chrono-card-modal-img",
			attr: { src: resolveCardImageUrl(card, { ...this.plugin.settings, imageSize: "full" }), alt: card.name },
		});
		const info = wrap.createDiv({ cls: "chrono-card-modal-info" });
		info.createEl("h3", { text: card.name, cls: syndicateClass(card) });
		info.createDiv({ cls: "chrono-card-modal-meta", text: cardMetaLine(card) });
		if (card.keywords.length) info.createDiv({ cls: "chrono-card-modal-kw", text: `Keywords: ${card.keywords.join(", ")}` });
		if (card.text) info.createDiv({ cls: "chrono-card-text", text: card.text });
		if (card.flavor) info.createEl("em", { text: card.flavor });
		if (card.artist) info.createDiv({ cls: "chrono-card-modal-meta", text: `Art: ${card.artist}` });
		info.createDiv({ cls: "chrono-card-modal-meta", text: `Card id: ${card.id}` });

		const actions = info.createDiv({ cls: "chrono-card-modal-actions" });
		const btn = (text: string, fn: () => void) => {
			const b = actions.createEl("button", { text });
			b.addEventListener("click", () => {
				fn();
				this.close();
			});
		};
		btn("Add to deck builder", () => void this.plugin.addToBuilder(card, false));
		if (/agent|unit/i.test(card.type)) btn("Set as Diver", () => void this.plugin.addToBuilder(card, true));
		btn("Copy inline reference", () => void navigator.clipboard.writeText(`\`chrono:${card.name}\``));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
