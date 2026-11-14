import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { CardRepository } from "./src/data/CardRepository";
import { DataSync } from "./src/data/DataSync";
import { SEED_DATABASE } from "./src/data/cards.seed";
import { Card, Deck } from "./src/data/types";
import { CardBrowserPlacement, ChronoSettings, ChronoSettingsTab, DEFAULT_SETTINGS } from "./src/settings/SettingsTab";
import { registerCardCodeBlock } from "./src/markdown/CardCodeBlock";
import { parseDeck, registerDeckCodeBlock } from "./src/markdown/DeckCodeBlock";
import { findDeckBlockAt, findFirstDeckBlock } from "./src/data/deckInput";
import { registerInlineCardRefs } from "./src/markdown/InlineCardRef";
import { registerDecksBasesView } from "./src/bases/DecksBasesView";
import { CardBrowserView, VIEW_TYPE_CARD_BROWSER } from "./src/ui/CardBrowserView";
import { CardDetailModal, removeCardPopovers } from "./src/ui/CardPreview";
import { CardSuggestModal } from "./src/ui/CardSuggestModal";
import { DeckBuilderView, DeckSourceLink, emptyDeck, VIEW_TYPE_DECK_BUILDER } from "./src/ui/DeckBuilderView";
import { ConfirmModal } from "./src/ui/ConfirmModal";
import { copyDeckCode } from "./src/ui/DeckWidgets";
import { ImportDeckModal } from "./src/ui/ImportDeckModal";
import { TextPromptModal } from "./src/ui/TextPromptModal";
import { imageCache } from "./src/utils/ImageCache";
import { cardImageUrls } from "./src/utils/imageUrl";
import { deckNoteFrontmatter, firstDeckBlockLink, updateDeckNoteProperties } from "./src/templates/DeckNoteSync";
import { DEFAULT_TEMPLATES, NoteTemplates, TEMPLATE_FILE_NAMES, TemplateKind, TournamentDeck } from "./src/templates/Templates";
import { TournamentModal, TournamentOptions } from "./src/ui/TournamentModal";

export default class ChronoCCGPlugin extends Plugin {
	settings!: ChronoSettings;
	cards = new CardRepository();
	sync!: DataSync;
	templates = new NoteTemplates(this);

	async onload(): Promise<void> {
		const migratedFromRuneterra = await this.loadSettings();
		this.sync = new DataSync(this);
		imageCache.init(this);
		// Images cached from runeterra.ar are never used again.
		if (migratedFromRuneterra) await imageCache.clear();

		// 1) seed first so things work offline
		this.cards.load(SEED_DATABASE);

		// 2) try cache, then optionally auto-refresh
		const cached = await this.sync.readCache();
		if (cached) this.cards.load(cached);
		// Card data cached from runeterra.ar (no rules text) is replaced as soon as possible.
		const legacyCache = cached?.source === "runeterra.ar" && this.settings.dataSource === "official";

		this.addSettingTab(new ChronoSettingsTab(this.app, this));

		// Markdown rendering
		registerCardCodeBlock(this);
		registerDeckCodeBlock(this);
		registerInlineCardRefs(this);
		registerDecksBasesView(this);

		// Views
		this.registerView(VIEW_TYPE_CARD_BROWSER, (leaf: WorkspaceLeaf) => new CardBrowserView(leaf, this));
		this.registerView(VIEW_TYPE_DECK_BUILDER, (leaf: WorkspaceLeaf) => new DeckBuilderView(leaf, this));

		this.addRibbonIcon("layers", "ChronoCCG: Open card browser", () => this.activateCardBrowser());
		this.addRibbonIcon("swords", "ChronoCCG: Open deck builder", () => this.activateDeckBuilder());

		this.registerCommands();

		// Auto-refresh if stale (after layout is ready so startup stays fast).
		// Without a cache only the placeholder seed is loaded, so report failures.
		this.app.workspace.onLayoutReady(() => {
			if (legacyCache || this.shouldAutoRefresh()) {
				this.refreshCardDatabase(true, !cached || legacyCache).catch(() => {});
			} else if (!cached && this.settings.dataSource !== "bundled") {
				this.notifyNoCardData();
			}
		});
	}

	onunload(): void {
		removeCardPopovers();
		imageCache.destroy();
	}

	private registerCommands(): void {
		this.addCommand({
			id: "open-card-browser",
			name: "Open card browser",
			callback: () => this.activateCardBrowser(),
		});

		this.addCommand({
			id: "open-deck-builder",
			name: "Open deck builder",
			callback: () => this.activateDeckBuilder(),
		});

		this.addCommand({
			id: "new-deck-in-builder",
			name: "Start a new deck in the builder",
			callback: () => this.newDeckInBuilder(),
		});

		this.addCommand({
			id: "save-builder-deck",
			name: "Save deck in builder",
			checkCallback: (checking) => {
				const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_DECK_BUILDER)[0]?.view;
				if (!(view instanceof DeckBuilderView)) return false;
				if (!checking) void view.save();
				return true;
			},
		});

		this.addCommand({
			id: "refresh-database",
			name: "Refresh card database",
			callback: () => this.refreshCardDatabase(),
		});

		this.addCommand({
			id: "import-deck-code",
			name: "Import deck from code…",
			callback: () => new ImportDeckModal(this.app, this).open(),
		});

		this.addCommand({
			id: "edit-deck-under-cursor",
			name: "Edit deck block in builder",
			editorCheckCallback: (checking, editor, ctx) => {
				const range = findDeckBlockAt(editor.getValue().split("\n"), editor.getCursor().line);
				if (!range || !ctx.file) return false;
				if (!checking) {
					const lines = editor.getValue().split("\n");
					const body = lines.slice(range.start + 1, range.end).join("\n");
					void this.openDeckInBuilder(parseDeck(this, body), { path: ctx.file.path, lineStart: range.start, lineEnd: range.end, body });
				}
				return true;
			},
		});

		this.addCommand({
			id: "copy-deck-code",
			name: "Copy deck code",
			editorCheckCallback: (checking, editor) => {
				const lines = editor.getValue().split("\n");
				const range = findDeckBlockAt(lines, editor.getCursor().line) ?? findFirstDeckBlock(lines);
				if (!range) return false;
				if (!checking) void copyDeckCode(parseDeck(this, lines.slice(range.start + 1, range.end).join("\n")));
				return true;
			},
		});

		this.addCommand({
			id: "update-deck-note-properties",
			name: "Update deck note properties",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !deckNoteFrontmatter(this.app, file)) return false;
				if (!checking) void this.updateDeckNote(file);
				return true;
			},
		});

		this.addCommand({
			id: "insert-card-reference",
			name: "Insert inline card reference…",
			editorCallback: (editor) =>
				new CardSuggestModal(this.app, this, (card) => editor.replaceSelection(`\`chrono:${card.name}\``)).open(),
		});

		this.addCommand({
			id: "insert-card-block",
			name: "Insert card image block…",
			editorCallback: (editor) =>
				new CardSuggestModal(this.app, this, (card) => editor.replaceSelection("```chrono-card\n" + card.name + "\n```\n")).open(),
		});

		this.addCommand({
			id: "show-card",
			name: "Look up a card…",
			callback: () => new CardSuggestModal(this.app, this, (card) => new CardDetailModal(this.app, this, card).open()).open(),
		});

		this.addCommand({
			id: "new-deck-note",
			name: "New deck note",
			callback: () =>
				new TextPromptModal(this.app, {
					title: "New deck note",
					placeholder: "Deck name",
					cta: "Create",
					onSubmit: (name) => void this.newDeckNote(name),
				}).open(),
		});

		this.addCommand({
			id: "new-tournament-report",
			name: "New tournament report",
			callback: () => {
				const decks = this.deckNotes();
				const active = this.app.workspace.getActiveFile();
				new TournamentModal(this.app, decks, decks.find((f) => f === active) ?? null, (opts) => void this.newTournamentReport(opts)).open();
			},
		});
	}

	// ---- views ---------------------------------------------------------------

	async activateCardBrowser(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_CARD_BROWSER)[0];
		if (!leaf) {
			leaf = this.settings.cardBrowserPlacement === "sidebar" ? (workspace.getRightLeaf(false) ?? workspace.getLeaf("tab")) : workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_CARD_BROWSER, active: true });
		}
		await workspace.revealLeaf(leaf);
		const view = leaf.view;
		if (view instanceof CardBrowserView) view.refresh();
	}

	/** Open the card browser as a page or in the sidebar from now on, moving it there when it is open. */
	async setCardBrowserPlacement(placement: CardBrowserPlacement): Promise<void> {
		if (this.settings.cardBrowserPlacement !== placement) {
			this.settings.cardBrowserPlacement = placement;
			await this.saveSettings();
		}
		const open = this.app.workspace.getLeavesOfType(VIEW_TYPE_CARD_BROWSER);
		if (!open.length) return;
		const inSidebar = (leaf: WorkspaceLeaf) => leaf.getRoot() === this.app.workspace.rightSplit || leaf.getRoot() === this.app.workspace.leftSplit;
		if (open.every((leaf) => inSidebar(leaf) === (placement === "sidebar"))) return;
		open.forEach((leaf) => leaf.detach());
		await this.activateCardBrowser();
	}

	async activateDeckBuilder(): Promise<DeckBuilderView | null> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_DECK_BUILDER)[0];
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_DECK_BUILDER, active: true });
		}
		await workspace.revealLeaf(leaf);
		const view = leaf.view;
		return view instanceof DeckBuilderView ? view : null;
	}

	async openDeckInBuilder(deck: Deck, source?: DeckSourceLink): Promise<void> {
		const copy: Deck = { name: deck.name, divers: deck.divers.slice(), entries: deck.entries.map((e) => ({ ...e })) };
		const view = await this.activateDeckBuilder();
		if (view) view.loadDraft({ deck: copy, source });
		else {
			this.settings.builderDraft = { deck: copy, source };
			await this.saveSettings();
		}
	}

	/** Empty the deck builder, asking first when it has cards in it. */
	newDeckInBuilder(): void {
		this.confirmReplaceDraft("Start a new deck", "Start new deck", () => void this.openDeckInBuilder(emptyDeck()));
	}

	/** Create a deck note and open its (empty) deck in the builder, linked to the note. */
	private async newDeckNote(name: string): Promise<void> {
		const deck = { ...emptyDeck(), name };
		const file = await this.templates.createDeckNote(deck);
		if (!file) return;
		const link = await firstDeckBlockLink(this.app, file);
		this.confirmReplaceDraft("Build the new deck", "Open in deck builder", () => void this.openDeckInBuilder(deck, link));
	}

	/** Run `replace` right away when the builder is empty, else after the user confirms. */
	private confirmReplaceDraft(title: string, cta: string, replace: () => void): void {
		const deck = this.settings.builderDraft.deck;
		const cards = deck.divers.length + deck.entries.reduce((n, e) => n + e.count, 0);
		if (!cards) return replace();
		const name = deck.name ? `“${deck.name}”` : "a deck";
		new ConfirmModal(this.app, {
			title,
			message: `The deck builder has ${name} with ${cards} card${cards === 1 ? "" : "s"}. It will be replaced; changes you haven't saved are lost.`,
			cta,
			onConfirm: replace,
		}).open();
	}

	async addToBuilder(card: Card, asDiver: boolean): Promise<void> {
		const view = await this.activateDeckBuilder();
		view?.addCard(card, asDiver);
	}

	// ---- helpers -------------------------------------------------------------

	/** "[[Deck note]]" when the active note is a deck note, else "". */
	/** Deck notes (`type: chrono-deck`), by name. */
	private deckNotes(): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => deckNoteFrontmatter(this.app, file))
			.sort((a, b) => a.basename.localeCompare(b.basename));
	}

	private async newTournamentReport(opts: TournamentOptions): Promise<void> {
		const decks: TournamentDeck[] = [];
		for (const file of opts.decks) {
			const link = this.app.fileManager.generateMarkdownLink(file, "");
			decks.push({ link, deck: this.firstDeck(await this.app.vault.cachedRead(file)) });
		}
		// Decks without a note: named after the deck, with their decklist from the code.
		for (const deck of opts.codeDecks) decks.push({ link: deck.name, deck });
		await this.templates.createTournamentNote(opts.event, opts.format, opts.rounds, decks);
	}

	private firstDeck(text: string): Deck | undefined {
		const lines = text.split("\n");
		const range = findFirstDeckBlock(lines);
		return range ? parseDeck(this, lines.slice(range.start + 1, range.end).join("\n")) : undefined;
	}

	/** Set a deck note's derived properties from its first deck block. */
	private async updateDeckNote(file: TFile): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		// The editor may hold changes that aren't saved to disk yet.
		const text = view?.file === file ? view.editor.getValue() : await this.app.vault.read(file);
		const deck = this.firstDeck(text);
		if (!deck) return void new Notice("ChronoCCG: this note has no chrono-deck block.");
		try {
			const changed = await updateDeckNoteProperties(this, file, deck);
			new Notice(changed.length ? `ChronoCCG: updated ${changed.join(", ")}.` : "ChronoCCG: properties are already up to date.");
		} catch (err) {
			new Notice(`ChronoCCG: could not update properties — ${(err as Error).message}`);
		}
	}

	/** Copy the built-in templates into the template folder (existing files are kept). */
	async writeDefaultTemplates(): Promise<void> {
		const folder = this.settings.templateFolder || `${this.settings.notesFolder || "ChronoCCG"}/Templates`;
		if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
		let written = 0;
		for (const kind of Object.keys(TEMPLATE_FILE_NAMES) as TemplateKind[]) {
			const path = `${folder}/${TEMPLATE_FILE_NAMES[kind]}`;
			if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) continue;
			await this.app.vault.create(path, DEFAULT_TEMPLATES[kind]);
			written++;
		}
		if (!this.settings.templateFolder) {
			this.settings.templateFolder = folder;
			await this.saveSettings();
		}
		const kept = written < Object.keys(TEMPLATE_FILE_NAMES).length ? " (existing files kept)" : "";
		new Notice(`ChronoCCG: wrote ${written} template(s) to ${folder}${kept}.`);
	}

	/** Save a shrunk copy of every card image (in the selected style) that isn't saved yet. */
	async downloadAllCardImages(): Promise<void> {
		if (imageCache.downloadProgress?.running) return;
		const result = await imageCache.downloadAll(cardImageUrls(this.cards.all(), this.settings));
		const saved = result.done - result.failed;
		const failed = result.failed ? `, ${result.failed} failed` : "";
		// Turning off "Save card images" stops the download and deletes what it saved.
		if (!this.settings.cacheImages) new Notice("ChronoCCG: image download stopped.");
		else if (result.cancelled) new Notice(`ChronoCCG: image download stopped (${saved} saved${failed}).`);
		else new Notice(`ChronoCCG: saved ${saved} card image${saved === 1 ? "" : "s"}${failed}.`);
	}

	/** @returns true when the settings were moved off the removed runeterra.ar source. */
	async loadSettings(): Promise<boolean> {
		const defaults = structuredClone(DEFAULT_SETTINGS);
		this.settings = Object.assign(defaults, (await this.loadData()) as Partial<ChronoSettings> | null);
		const legacy = this.settings as unknown as Record<string, unknown>;
		const migrated = legacy.dataSource === "runeterra-ar" || legacy.dataSource === "chrono-db";
		if (migrated) this.settings.dataSource = "official";
		// Settings of the runeterra.ar image fallback.
		delete legacy.imageBase;
		delete legacy.imageSize;
		const draft = this.settings.builderDraft;
		if (!draft?.deck || !Array.isArray(draft.deck.divers) || !Array.isArray(draft.deck.entries)) {
			this.settings.builderDraft = { deck: emptyDeck() };
		}
		if (migrated) await this.saveSettings();
		return migrated;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private shouldAutoRefresh(): boolean {
		if (this.settings.dataSource === "bundled") return false;
		if (this.settings.autoRefreshDays <= 0) return false;
		const last = this.settings.lastSyncIso ? Date.parse(this.settings.lastSyncIso) : 0;
		const ageDays = (Date.now() - last) / (1000 * 60 * 60 * 24);
		return ageDays >= this.settings.autoRefreshDays;
	}

	/** Notice shown when only the placeholder seed is loaded. */
	private notifyNoCardData(reason?: string): void {
		new Notice(
			"ChronoCCG: card data is not loaded yet" +
				(reason ? ` (${reason})` : "") +
				'. Run "Refresh card database" when you are online.',
			10_000,
		);
	}

	/**
	 * @param silent no notices on success or failure
	 * @param reportFailure show a notice on failure even when silent
	 */
	async refreshCardDatabase(silent = false, reportFailure = false): Promise<void> {
		if (this.settings.dataSource === "bundled") {
			this.cards.load(SEED_DATABASE);
			if (!silent) new Notice("ChronoCCG: using bundled seed data.");
			this.refreshOpenViews();
			return;
		}
		try {
			const db = await this.sync.fetch({
				id: this.settings.dataSource,
				url: this.settings.customDataUrl,
			});
			if (!db.cards.length) throw new Error("the source returned no cards");
			this.cards.load(db);
			await this.sync.writeCache(db);
			this.settings.lastSyncIso = new Date().toISOString();
			await this.saveSettings();
			if (!silent) new Notice(`ChronoCCG: loaded ${db.cards.length} cards from ${db.source}.`);
			this.refreshOpenViews();
		} catch (err) {
			console.error("ChronoCCG refresh failed", err);
			if (!silent) new Notice(`ChronoCCG refresh failed: ${(err as Error).message}`);
			else if (reportFailure) this.notifyNoCardData((err as Error).message);
		}
	}

	private refreshOpenViews(): void {
		for (const type of [VIEW_TYPE_CARD_BROWSER, VIEW_TYPE_DECK_BUILDER]) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				const v = leaf.view;
				if (v instanceof CardBrowserView || v instanceof DeckBuilderView) v.refresh();
			}
		}
		// Re-render notes so codeblocks pick up the new card data.
		this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
			if (leaf.view instanceof MarkdownView) leaf.view.previewMode.rerender(true);
		});
	}
}
