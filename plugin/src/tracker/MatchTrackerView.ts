import { debounce, ItemView, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type ChronoVaultPlugin from "../../main";
import { comparePatches, formatRate, formatRecord, groupRecords, matchesVs, pairingLabel, SMALL_SAMPLE, tally, winRate } from "../data/matches";
import { Syndicate, SYNDICATES } from "../data/types";
import { ConfirmModal } from "../ui/ConfirmModal";
import { renderSyndicateIcon } from "../ui/SyndicateIcon";
import { LoggedGame } from "./MatchLog";
import { renderMatchForm } from "./MatchForm";
import { pairingFromLabel, renderFormStrip, renderGameRow, renderKpis, renderPairing, renderRateBar, renderRecordTable, renderWeeklyChart, syndicateRows } from "./MatchWidgets";
import { RecordMatchModal, uniqueArchetypes, uniquePatches } from "./RecordMatchModal";

export const VIEW_TYPE_MATCH_TRACKER = "chronovault-match-tracker";

type Period = "all" | "30" | "7";
const RECENT = 20;
const FORM_GAMES = 10;
/** A matchup within this many points of 50% counts as about even (45–55%). */
const EVEN_MARGIN = 0.05;

/**
 * Log games and see how your decks do. With every deck: your decks, a deck ×
 * syndicate grid and the records against each syndicate and syndicate pair. With one
 * deck: that deck's page. Filters: period, patch, deck and the opponent's
 * syndicates ("Vs"). Games are kept in the match log note.
 */
export class MatchTrackerView extends ItemView {
	private period: Period = "all";
	/** Match.patch, or "" for all patches. */
	private patchFilter = "";
	/** LoggedGame.deckKey, or "" for all decks. */
	private deckFilter = "";
	/** Opponent's syndicates to show games against: none = all, one = any game against it, two = that pair. */
	private vs: Syndicate[] = [];
	private showAllGames = false;
	/** Deck preselected in the form (the note the tracker was opened from, or the last deck logged). */
	private formDeck: TFile | null = null;
	private body!: HTMLElement;
	private refreshSoon = debounce(() => void this.render(), 300, true);

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: ChronoVaultPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_MATCH_TRACKER;
	}

	getDisplayText(): string {
		return "Match tracker";
	}

	getIcon(): string {
		return "trophy";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("chrono-tracker");
		this.body = this.contentEl.createDiv({ cls: "chrono-tracker-body" });
		// The log edited by hand, games logged from the command, decks renamed or added.
		this.registerEvent(this.app.vault.on("modify", (file) => file.path === this.plugin.matchLog.path && this.refreshSoon()));
		this.registerEvent(this.app.vault.on("create", (file) => file.path === this.plugin.matchLog.path && this.refreshSoon()));
		this.registerEvent(this.app.vault.on("rename", () => this.refreshSoon()));
		this.registerEvent(this.app.metadataCache.on("changed", (file) => file.extension === "md" && file.path !== this.plugin.matchLog.path && this.refreshSoon()));
		await this.render();
	}

	/** Show one deck's page, with the deck preselected in the form; null shows every deck. */
	focusDeck(file: TFile | null): void {
		this.formDeck = file;
		this.deckFilter = file?.path ?? "";
		void this.render();
	}

	async render(): Promise<void> {
		const decks = this.plugin.deckNotes();
		const { games: all, invalid } = await this.plugin.matchLog.games();
		const patches = uniquePatches(all.map((g) => g.match.patch));
		const games = all.filter((g) => this.inPeriod(g) && (!this.patchFilter || g.match.patch === this.patchFilter) && (!this.deckFilter || g.deckKey === this.deckFilter) && matchesVs(g.match.opponent, this.vs));

		const scroll = this.body.scrollTop;
		this.body.empty();

		this.renderTop(all, patches);
		if (invalid.length) {
			const hint = this.body.createDiv({ cls: "chrono-tracker-warning" });
			hint.setText(`${invalid.length} row${invalid.length === 1 ? "" : "s"} of the match log couldn't be read (no W or L in the Result column): line ${invalid.join(", ")}. `);
			const open = hint.createEl("a", { text: "Open the match log" });
			open.addEventListener("click", () => void this.plugin.matchLog.open());
		}

		const layout = this.body.createDiv({ cls: "chrono-tracker-layout" });
		const entry = layout.createDiv({ cls: "chrono-tracker-card chrono-tracker-entry" });
		entry.createEl("h3", { text: "Log a game" });
		renderMatchForm(entry, {
			decks,
			deck: this.app.vault.getFileByPath(this.deckFilter) ?? this.formDeck ?? this.plugin.matchLog.lastDeck(all),
			archetypes: uniqueArchetypes(all.map((g) => g.match.archetype)),
			patches,
			codeSyndicates: (code) => this.plugin.codeSyndicates(code),
			initial: this.plugin.matchLog.defaults(all),
			onSubmit: async (file, match) => {
				this.formDeck = file;
				await this.plugin.matchLog.add(file, match);
			},
		});

		const main = layout.createDiv({ cls: "chrono-tracker-main" });
		if (this.deckFilter) this.renderDeckHeader(main, all);
		if (!games.length) {
			const empty = main.createDiv({ cls: "chrono-tracker-card chrono-match-empty" });
			if (!all.length) {
				empty.createEl("p", { text: "No games logged yet." });
				empty.createEl("p", { text: "Pick your deck and the opponent's syndicates, then press Win or Loss. Games are saved in a note, so you can also edit them by hand." });
			} else empty.setText("No games match these filters.");
			this.body.scrollTop = scroll;
			return;
		}

		const matches = games.map((g) => g.match);
		const overview = main.createDiv({ cls: "chrono-tracker-card" });
		renderKpis(overview, matches);
		renderWeeklyChart(overview, matches);
		const strip = overview.createDiv({ cls: "chrono-tracker-strip" });
		strip.createSpan({ cls: "chrono-match-hint", text: `Last ${Math.min(30, matches.length)}` });
		renderFormStrip(strip, matches, 30);

		if (!this.deckFilter) {
			this.renderDecks(main, games);
			this.renderMatrix(main, games);
		}

		const split = main.createDiv({ cls: "chrono-tracker-split" });
		this.renderSyndicates(split, games);
		const archs = groupRecords(games, (g) => g.match.archetype, (g) => g.match);
		if (archs.length) renderRecordTable(this.card(split, "By archetype"), ["Archetype"], archs.map((a) => ({ label: (td) => void td.setText(a.key), record: a.record })));
		const byPatch = groupRecords(games, (g) => g.match.patch, (g) => g.match).sort((a, b) => comparePatches(a.key, b.key));
		if (byPatch.length > 1 && !this.patchFilter) {
			renderRecordTable(
				this.card(split, "By patch"),
				["Patch"],
				byPatch.map((p) => ({ label: (td) => void td.setText(p.key), record: p.record, onClick: () => this.apply(() => (this.patchFilter = p.key)) })),
			);
		}

		this.renderGames(main, games);
		this.body.scrollTop = scroll;
	}

	/** Set a filter and redraw. */
	private apply(change: () => void): void {
		change();
		void this.render();
	}

	private renderTop(all: LoggedGame[], patches: string[]): void {
		const top = this.body.createDiv({ cls: "chrono-tracker-top" });
		top.createEl("h2", { text: "Match tracker" });
		const filters = top.createDiv({ cls: "chrono-tracker-filters" });
		const select = (label: string, options: Array<[string, string]>, value: string, onChange: (v: string) => void) => {
			const s = filters.createEl("select", { cls: "dropdown", attr: { "aria-label": label } });
			for (const [v, text] of options) s.createEl("option", { value: v, text });
			s.value = value;
			s.addEventListener("change", () => this.apply(() => onChange(s.value)));
		};
		select(
			"Period",
			[
				["all", "All time"],
				["30", "Last 30 days"],
				["7", "Last 7 days"],
			],
			this.period,
			(v) => (this.period = v as Period),
		);
		if (patches.length) {
			const options = patches.map((p): [string, string] => [p, `Patch ${p}`]);
			if (this.patchFilter && !patches.includes(this.patchFilter)) options.push([this.patchFilter, `Patch ${this.patchFilter}`]);
			select("Patch", [["", "All patches"], ...options], this.patchFilter, (v) => (this.patchFilter = v));
		}
		// Decks with a note, plus decks that only appear in the log.
		const deckOptions = new Map<string, string>(this.plugin.deckNotes().map((f) => [f.path, f.basename]));
		for (const g of all) if (!deckOptions.has(g.deckKey)) deckOptions.set(g.deckKey, g.deckName);
		select("Deck", [["", "All decks"], ...Array.from(deckOptions).sort((a, b) => a[1].localeCompare(b[1]))], this.deckFilter, (v) => (this.deckFilter = v));

		// Vs: the opponent's syndicates, picked like in the form (two at most).
		const vs = filters.createDiv({ cls: "chrono-tracker-vs", attr: { role: "group", "aria-label": "Opponent's syndicates" } });
		vs.createSpan({ cls: "chrono-match-hint", text: "Vs" });
		for (const s of SYNDICATES) {
			const on = this.vs.includes(s);
			const b = vs.createEl("button", { cls: ["chrono-syndicate-btn", `chrono-synd-${s.toLowerCase()}`, ...(on ? ["is-active"] : [])], attr: { type: "button", "aria-label": s, "aria-pressed": String(on), title: `Games against ${s}` } });
			renderSyndicateIcon(b, s);
			b.addEventListener("click", () => this.apply(() => (this.vs = on ? this.vs.filter((x) => x !== s) : [...this.vs, s].slice(-2))));
		}

		if (this.deckFilter || this.vs.length || this.patchFilter || this.period !== "all") {
			const clear = filters.createEl("button", { text: "Clear filters" });
			clear.addEventListener("click", () =>
				this.apply(() => {
					this.period = "all";
					this.deckFilter = this.patchFilter = "";
					this.vs = [];
				}),
			);
		}
		const open = filters.createEl("button", { cls: "clickable-icon chrono-icon-btn", attr: { "aria-label": "Open the match log note" } });
		setIcon(open, "file-text");
		open.addEventListener("click", () => void this.plugin.matchLog.open());
	}

	private card(parent: HTMLElement, title: string, desc?: string): HTMLElement {
		const c = parent.createDiv({ cls: "chrono-tracker-card" });
		c.createEl("h3", { text: title });
		if (desc) c.createDiv({ cls: "chrono-match-hint chrono-tracker-card-desc", text: desc });
		return c;
	}

	private inPeriod(g: LoggedGame): boolean {
		if (this.period === "all") return true;
		if (!g.match.date) return false;
		return Date.now() - Date.parse(g.match.date) <= Number(this.period) * 86_400_000;
	}

	/** The deck page's title: name, syndicates, a way back to every deck and to the note. */
	private renderDeckHeader(parent: HTMLElement, all: LoggedGame[]): void {
		const game = all.find((g) => g.deckKey === this.deckFilter);
		const file = this.app.vault.getFileByPath(this.deckFilter) ?? game?.file ?? null;
		const head = parent.createDiv({ cls: "chrono-tracker-deck-head" });
		const back = head.createEl("button", { cls: "clickable-icon chrono-icon-btn", attr: { "aria-label": "All decks" } });
		setIcon(back, "arrow-left");
		back.addEventListener("click", () => this.apply(() => (this.deckFilter = "")));
		head.createEl("h3", { text: file?.basename ?? game?.deckName ?? this.deckFilter });
		const synds = this.deckSyndicates(file);
		if (synds.length) {
			const icons = head.createSpan({ cls: "chrono-match-pairing" });
			for (const s of synds) renderSyndicateIcon(icons, s);
		}
		if (file) {
			const open = head.createEl("button", { cls: "clickable-icon chrono-icon-btn", attr: { "aria-label": "Open deck note" } });
			setIcon(open, "arrow-up-right");
			open.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(file));
		}
	}

	private renderDecks(parent: HTMLElement, games: LoggedGame[]): void {
		const card = this.card(parent, "Your decks", "Click a deck to see its page.");
		const table = card.createDiv({ cls: "chrono-match-table-wrap" }).createEl("table", { cls: "chrono-match-table" });
		const head = table.createEl("thead").createEl("tr");
		for (const h of ["Deck", "Games", "Record", "Win rate", `Last ${FORM_GAMES}`]) head.createEl("th", { text: h, cls: h === "Games" ? "chrono-match-col-games" : undefined });
		const body = table.createEl("tbody");
		for (const d of groupRecords(games, (g) => g.deckKey, (g) => g.match)) {
			const deckGames = games.filter((g) => g.deckKey === d.key);
			const tr = body.createEl("tr", { cls: "chrono-tracker-filter-row", attr: { title: "Show this deck's page" } });
			if (d.record.games < SMALL_SAMPLE) tr.addClass("is-small");
			tr.addEventListener("click", () => this.apply(() => (this.deckFilter = d.key)));
			const name = tr.createEl("td");
			name.createSpan({ cls: "chrono-match-deck", text: deckGames[0]?.deckName ?? d.key });
			const synds = this.deckSyndicates(deckGames[0]?.file ?? null);
			if (synds.length) {
				const icons = name.createSpan({ cls: "chrono-match-pairing chrono-tracker-deck-synds" });
				for (const s of synds) renderSyndicateIcon(icons, s);
			}
			tr.createEl("td", { cls: ["chrono-match-num", "chrono-match-col-games"], text: String(d.record.games) });
			tr.createEl("td", { cls: "chrono-match-num", text: formatRecord(d.record) });
			renderRateBar(tr.createEl("td"), d.record);
			renderFormStrip(tr.createEl("td"), deckGames.map((g) => g.match), FORM_GAMES);
		}
	}

	private deckSyndicates(file: TFile | null): Syndicate[] {
		if (!file) return [];
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const list: unknown[] = Array.isArray(fm?.syndicates) ? (fm.syndicates as unknown[]) : [];
		return SYNDICATES.filter((s) => list.includes(s));
	}

	/**
	 * Against each syndicate and each syndicate pair. With one syndicate picked in "Vs",
	 * the first table lists what it was paired with instead.
	 */
	private renderSyndicates(parent: HTMLElement, games: LoggedGame[]): void {
		const matches = games.map((g) => g.match);
		if (this.vs.length === 2) return;
		if (this.vs.length === 1) {
			const [picked] = this.vs;
			const rows: Array<{ label: (td: HTMLElement) => void; record: ReturnType<typeof tally>; onClick?: () => void }> = SYNDICATES.filter((s) => s !== picked).map((s) => ({
				label: (td) => void renderPairing(td, [picked, s]),
				record: tally(matches.filter((m) => m.opponent.includes(s))),
				onClick: () => this.apply(() => (this.vs = [picked, s])),
			}));
			rows.push({ label: (td) => void td.setText(`${picked} alone`), record: tally(matches.filter((m) => m.opponent.length === 1)), onClick: undefined });
			renderRecordTable(this.card(parent, `${picked} paired with`), ["Syndicate pair"], rows);
			return;
		}
		renderRecordTable(
			this.card(parent, "Vs each syndicate", "Every game where the opponent played this syndicate, whatever the other one was."),
			["Syndicate"],
			syndicateRows(matches).map(({ s, record }) => ({ label: (td) => void renderPairing(td, [s]), record, onClick: () => this.apply(() => (this.vs = [s])) })),
		);
		renderRecordTable(
			this.card(parent, "By syndicate pair", "The opponent's two syndicates (or one, for a mono deck)."),
			["Syndicate pair"],
			groupRecords(games, (g) => pairingLabel(g.match.opponent), (g) => g.match).map((p) => ({
				label: (td) => void renderPairing(td, pairingFromLabel(p.key)),
				record: p.record,
				onClick: p.key === pairingLabel([]) ? undefined : () => this.apply(() => (this.vs = pairingFromLabel(p.key))),
			})),
		);
	}

	/** Your decks down, the six syndicates across, plus an "all decks" row; cells tinted by win rate around 50%. */
	private renderMatrix(parent: HTMLElement, games: LoggedGame[]): void {
		const decks = groupRecords(games, (g) => g.deckKey, (g) => g.match);
		const columns = SYNDICATES.filter((s) => games.some((g) => g.match.opponent.includes(s)));
		if (!columns.length) return;
		const card = this.card(parent, "Matchups", "Your decks against each syndicate. Click a cell to see those games.");
		const wrap = card.createDiv({ cls: "chrono-tracker-matrix-wrap" });
		const table = wrap.createEl("table", { cls: "chrono-tracker-matrix" });
		const head = table.createEl("thead").createEl("tr");
		head.createEl("th", { text: "Deck" });
		for (const s of columns) {
			const th = head.createEl("th", { attr: { title: s } });
			renderPairing(th, [s], false);
		}
		const body = table.createEl("tbody");
		const row = (key: string | null, name: string) => {
			const tr = body.createEl("tr", { cls: key ? undefined : "chrono-tracker-matrix-total" });
			tr.createEl("th", { text: name });
			for (const s of columns) {
				const r = tally(games.filter((g) => (key === null || g.deckKey === key) && g.match.opponent.includes(s)).map((g) => g.match));
				this.renderCell(tr, r, `${name} vs ${s}`, () =>
					this.apply(() => {
						if (key) this.deckFilter = key;
						this.vs = [s];
					}),
				);
			}
		};
		for (const d of decks) row(d.key, games.find((g) => g.deckKey === d.key)?.deckName ?? d.key);
		if (decks.length > 1) row(null, "All decks");

	}

	private renderCell(tr: HTMLElement, r: ReturnType<typeof tally>, title: string, onClick: () => void): void {
		const td = tr.createEl("td", { cls: "chrono-tracker-cell" });
		if (!r.games) {
			td.addClass("is-empty");
			td.setText("·");
			td.setAttr("title", `${title}: no games`);
			return;
		}
		const rate = winRate(r) ?? 0.5;
		td.addClass(Math.abs(rate - 0.5) <= EVEN_MARGIN ? "is-even" : rate > 0.5 ? "is-ahead" : "is-behind");
		if (r.games < SMALL_SAMPLE) td.addClass("is-small");
		// Tint strength: from 8% (about even) to 63% (all wins or all losses).
		td.setCssProps({ "--chrono-lean": `${Math.round(Math.abs(rate - 0.5) * 2 * 55 + 8)}%` });
		td.createDiv({ cls: "chrono-tracker-cell-rate", text: formatRate(rate) });
		td.createDiv({ cls: "chrono-tracker-cell-record", text: formatRecord(r) });
		td.setAttr("title", `${title}: ${formatRecord(r)} (${formatRate(rate)}, ${r.games} game${r.games === 1 ? "" : "s"})`);
		td.addEventListener("click", onClick);
	}

	private renderGames(parent: HTMLElement, games: LoggedGame[]): void {
		const shown = this.showAllGames ? games : games.slice(-RECENT);
		const card = this.card(parent, shown.length < games.length ? `Games (last ${shown.length} of ${games.length})` : `Games (${games.length})`);
		const list = card.createDiv({ cls: "chrono-match-list" });
		for (const g of shown.slice().reverse()) {
			const row = renderGameRow(this.plugin, list, g.match, this.deckFilter ? undefined : g.deckName);
			const actions = row.createDiv({ cls: "chrono-match-actions" });
			if (g.match.opponentDeck) {
				const opp = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Open the opponent's deck in the deck builder" } });
				setIcon(opp, "swords");
				opp.addEventListener("click", () => this.plugin.openCodeInBuilder(g.match.opponentDeck));
			}
			const edit = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Edit this game" } });
			setIcon(edit, "pencil");
			edit.addEventListener("click", () => new RecordMatchModal(this.plugin, g.file, g).open());
			const del = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Delete this game" } });
			setIcon(del, "trash-2");
			del.addEventListener("click", () =>
				new ConfirmModal(this.app, {
					title: "Delete game",
					message: `Delete the ${g.match.result === "W" ? "win" : "loss"} of ${g.deckName} vs ${pairingLabel(g.match.opponent)}${g.match.date ? ` on ${g.match.date}` : ""}?`,
					cta: "Delete",
					warning: true,
					onConfirm: () => void this.plugin.matchLog.remove(g),
				}).open(),
			);
		}
		if (games.length > RECENT) {
			const toggle = card.createEl("button", { cls: "chrono-tracker-more", text: this.showAllGames ? "Show fewer" : `Show all ${games.length} games` });
			toggle.addEventListener("click", () => this.apply(() => (this.showAllGames = !this.showAllGames)));
		}
	}
}
