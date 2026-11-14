import { debounce, ItemView, Notice, Platform, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { POOL_COST_MAX, poolCards, poolCardState, poolScopeKey } from "../data/BuilderPool";
import { decodeDeck } from "../data/DeckCodec";
import { sortEntries, toCodeBlock } from "../data/DeckExport";
import { deckStats, DIVER_COUNT, isDiverEligible, MAIN_DECK_SIZE, MAX_COPIES, validateDeck } from "../data/DeckRules";
import { logDeckChange } from "../data/deckChangelog";
import { findFirstDeckBlock, locateDeckBlock, unwrapDeckCode } from "../data/deckInput";
import { Card, Deck, Syndicate, SYNDICATES } from "../data/types";
import { attachCardPreview, CardDetailModal } from "./CardPreview";
import { renderCardTile } from "./CardTile";
import { copyDeckCode, renderCurve, renderDeckChips, renderDeckRow, renderIssues, renderUnknownDeckRow, showExportMenu } from "./DeckWidgets";
import { TextPromptModal } from "./TextPromptModal";
import { parseDeck } from "../markdown/DeckCodeBlock";
import { updateDeckNoteProperties } from "../templates/DeckNoteSync";
import { today } from "../templates/Templates";
import { imageCache } from "../utils/ImageCache";

export const VIEW_TYPE_DECK_BUILDER = "chronoccg-deck-builder";

/** Where the deck being edited came from, so "Save" can write it back. */
export interface DeckSourceLink {
	path: string;
	lineStart: number;
	lineEnd: number;
	/** Block content when it was opened or last saved, to find it again if the note changed above it. */
	body?: string;
}

export interface BuilderDraft {
	deck: Deck;
	source?: DeckSourceLink;
}

export function emptyDeck(): Deck {
	return { name: "", divers: [], entries: [] };
}

/** A card shown in the pool, kept so deck edits can update it in place. */
interface PoolTile {
	card: Card;
	tile: HTMLElement;
	badge: HTMLElement | null;
	/** Hidden once the card is a Diver. */
	diverEl: HTMLElement | null;
	state: string;
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
	private poolTiles: PoolTile[] = [];
	/** {@link poolScopeKey} the pool was last rendered for. */
	private poolScope = "";

	private persist = debounce(() => void this.plugin.saveSettings(), 400, true);
	private renderPoolSoon = debounce(() => this.renderPool(), 150, true);

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

	/** Re-render both panes, e.g. after the card data changed. */
	refresh(): void {
		if (!this.poolEl) return;
		this.renderPool();
		this.renderDeck();
		this.updateHeader();
	}

	private updateHeader(): void {
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

	/** After a deck edit: the pool is only rebuilt when the cards it shows change. */
	private changed(): void {
		this.persist();
		if (!this.poolEl) return;
		this.renderDeck();
		if (poolScopeKey(this.deck, this.plugin.cards, this.onlyPlayable) !== this.poolScope) this.renderPool();
		else for (const t of this.poolTiles) this.updatePoolTile(t);
		this.updateHeader();
	}

	// ---- card pool -------------------------------------------------------

	private renderPoolToolbar(pool: HTMLElement): void {
		const bar = pool.createDiv({ cls: "chrono-builder-toolbar" });
		const search = bar.createEl("input", { type: "search", cls: "chrono-browser-search", placeholder: "Search name, keyword, type, 2/3…" });
		search.addEventListener("input", () => {
			this.query = search.value;
			this.renderPoolSoon();
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
		for (let c = 0; c <= POOL_COST_MAX; c++) {
			const b = costRow.createEl("button", {
				cls: "chrono-filter-chip chrono-cost-chip",
				text: c === POOL_COST_MAX ? `${c}+` : String(c),
			});
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
		imageCache.forget(this.poolEl);
		this.poolEl.empty();
		this.poolTiles = [];
		this.poolScope = poolScopeKey(this.deck, this.plugin.cards, this.onlyPlayable);
		const cards = poolCards(this.plugin.cards, this.deck, {
			query: this.query,
			syndicates: this.poolSyndicates,
			type: this.poolType,
			cost: this.poolCost,
			onlyPlayable: this.onlyPlayable,
		});

		const shown = cards.slice(0, 300);
		const howTo = Platform.isMobile ? "tap to add, ⓘ for details" : "click to add";
		this.poolStatusEl.setText(
			`${cards.length} cards${cards.length > shown.length ? ` (showing ${shown.length})` : ""} • ${howTo}, “Diver” to set as Diver`,
		);
		if (this.plugin.cards.size <= 1) {
			this.poolStatusEl.setText('No card data yet — run "ChronoCCG: Refresh card database".');
		}

		for (const card of shown) this.poolTiles.push(this.renderPoolTile(card));
	}

	private renderPoolTile(card: Card): PoolTile {
		const tile = renderCardTile(this.poolEl, card, this.plugin.settings, { size: "thumb" });
		tile.addClass("chrono-builder-card");
		attachCardPreview(this.plugin, tile.querySelector(".chrono-card-tile-visual") as HTMLElement, card);
		tile.addEventListener("click", () => this.addCard(card, false));
		tile.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			this.removeOne(card.id);
		});
		const t: PoolTile = { card, tile, badge: null, diverEl: null, state: "" };
		const canDive = isDiverEligible(card);
		if (canDive || Platform.isMobile) {
			const actions = tile.createDiv({ cls: "chrono-builder-card-actions" });
			if (canDive) {
				const b = actions.createEl("button", { cls: "chrono-builder-diver-btn", text: "Diver" });
				b.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.addCard(card, true);
				});
				// On desktop the button is the only action, so hide the whole row with it.
				t.diverEl = Platform.isMobile ? b : actions;
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
		this.updatePoolTile(t);
		return t;
	}

	/** Copy count / Diver badge and the "Diver" button of one pool card. */
	private updatePoolTile(t: PoolTile): void {
		const { count, isDiver, maxed } = poolCardState(this.deck, t.card.id);
		const state = `${count}|${isDiver}`;
		if (state === t.state) return;
		t.state = state;
		t.badge?.remove();
		t.badge = isDiver
			? t.tile.createDiv({ cls: "chrono-builder-incount is-diver", text: "Diver" })
			: count
				? t.tile.createDiv({ cls: "chrono-builder-incount", text: `${count}/${MAX_COPIES}` })
				: null;
		t.tile.toggleClass("is-maxed", maxed);
		t.diverEl?.toggle(!isDiver);
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
		const block = toCodeBlock(this.deck, this.plugin.cards).replace(/\n$/, "").split("\n");
		const src = this.draft.source;
		if (src) {
			const file = this.app.vault.getAbstractFileByPath(src.path);
			if (file instanceof TFile) {
				let ok = false;
				let isFirstBlock = false;
				let logged = false;
				await this.app.vault.process(file, (text) => {
					const lines = text.split("\n");
					const range = locateDeckBlock(lines, src);
					if (!range) return text;
					isFirstBlock = findFirstDeckBlock(lines)?.start === range.start;
					const before = parseDeck(this.plugin, lines.slice(range.start + 1, range.end).join("\n"));
					lines.splice(range.start, range.end - range.start + 1, ...block);
					src.lineStart = range.start;
					src.lineEnd = range.start + block.length - 1;
					src.body = block.slice(1, -1).join("\n");
					ok = true;
					const saved = lines.join("\n");
					if (!isFirstBlock || !this.plugin.settings.deckChangelog) return saved;
					const withLog = logDeckChange(saved, before, this.deck, this.plugin.cards, today());
					logged = withLog !== saved;
					return withLog;
				});
				if (ok) {
					this.persist();
					const updated: string[] = [];
					if (isFirstBlock) {
						try {
							updated.push(...(await updateDeckNoteProperties(this.plugin, file, this.deck)));
						} catch (err) {
							new Notice(`ChronoCCG: could not update the note properties — ${(err as Error).message}`);
						}
					}
					if (logged) updated.push("changelog");
					new Notice(`ChronoCCG: saved deck to ${src.path}${updated.length ? ` (updated ${updated.join(", ")})` : ""}.`);
					return;
				}
				new Notice("ChronoCCG: the original deck block is gone — saving as a new note instead.");
			}
		}
		const file = await this.plugin.templates.createDeckNote(this.deck);
		if (file) {
			const lines = (await this.app.vault.read(file)).split("\n");
			const range = findFirstDeckBlock(lines);
			if (range) {
				const body = lines.slice(range.start + 1, range.end).join("\n");
				this.draft.source = { path: file.path, lineStart: range.start, lineEnd: range.end, body };
			}
			this.changed();
		}
	}
}
