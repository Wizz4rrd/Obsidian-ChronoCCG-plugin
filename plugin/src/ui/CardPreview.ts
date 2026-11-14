import { App, Modal, Platform } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { isImmortalized } from "../data/CardRepository";
import { isDiverEligible } from "../data/DeckRules";
import { Card } from "../data/types";
import { setCardImage } from "../utils/imageUrl";
import { syndicateClass } from "./CardTile";

/**
 * Floating card preview shown while hovering a card reference (tiles, deck
 * rows, inline `chrono:` refs). One element per document, reused.
 * On mobile there is no hover, so callers open {@link CardDetailModal} on tap.
 */
const POPOVER_CLASS = "chrono-card-popover";
const POPOVER_WIDTH = 260;
/** With the immortalized side next to the card (see `.has-pair` in styles.css). */
const POPOVER_PAIR_WIDTH = 480;

interface PopoverState {
	el: HTMLElement;
	width: number;
	/** Measured once per card (and again when its image loads), not on every mouse move. */
	height: number;
	x: number;
	y: number;
	frame: number;
}

const popovers = new WeakMap<Document, PopoverState>();
/** Every popover element made, to remove them when the plugin unloads. */
const popoverEls = new Set<HTMLElement>();

function popoverFor(doc: Document): PopoverState {
	let state = popovers.get(doc);
	if (!state || !state.el.isConnected) {
		const el = doc.body.querySelector<HTMLElement>(`.${POPOVER_CLASS}`) ?? doc.body.createDiv({ cls: POPOVER_CLASS });
		popoverEls.add(el);
		state = { el, width: POPOVER_WIDTH, height: 0, x: 0, y: 0, frame: 0 };
		popovers.set(doc, state);
	}
	return state;
}

export function showCardPopover(plugin: ChronoCCGPlugin, card: Card, evt: MouseEvent): void {
	if (!plugin.settings.hoverPreviews || Platform.isMobile) return;
	const doc = (evt.target as Node | null)?.ownerDocument ?? activeDocument;
	const state = popoverFor(doc);
	const pop = state.el;
	if (pop.dataset.cardId !== String(card.id)) {
		pop.empty();
		pop.dataset.cardId = String(card.id);
		state.height = 0;
		const other = plugin.cards.otherSide(card);
		pop.toggleClass("has-pair", !!other);
		state.width = other ? POPOVER_PAIR_WIDTH : POPOVER_WIDTH;
		const images = pop.createDiv({ cls: "chrono-card-popover-images" });
		for (const side of cardSides(card, other)) {
			const figure = images.createDiv({ cls: "chrono-card-popover-side" });
			const img = figure.createEl("img", { attr: { alt: side.name } });
			img.addEventListener("load", () => (state.height = 0));
			setCardImage(img, side, plugin.settings);
			if (other) figure.createDiv({ cls: "chrono-card-popover-caption", text: sideLabel(side) });
		}
		const info = pop.createDiv({ cls: "chrono-card-popover-info" });
		info.createDiv({ cls: "chrono-card-popover-name", text: card.name });
		info.createDiv({ cls: "chrono-card-popover-meta", text: cardMetaLine(card) });
		if (card.keywords.length) info.createDiv({ cls: "chrono-card-popover-kw", text: card.keywords.join(" · ") });
		if (card.text) info.createDiv({ cls: "chrono-card-popover-text", text: card.text });
		if (other) {
			const side = info.createDiv({ cls: "chrono-card-popover-other" });
			side.createDiv({ cls: "chrono-card-popover-name", text: `${sideLabel(other)}: ${other.name}` });
			side.createDiv({ cls: "chrono-card-popover-meta", text: cardMetaLine(other) });
			if (other.text) side.createDiv({ cls: "chrono-card-popover-text", text: other.text });
		}
	}
	state.x = evt.clientX;
	state.y = evt.clientY;
	const win = doc.defaultView ?? window;
	if (!pop.hasClass("is-visible")) {
		pop.addClass("is-visible");
		positionPopover(state, win);
	} else if (!state.frame) {
		// Mouse moves come faster than frames: position once per frame.
		state.frame = win.requestAnimationFrame(() => {
			state.frame = 0;
			positionPopover(state, win);
		});
	}
}

/** Remove the popovers from every window (plugin unload). */
export function removeCardPopovers(): void {
	for (const el of popoverEls) {
		hideCardPopover(el.ownerDocument);
		el.remove();
	}
	popoverEls.clear();
}

export function hideCardPopover(doc: Document = activeDocument): void {
	const state = popovers.get(doc);
	if (!state) return;
	if (state.frame) {
		(doc.defaultView ?? window).cancelAnimationFrame(state.frame);
		state.frame = 0;
	}
	state.el.removeClass("is-visible");
}

function positionPopover(state: PopoverState, win: Window): void {
	const pop = state.el;
	const h = state.height || (state.height = pop.offsetHeight) || 420;
	let x = state.x + 18;
	let y = state.y - h / 3;
	if (x + state.width > win.innerWidth - 8) x = state.x - state.width - 18;
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

/** The base Agent first, then its immortalized side. */
function cardSides(card: Card, other: Card | undefined): Card[] {
	if (!other) return [card];
	return isImmortalized(card) ? [other, card] : [card, other];
}

function sideLabel(card: Card): string {
	return isImmortalized(card) ? "Immortalized" : "Base";
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
		const other = this.plugin.cards.otherSide(card);
		const images = wrap.createDiv({ cls: "chrono-card-modal-images" });
		images.toggleClass("has-pair", !!other);
		for (const side of cardSides(card, other)) {
			const figure = images.createDiv({ cls: "chrono-card-modal-side" });
			const img = figure.createEl("img", { cls: "chrono-card-modal-img", attr: { alt: side.name } });
			setCardImage(img, side, this.plugin.settings);
			if (!other) continue;
			figure.createDiv({ cls: "chrono-card-modal-meta", text: sideLabel(side) });
			if (side !== card) {
				figure.addClass("is-clickable");
				figure.setAttr("aria-label", `Open ${side.name}`);
				figure.addEventListener("click", () => {
					this.close();
					new CardDetailModal(this.app, this.plugin, side).open();
				});
			}
		}
		const info = wrap.createDiv({ cls: "chrono-card-modal-info" });
		info.createEl("h3", { text: card.name, cls: syndicateClass(card) });
		info.createDiv({ cls: "chrono-card-modal-meta", text: cardMetaLine(card) });
		if (card.keywords.length) info.createDiv({ cls: "chrono-card-modal-kw", text: `Keywords: ${card.keywords.join(", ")}` });
		if (card.text) info.createDiv({ cls: "chrono-card-text", text: card.text });
		if (card.flavor) info.createEl("em", { text: card.flavor });
		if (other) {
			const side = info.createDiv({ cls: "chrono-card-modal-other" });
			side.createEl("h4", { text: `${sideLabel(other)}: ${other.name}`, cls: syndicateClass(other) });
			side.createDiv({ cls: "chrono-card-modal-meta", text: cardMetaLine(other) });
			if (other.keywords.length) side.createDiv({ cls: "chrono-card-modal-kw", text: `Keywords: ${other.keywords.join(", ")}` });
			if (other.text) side.createDiv({ cls: "chrono-card-text", text: other.text });
		}
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
		if (card.collectible !== false) btn("Add to deck builder", () => void this.plugin.addToBuilder(card, false));
		if (isDiverEligible(card)) btn("Set as Diver", () => void this.plugin.addToBuilder(card, true));
		btn("Copy inline reference", () => void navigator.clipboard.writeText(`\`chrono:${card.name}\``));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
