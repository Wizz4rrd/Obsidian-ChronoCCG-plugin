import { App, Modal, Platform } from "obsidian";
import type ChronoCCGPlugin from "../../main";
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

interface PopoverState {
	el: HTMLElement;
	/** Measured once per card (and again when its image loads), not on every mouse move. */
	height: number;
	x: number;
	y: number;
	frame: number;
}

const popovers = new WeakMap<Document, PopoverState>();

function popoverFor(doc: Document): PopoverState {
	let state = popovers.get(doc);
	if (!state || !state.el.isConnected) {
		const el = doc.body.querySelector<HTMLElement>(`.${POPOVER_CLASS}`) ?? doc.body.createDiv({ cls: POPOVER_CLASS });
		state = { el, height: 0, x: 0, y: 0, frame: 0 };
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
		const img = pop.createEl("img", { attr: { alt: card.name } });
		img.addEventListener("load", () => (state.height = 0));
		setCardImage(img, card, plugin.settings);
		const info = pop.createDiv({ cls: "chrono-card-popover-info" });
		info.createDiv({ cls: "chrono-card-popover-name", text: card.name });
		info.createDiv({ cls: "chrono-card-popover-meta", text: cardMetaLine(card) });
		if (card.keywords.length) info.createDiv({ cls: "chrono-card-popover-kw", text: card.keywords.join(" · ") });
		if (card.text) info.createDiv({ cls: "chrono-card-popover-text", text: card.text });
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

export function hideCardPopover(doc: Document = activeDocument): void {
	popovers.get(doc)?.el.removeClass("is-visible");
}

function positionPopover(state: PopoverState, win: Window): void {
	const pop = state.el;
	const h = state.height || (state.height = pop.offsetHeight) || 420;
	let x = state.x + 18;
	let y = state.y - h / 3;
	if (x + POPOVER_WIDTH > win.innerWidth - 8) x = state.x - POPOVER_WIDTH - 18;
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
		const img = wrap.createEl("img", { cls: "chrono-card-modal-img", attr: { alt: card.name } });
		setCardImage(img, card, this.plugin.settings);
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
		if (card.collectible !== false) btn("Add to deck builder", () => void this.plugin.addToBuilder(card, false));
		if (isDiverEligible(card)) btn("Set as Diver", () => void this.plugin.addToBuilder(card, true));
		btn("Copy inline reference", () => void navigator.clipboard.writeText(`\`chrono:${card.name}\``));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
