import { Menu, Notice, setIcon } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { deckCode, toCodeBlock, toJson, toMarkdownTable, toPlainList } from "../data/DeckExport";
import { CURVE_MAX, DeckIssue, DeckStats, DIVER_COUNT, MAIN_DECK_SIZE } from "../data/DeckRules";
import { Card, Deck, SYNDICATES } from "../data/types";
import { attachCardPreview } from "./CardPreview";
import { syndicateClass, UNKNOWN_CARD_HINT } from "./CardTile";

/** Small bar chart of the main deck's energy curve. */
export function renderCurve(parent: HTMLElement, stats: DeckStats): HTMLElement {
	const wrap = parent.createDiv({ cls: "chrono-curve" });
	const max = Math.max(1, ...stats.curve);
	stats.curve.forEach((n, cost) => {
		const col = wrap.createDiv({ cls: "chrono-curve-col" });
		col.setAttr("aria-label", `${n} card${n === 1 ? "" : "s"} at cost ${cost}${cost === CURVE_MAX ? "+" : ""}`);
		col.createDiv({ cls: "chrono-curve-count", text: n ? String(n) : "" });
		const track = col.createDiv({ cls: "chrono-curve-track" });
		const bar = track.createDiv({ cls: "chrono-curve-bar" });
		bar.style.setProperty("--chrono-bar", `${(n / max) * 100}%`);
		col.createDiv({ cls: "chrono-curve-label", text: cost === CURVE_MAX ? `${cost}+` : String(cost) });
	});
	return wrap;
}

/** One-line summary chips: count, types, syndicates, avg cost. */
export function renderDeckChips(parent: HTMLElement, deck: Deck, stats: DeckStats, legal: boolean): HTMLElement {
	const row = parent.createDiv({ cls: "chrono-deck-chips" });
	const chip = (text: string, cls = "") => row.createSpan({ cls: `chrono-chip ${cls}`.trim(), text });
	chip(legal ? "Legal" : "Not legal", legal ? "is-ok" : "is-bad");
	chip(`${stats.mainCount}/${MAIN_DECK_SIZE} cards`, stats.mainCount === MAIN_DECK_SIZE ? "" : "is-warn");
	chip(`${deck.divers.length}/${DIVER_COUNT} Divers`, deck.divers.length === DIVER_COUNT ? "" : "is-warn");
	for (const [type, n] of Object.entries(stats.byType).sort()) chip(`${n} ${type}${n === 1 ? "" : "s"}`);
	for (const s of SYNDICATES) {
		const n = stats.bySyndicate[s];
		if (n) chip(`${s} ${n}`, `chrono-synd-${s.toLowerCase()} chrono-chip-synd`);
	}
	if (stats.mainCount) chip(`avg ${stats.averageCost.toFixed(2)}`);
	return row;
}

export function renderIssues(parent: HTMLElement, issues: DeckIssue[], extraErrors: string[] = []): HTMLElement | null {
	if (!issues.length && !extraErrors.length) return null;
	const box = parent.createDiv({ cls: "chrono-deck-issues" });
	for (const msg of extraErrors) box.createDiv({ cls: "chrono-issue is-error", text: `⚠ ${msg}` });
	for (const i of issues) {
		box.createDiv({ cls: `chrono-issue is-${i.level}`, text: `${i.level === "error" ? "✕" : "⚠"} ${i.message}` });
	}
	return box;
}

async function copy(text: string, what: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		new Notice(`ChronoCCG: ${what} copied to clipboard.`);
	} catch (err) {
		new Notice(`ChronoCCG: could not copy (${(err as Error).message}).`);
	}
}

export async function copyDeckCode(deck: Deck): Promise<void> {
	try {
		await copy(deckCode(deck), "deck code");
	} catch (err) {
		new Notice(`ChronoCCG: cannot build a deck code — ${(err as Error).message}`);
	}
}

/** "Export ▾" menu with every supported format. */
export function showExportMenu(plugin: ChronoCCGPlugin, deck: Deck, evt: MouseEvent): void {
	const menu = new Menu();
	menu.addItem((i) => i.setTitle("Copy deck code").setIcon("copy").onClick(() => copyDeckCode(deck)));
	menu.addItem((i) =>
		i.setTitle("Copy as markdown table").setIcon("table").onClick(() => copy(toMarkdownTable(deck, plugin.cards), "markdown table")),
	);
	menu.addItem((i) =>
		i.setTitle("Copy as text list").setIcon("list").onClick(() => copy(toPlainList(deck, plugin.cards), "text list")),
	);
	menu.addItem((i) => i.setTitle("Copy as JSON").setIcon("braces").onClick(() => copy(toJson(deck, plugin.cards), "JSON")));
	menu.addItem((i) =>
		i.setTitle("Copy as chrono-deck block").setIcon("code").onClick(() => copy(toCodeBlock(deck, plugin.cards), "deck block")),
	);
	menu.showAtMouseEvent(evt);
}

export interface DeckRowOptions {
	count?: number;
	badge?: string;
	onAdd?: () => void;
	onRemove?: () => void;
	/** Highlight the row as violating a rule. */
	invalid?: boolean;
}

/** List row for a card reference that doesn't match any card. */
export function renderUnknownDeckRow(
	parent: HTMLElement,
	label: string,
	opts: Pick<DeckRowOptions, "count" | "badge" | "onRemove"> = {},
): HTMLElement {
	const row = parent.createDiv({ cls: ["chrono-deck-row", "chrono-synd-none", "is-unknown"], attr: { "aria-label": UNKNOWN_CARD_HINT } });
	row.createSpan({ cls: "chrono-row-cost", text: "?" });
	row.createSpan({ cls: "chrono-row-name", text: label });
	row.createSpan({ cls: "chrono-row-type", text: "Unknown" });
	if (opts.badge) row.createSpan({ cls: "chrono-row-badge", text: opts.badge });
	if (opts.onRemove) {
		const b = row.createEl("button", { cls: "clickable-icon chrono-row-btn", attr: { "aria-label": "Remove one" } });
		setIcon(b, "minus");
		b.addEventListener("click", (e) => {
			e.stopPropagation();
			opts.onRemove?.();
		});
	}
	if (opts.count !== undefined) row.createSpan({ cls: "chrono-row-count", text: `×${opts.count}` });
	return row;
}

/** Compact "cost | name | ×n" row used by list views and the deck builder. */
export function renderDeckRow(plugin: ChronoCCGPlugin, parent: HTMLElement, card: Card, opts: DeckRowOptions = {}): HTMLElement {
	const row = parent.createDiv({ cls: ["chrono-deck-row", syndicateClass(card)] });
	if (opts.invalid) row.addClass("is-invalid");
	row.createSpan({ cls: "chrono-row-cost", text: String(card.cost) });
	const name = row.createSpan({ cls: "chrono-row-name", text: card.name });
	attachCardPreview(plugin, name, card, { tapToOpen: true });
	row.createSpan({ cls: "chrono-row-type", text: card.spellSpeed ?? card.type });
	if (opts.badge) row.createSpan({ cls: "chrono-row-badge", text: opts.badge });
	if (opts.onRemove) {
		const b = row.createEl("button", { cls: "clickable-icon chrono-row-btn", attr: { "aria-label": "Remove one" } });
		setIcon(b, "minus");
		b.addEventListener("click", (e) => {
			e.stopPropagation();
			opts.onRemove?.();
		});
	}
	if (opts.count !== undefined) row.createSpan({ cls: "chrono-row-count", text: `×${opts.count}` });
	if (opts.onAdd) {
		const b = row.createEl("button", { cls: "clickable-icon chrono-row-btn", attr: { "aria-label": "Add one" } });
		setIcon(b, "plus");
		b.addEventListener("click", (e) => {
			e.stopPropagation();
			opts.onAdd?.();
		});
	}
	return row;
}
