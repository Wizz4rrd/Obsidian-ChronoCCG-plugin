import { debounce, ItemView, Notice, Platform, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { decodeDeck } from "../data/DeckCodec";
import { sortEntries, toCodeBlock } from "../data/DeckExport";
import { allowedSyndicates, deckStats, DIVER_COUNT, isDiverEligible, MAIN_DECK_SIZE, MAX_COPIES, validateDeck } from "../data/DeckRules";
import { unwrapDeckCode } from "../data/deckInput";
import { Card, Deck, Syndicate, SYNDICATES } from "../data/types";
import { attachCardPreview, CardDetailModal } from "./CardPreview";
import { renderCardTile } from "./CardTile";
import { copyDeckCode, renderCurve, renderDeckChips, renderDeckRow, renderIssues, renderUnknownDeckRow, showExportMenu } from "./DeckWidgets";
import { TextPromptModal } from "./TextPromptModal";

export const VIEW_TYPE_DECK_BUILDER = "chronoccg-deck-builder";

/** Where the deck being edited came from, so "Save" can write it back. */
export interface DeckSourceLink {
	path: string;
	lineStart: number;
	lineEnd: number;
}

export interface BuilderDraft {
	deck: Deck;
	source?: DeckSourceLink;
}

export function emptyDeck(): Deck {
	return { name: "", divers: [], entries: [] };
}

export class DeckBuilderView extends ItemView {
	private query = "";
	private poolSyndicates = new Set<Syndicate>();
	private poolType = "";
	private poolCost: number | null = null;
	private onlyPlayable = true;

	private poolEl!: HTMLElement;
	private poolStatusEl!: HTMLElement;
	private deckEl!: HTMLElement;
	private syndicateBtns = new Map<Syndicate, HTMLElement>();

	private persist = debounce(() => void this.plugin.saveSettings(), 400, true);

	constructor(leaf: WorkspaceLeaf, private plugin: ChronoCCGPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_DECK_BUILDER;
	}

	getDisplayText(): string {
		const name = this.draft.deck.name;
		return name ? `Deck: ${name}` : "ChronoCCG deck builder";
	}

	getIcon(): string {
		return "swords";
	}

	private get draft(): BuilderDraft {
		return this.plugin.settings.builderDraft;
	}

	private get deck(): Deck {
		return this.draft.deck;
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("chrono-builder");

		const pool = root.createDiv({ cls: "chrono-builder-pool" });
		this.renderPoolToolbar(pool);
		this.poolStatusEl = pool.createDiv({ cls: "chrono-browser-status" });
		this.poolEl = pool.createDiv({ cls: "chrono-builder-pool-grid" });

		this.deckEl = root.createDiv({ cls: "chrono-builder-deck" });
		this.refresh();
	}

	async onClose(): Promise<void> {
		await this.plugin.saveSettings();
	}

	/** Re-render both panes (cheap: a few hundred cards). */
	refresh(): void {
		if (!this.poolEl) return;
		this.renderPool();
		this.renderDeck();
		(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
	}

	// ---- public mutations (also used by commands / other views) -----------

	loadDraft(draft: BuilderDraft): void {
		this.plugin.settings.builderDraft = draft;
		this.changed();
	}

	addCard(card: Card, asDiver: boolean): void {
		if (card.collectible === false) return void new Notice(`${card.name} can't be put in a deck.`);
		if (asDiver) {
			if (!isDiverEligible(card)) return void new Notice(`${card.name} cannot be a Diver (Agents only).`);
			if (this.deck.divers.includes(card.id)) return;
			if (this.deck.divers.length >= DIVER_COUNT) {
				return void new Notice(`You already have ${DIVER_COUNT} Divers — remove one first.`);
			}
			this.deck.divers.push(card.id);
			this.deck.entries = this.deck.entries.filter((e) => e.id !== card.id);
		} else {
			if (this.deck.divers.includes(card.id)) return void new Notice(`${card.name} is one of your Divers.`);
			const entry = this.deck.entries.find((e) => e.id === card.id);
			if ((entry?.count ?? 0) >= MAX_COPIES) return void new Notice(`Max ${MAX_COPIES} copies of ${card.name}.`);
			if (deckStats(this.deck, this.plugin.cards).mainCount >= MAIN_DECK_SIZE) {
				return void new Notice(`Main deck is full (${MAIN_DECK_SIZE}).`);
			}
			if (entry) entry.count++;
			else this.deck.entries.push({ id: card.id, count: 1 });
		}
		this.changed();
	}

	private removeOne(id: number): void {
		const entry = this.deck.entries.find((e) => e.id === id);
		if (!entry) return;
		entry.count--;
		if (entry.count <= 0) this.deck.entries = this.deck.entries.filter((e) => e !== entry);
		this.changed();
	}

	private removeDiver(id: number): void {
		this.deck.divers = this.deck.divers.filter((d) => d !== id);
		this.changed();
	}

	private changed(): void {
		this.persist();
		this.refresh();
	}

	// ---- card pool -------------------------------------------------------

	private renderPoolToolbar(pool: HTMLElement): void {
		const bar = pool.createDiv({ cls: "chrono-builder-toolbar" });
		const search = bar.createEl("input", { type: "search", cls: "chrono-browser-search", placeholder: "Search name, keyword, type, 2/3…" });
		search.addEventListener("input", () => {
			this.query = search.value;
			this.renderPool();
		});

		const chips = bar.createDiv({ cls: "chrono-filter-chips" });
		for (const s of SYNDICATES) {
			const b = chips.createEl("button", { cls: `chrono-filter-chip chrono-synd-${s.toLowerCase()}`, text: s });
			this.syndicateBtns.set(s, b);
			b.addEventListener("click", () => {
				if (this.poolSyndicates.has(s)) this.poolSyndicates.delete(s);
				else this.poolSyndicates.add(s);
				b.toggleClass("is-active", this.poolSyndicates.has(s));
				this.renderPool();
			});
		}

		const row = bar.createDiv({ cls: "chrono-filter-chips" });
		for (const t of ["Agent", "Action"]) {
			const b = row.createEl("button", { cls: "chrono-filter-chip", text: `${t}s` });
			b.addEventListener("click", () => {
				this.poolType = this.poolType === t ? "" : t;
				row.querySelectorAll(".chrono-filter-chip[data-type]").forEach((el) => el.removeClass("is-active"));
				b.toggleClass("is-active", this.poolType === t);
				this.renderPool();
			});
			b.dataset.type = t;
		}
		const costRow = bar.createDiv({ cls: "chrono-filter-chips chrono-cost-chips" });
		for (let c = 0; c <= 7; c++) {
			const b = costRow.createEl("button", { cls: "chrono-filter-chip chrono-cost-chip", text: c === 7 ? "7+" : String(c) });
			b.addEventListener("click", () => {
				this.poolCost = this.poolCost === c ? null : c;
				costRow.querySelectorAll(".chrono-cost-chip").forEach((el) => el.removeClass("is-active"));
				b.toggleClass("is-active", this.poolCost === c);
				this.renderPool();
			});
		}

		const toggle = bar.createEl("label", { cls: "chrono-builder-toggle" });
		const cb = toggle.createEl("input", { type: "checkbox" });
		cb.checked = this.onlyPlayable;
		toggle.appendText(" Only cards playable with my Divers");
		cb.addEventListener("change", () => {
			this.onlyPlayable = cb.checked;
			this.renderPool();
		});
	}

	private renderPool(): void {
		this.poolEl.empty();
		const allowed = allowedSyndicates(this.deck, this.plugin.cards);
		const restrict = this.onlyPlayable && this.deck.divers.length >= DIVER_COUNT && allowed.size > 0;
		const syndicates = this.poolSyndicates.size ? Array.from(this.poolSyndicates) : restrict ? Array.from(allowed) : undefined;
		let cards = this.plugin.cards.search(
			{
				text: this.query || undefined,
				syndicates,
				types: this.poolType ? [this.poolType] : undefined,
				minCost: this.poolCost ?? undefined,
				maxCost: this.poolCost === null || this.poolCost === 7 ? undefined : this.poolCost,
			},
			2000,
		);
		if (restrict) cards = cards.filter((c) => c.syndicates.some((s) => allowed.has(s)));
		cards = cards.filter((c) => c.collectible !== false).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));

		const shown = cards.slice(0, 300);
		const howTo = Platform.isMobile ? "tap to add, ⓘ for details" : "click to add";
		this.poolStatusEl.setText(
			`${cards.length} cards${cards.length > shown.length ? ` (showing ${shown.length})` : ""} • ${howTo}, “Diver” to set as Diver`,
		);
		if (this.plugin.cards.size <= 1) {
			this.poolStatusEl.setText('No card data yet — run "ChronoCCG: Refresh card database".');
		}

		const counts = new Map(this.deck.entries.map((e) => [e.id, e.count]));
		for (const card of shown) {
			const tile = renderCardTile(this.poolEl, card, this.plugin.settings, { size: "thumb" });
			tile.addClass("chrono-builder-card");
			const inDeck = counts.get(card.id) ?? 0;
			const isDiver = this.deck.divers.includes(card.id);
			if (inDeck) tile.createDiv({ cls: "chrono-builder-incount", text: `${inDeck}/${MAX_COPIES}` });
			if (isDiver) tile.createDiv({ cls: "chrono-builder-incount is-diver", text: "Diver" });
			if (inDeck >= MAX_COPIES || isDiver) tile.addClass("is-maxed");
			attachCardPreview(this.plugin, tile.querySelector(".chrono-card-tile-visual") as HTMLElement, card);
			tile.addEventListener("click", () => this.addCard(card, false));
			tile.addEventListener("contextmenu", (evt) => {
				evt.preventDefault();
				this.removeOne(card.id);
			});
			const canDive = isDiverEligible(card) && !isDiver;
			if (!canDive && !Platform.isMobile) continue;
			const actions = tile.createDiv({ cls: "chrono-builder-card-actions" });
			if (canDive) {
				const b = actions.createEl("button", { cls: "chrono-builder-diver-btn", text: "Diver" });
				b.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.addCard(card, true);
				});
			}
			// No hover preview on touch screens, and tapping the tile adds the card.
			if (Platform.isMobile) {
				const info = actions.createEl("button", { cls: "clickable-icon chrono-builder-info-btn", attr: { "aria-label": "Card details" } });
				setIcon(info, "info");
				info.addEventListener("click", (evt) => {
					evt.stopPropagation();
					new CardDetailModal(this.app, this.plugin, card).open();
				});
			}
		}
	}

	// ---- deck pane ---------------------------------------------------------

	private renderDeck(): void {
		const el = this.deckEl;
		el.empty();
		const deck = this.deck;

		const head = el.createDiv({ cls: "chrono-builder-head" });
		const name = head.createEl("input", { type: "text", cls: "chrono-builder-name", placeholder: "Deck name" });
		name.value = deck.name;
		name.addEventListener("change", () => {
			deck.name = name.value.trim();
			this.changed();
		});

		const actions = head.createDiv({ cls: "chrono-deck-actions" });
		const action = (icon: string, label: string, fn: (evt: MouseEvent) => void) => {
			const b = actions.createEl("button", { cls: "clickable-icon chrono-icon-btn", attr: { "aria-label": label } });
			setIcon(b, icon);
			b.addEventListener("click", fn);
		};
		action("save", this.draft.source ? `Save to ${this.draft.source.path}` : "Save as new note", () => void this.save());
		action("copy", "Copy deck code", () => void copyDeckCode(deck));
		action("share", "Export…", (evt) => showExportMenu(this.plugin, deck, evt));
		action("download", "Import deck code", () => this.importCode());
		action("trash-2", "Clear deck", () => {
			this.loadDraft({ deck: emptyDeck() });
		});

		if (this.draft.source) {
			const link = el.createDiv({ cls: "chrono-builder-source" });
			link.appendText("Editing block in ");
			const a = link.createEl("a", { text: this.draft.source.path, href: "#" });
			a.addEventListener("click", (e) => {
				e.preventDefault();
				void this.app.workspace.openLinkText(this.draft.source!.path, "", false);
			});
			const detach = link.createEl("a", { text: "detach", href: "#", cls: "chrono-builder-detach" });
			detach.addEventListener("click", (e) => {
				e.preventDefault();
				this.draft.source = undefined;
				this.changed();
			});
		}

		const stats = deckStats(deck, this.plugin.cards);
		const issues = validateDeck(deck, this.plugin.cards);
		renderDeckChips(el, deck, stats, !issues.some((i) => i.level === "error"));
		renderCurve(el, stats);

		el.createEl("h5", { text: `Divers (${deck.divers.length}/${DIVER_COUNT})` });
		const divers = el.createDiv({ cls: "chrono-deck-list" });
		for (const id of deck.divers) {
			const card = this.plugin.cards.getById(id);
			if (!card) {
				renderUnknownDeckRow(divers, `#${id}`, { badge: "Diver", onRemove: () => this.removeDiver(id) });
				continue;
			}
			renderDeckRow(this.plugin, divers, card, { badge: "Diver", onRemove: () => this.removeDiver(id) });
		}
		for (let i = deck.divers.length; i < DIVER_COUNT; i++) {
			divers.createDiv({ cls: "chrono-deck-row is-empty", text: "Empty Diver slot — use “Diver” on an Agent" });
		}

		el.createEl("h5", { text: `Main deck (${stats.mainCount}/${MAIN_DECK_SIZE})` });
		const list = el.createDiv({ cls: "chrono-deck-list" });
		const badIds = new Set(issues.filter((i) => i.cardId !== undefined && i.level === "error").map((i) => i.cardId));
		for (const e of sortEntries(deck.entries, this.plugin.cards)) {
			const card = this.plugin.cards.getById(e.id);
			if (!card) {
				renderUnknownDeckRow(list, `#${e.id}`, { count: e.count, onRemove: () => this.removeOne(e.id) });
				continue;
			}
			renderDeckRow(this.plugin, list, card, {
				count: e.count,
				invalid: badIds.has(e.id),
				onAdd: () => this.addCard(card, false),
				onRemove: () => this.removeOne(e.id),
			});
		}
		if (!deck.entries.length) {
			const hint = Platform.isMobile ? "Tap cards in the pool to add them." : "Click cards on the left to add them.";
			list.createDiv({ cls: "chrono-deck-row is-empty", text: hint });
		}

		renderIssues(el, issues);
	}

	// ---- import / save -----------------------------------------------------

	private importCode(): void {
		new TextPromptModal(this.app, {
			title: "Import deck code",
			placeholder: "AUGVG33NNZ2X…",
			multiline: true,
			onSubmit: (value) => {
				try {
					const d = decodeDeck(unwrapDeckCode(value));
					if (d.warnings.length) new Notice(`Imported with warnings: ${d.warnings.join(" ")}`);
					this.loadDraft({ deck: { name: d.name, divers: d.divers, entries: d.entries } });
				} catch (err) {
					new Notice(`Invalid deck code: ${(err as Error).message}`);
				}
			},
		}).open();
	}

	private async save(): Promise<void> {
		const block = toCodeBlock(this.deck, this.plugin.cards).replace(/\n$/, "");
		const src = this.draft.source;
		if (src) {
			const file = this.app.vault.getAbstractFileByPath(src.path);
			if (file instanceof TFile) {
				let ok = false;
				await this.app.vault.process(file, (text) => {
					const lines = text.split("\n");
					const start = lines[src.lineStart]?.trim() ?? "";
					const end = lines[src.lineEnd]?.trim() ?? "";
					if (!/^(`{3,}|~{3,})\s*chrono-deck\b/.test(start) || !/^(`{3,}|~{3,})\s*$/.test(end)) return text;
					lines.splice(src.lineStart, src.lineEnd - src.lineStart + 1, ...block.split("\n"));
					src.lineEnd = src.lineStart + block.split("\n").length - 1;
					ok = true;
					return lines.join("\n");
				});
				if (ok) {
					this.persist();
					new Notice(`ChronoCCG: saved deck to ${src.path}.`);
					return;
				}
				new Notice("ChronoCCG: the original deck block moved — saving as a new note instead.");
			}
		}
		const file = await this.plugin.templates.createDeckNote(this.deck);
		if (file) {
			const lines = (await this.app.vault.read(file)).split("\n");
			const lineStart = lines.findIndex((l) => /^```chrono-deck/.test(l.trim()));
			const lineEnd = lines.findIndex((l, i) => i > lineStart && l.trim() === "```");
			if (lineStart >= 0 && lineEnd > lineStart) this.draft.source = { path: file.path, lineStart, lineEnd };
			this.changed();
		}
	}
}
