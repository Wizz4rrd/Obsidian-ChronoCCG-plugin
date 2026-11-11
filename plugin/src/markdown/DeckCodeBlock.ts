import { MarkdownPostProcessorContext, parseYaml, setIcon, TFile } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { sortEntries } from "../data/DeckExport";
import { parseDeckSource, ParsedDeck } from "../data/DeckParser";
import { deckStats, validateDeck } from "../data/DeckRules";
import { Card } from "../data/types";
import { attachCardPreview } from "../ui/CardPreview";
import { renderCardTile, renderUnknownCardTile } from "../ui/CardTile";
import { DeckSourceLink } from "../ui/DeckBuilderView";
import {
	copyDeckCode,
	renderCurve,
	renderDeckChips,
	renderDeckRow,
	renderIssues,
	renderUnknownDeckRow,
	showExportMenu,
} from "../ui/DeckWidgets";

/**
 * ```chrono-deck
 * <deck code>  |  YAML (name / divers / cards)  |  "<count> <id or name>" lines
 * ```
 * See DeckParser for the accepted formats.
 */
export function registerDeckCodeBlock(plugin: ChronoCCGPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor("chrono-deck", (source, el, ctx) => {
		el.empty();
		const deck = parseDeck(plugin, source);
		renderDeck(plugin, el, deck, ctx, source);
	});
}

export function parseDeck(plugin: ChronoCCGPlugin, source: string): ParsedDeck {
	return parseDeckSource(source, (ref) => plugin.cards.getByName(ref)?.id, parseYaml);
}

function renderDeck(
	plugin: ChronoCCGPlugin,
	el: HTMLElement,
	deck: ParsedDeck,
	ctx: MarkdownPostProcessorContext,
	source: string,
): void {
	const root = el.createDiv({ cls: "chrono-deck-block" });
	const header = root.createDiv({ cls: "chrono-deck-header" });
	header.createEl("h4", { text: deck.name || "Deck" });

	const actions = header.createDiv({ cls: "chrono-deck-actions" });
	const action = (icon: string, label: string, fn: (evt: MouseEvent) => void) => {
		const b = actions.createEl("button", { cls: "clickable-icon chrono-icon-btn", attr: { "aria-label": label } });
		setIcon(b, icon);
		b.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			fn(evt);
		});
	};
	let view = plugin.settings.deckView;
	action("layout-grid", "Toggle grid / list", () => {
		view = view === "grid" ? "list" : "grid";
		renderBody();
	});
	action("copy", "Copy deck code", () => void copyDeckCode(deck));
	action("share", "Export…", (evt) => showExportMenu(plugin, deck, evt));
	action("pencil", "Edit in deck builder", () => {
		void (async () => {
			const link = await locateBlock(plugin, el, ctx, source);
			await plugin.openDeckInBuilder(deck, link);
		})();
	});

	if (plugin.cards.size <= 1) {
		root.createDiv({ cls: "chrono-deck-hint", text: 'Card database not loaded yet — run "ChronoCCG: Refresh card database".' });
	}

	const stats = deckStats(deck, plugin.cards);
	const issues = validateDeck(deck, plugin.cards);
	renderDeckChips(root, deck, stats, !issues.some((i) => i.level === "error"));
	renderIssues(root, issues, deck.errors);

	const body = root.createDiv({ cls: "chrono-deck-body" });
	const renderBody = () => {
		body.empty();
		body.toggleClass("is-list", view === "list");
		const put = (parent: HTMLElement, card: Card, count?: number, badge?: string) => {
			if (view === "list") renderDeckRow(plugin, parent, card, { count, badge });
			else tile(plugin, parent, card, count);
		};
		const putUnknown = (parent: HTMLElement, label: string, count?: number, badge?: string) => {
			if (view === "list") renderUnknownDeckRow(parent, label, { count, badge });
			else renderUnknownCardTile(parent, label, { deckCount: count, badge });
		};
		const unknownDivers = deck.unknown.filter((u) => u.diver);
		const container = (cls = "") => body.createDiv({ cls: `${view === "list" ? "chrono-deck-list" : "chrono-deck-grid"} ${cls}`.trim() });

		const diverCount = deck.divers.length + unknownDivers.length;
		if (diverCount) {
			body.createEl("h5", { text: `Divers (${diverCount})` });
			const grid = container("chrono-deck-divers");
			for (const id of deck.divers) {
				const card = plugin.cards.getById(id);
				if (card) put(grid, card, undefined, "Diver");
				else putUnknown(grid, `#${id}`, undefined, "Diver");
			}
			for (const u of unknownDivers) putUnknown(grid, u.ref, undefined, "Diver");
		}

		const groups: Record<string, Array<{ card: Card; count: number }>> = {};
		const unknown: Array<{ label: string; count: number }> = [];
		for (const e of sortEntries(deck.entries, plugin.cards)) {
			const card = plugin.cards.getById(e.id);
			if (card) (groups[card.type] ??= []).push({ card, count: e.count });
			else unknown.push({ label: `#${e.id}`, count: e.count });
		}
		for (const u of deck.unknown) if (!u.diver) unknown.push({ label: u.ref, count: u.count });
		for (const g of Object.keys(groups).sort()) {
			body.createEl("h5", { text: `${g}s (${groups[g].reduce((s, e) => s + e.count, 0)})` });
			const grid = container();
			for (const e of groups[g]) put(grid, e.card, e.count);
		}
		if (unknown.length) {
			body.createEl("h5", { text: `Unknown cards (${unknown.reduce((s, e) => s + e.count, 0)})` });
			const grid = container();
			for (const u of unknown) putUnknown(grid, u.label, u.count);
		}
	};
	renderBody();

	if (stats.mainCount) {
		const foot = root.createDiv({ cls: "chrono-deck-footer" });
		foot.createDiv({ cls: "chrono-deck-footer-title", text: "Energy curve" });
		renderCurve(foot, stats);
	}
}

function tile(plugin: ChronoCCGPlugin, parent: HTMLElement, card: Card, count?: number): void {
	const t = renderCardTile(parent, card, plugin.settings, { size: "thumb", deckCount: count });
	t.addClass("is-clickable");
	attachCardPreview(plugin, t, card, { tapToOpen: true });
}

/**
 * Find this block's line range so the builder can write back to it.
 * Reading view gives us section info; Live Preview often doesn't, so fall back
 * to searching the file for a chrono-deck block with the same body.
 */
async function locateBlock(
	plugin: ChronoCCGPlugin,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	source: string,
): Promise<DeckSourceLink | undefined> {
	const section = ctx.getSectionInfo(el);
	if (section) return { path: ctx.sourcePath, lineStart: section.lineStart, lineEnd: section.lineEnd };
	const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(file instanceof TFile)) return undefined;
	const lines = (await plugin.app.vault.cachedRead(file)).split("\n");
	const want = source.trim();
	for (let i = 0; i < lines.length; i++) {
		if (!/^(`{3,}|~{3,})\s*chrono-deck\b/.test(lines[i].trim())) continue;
		const end = lines.findIndex((l, j) => j > i && /^(`{3,}|~{3,})\s*$/.test(l.trim()));
		if (end < 0) break;
		if (lines.slice(i + 1, end).join("\n").trim() === want) return { path: file.path, lineStart: i, lineEnd: end };
		i = end;
	}
	return undefined;
}
