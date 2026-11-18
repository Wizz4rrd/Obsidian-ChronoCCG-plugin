import { normalizePath, Notice, TFile } from "obsidian";
import type ChronoVaultPlugin from "../../main";
import { addLogRow, deckCellLabel, deckLinkTarget, formatLogRow, logColumns, logTableHeader, Match, parseLog, replaceLogRow, tally, upgradeLog } from "../data/matches";

/** A game of the match log, with its deck note when the deck cell links to one. */
export interface LoggedGame {
	match: Match;
	file: TFile | null;
	/** Groups games by deck: the note's path, or the deck cell's text without a note. */
	deckKey: string;
	deckName: string;
	/** The row as it is in the note. */
	raw: string;
}

const DEFAULT_LOG_NAME = "Match log.md";

/** Reads and writes the match log note (see data/matches for its format). */
export class MatchLog {
	constructor(private plugin: ChronoVaultPlugin) {}

	/** The log note's path: the "Match log" setting, or "Match log.md" in the notes folder. */
	get path(): string {
		const set = this.plugin.settings.matchLog.trim();
		const folder = this.plugin.settings.notesFolder.trim();
		const path = set || (folder ? `${folder}/${DEFAULT_LOG_NAME}` : DEFAULT_LOG_NAME);
		return normalizePath(path.toLowerCase().endsWith(".md") ? path : `${path}.md`);
	}

	file(): TFile | null {
		return this.plugin.app.vault.getFileByPath(this.path);
	}

	/** Every game, oldest first (by date, then by row order); `invalid` lists rows that couldn't be read. */
	async games(): Promise<{ games: LoggedGame[]; invalid: number[] }> {
		const file = this.file();
		if (!file) return { games: [], invalid: [] };
		const { rows, invalid } = parseLog(await this.plugin.app.vault.cachedRead(file));
		const games = rows.map((row): LoggedGame => {
			const target = deckLinkTarget(row.deck);
			const deck = target ? this.plugin.app.metadataCache.getFirstLinkpathDest(target, file.path) : null;
			const name = deck?.basename ?? deckCellLabel(row.deck);
			return { match: row.match, file: deck, deckKey: deck?.path ?? name, deckName: name || "(no deck)", raw: row.raw };
		});
		// Stable: games of the same day keep their row order.
		games.sort((a, b) => (a.match.date || "").localeCompare(b.match.date || ""));
		return { games, invalid };
	}

	/**
	 * What the form starts with for a new game: the opponent and archetype
	 * of the last game logged this session, and the patch of the newest game.
	 */
	defaults(games: LoggedGame[]): Partial<Match> {
		const patch = this.plugin.lastMatch.patch ?? games.filter((g) => g.match.patch).pop()?.match.patch ?? "";
		return { ...this.plugin.lastMatch, patch };
	}

	/** The deck the form starts with for a new game: the deck of the newest game whose note is still in the deck picker. */
	lastDeck(games: LoggedGame[]): TFile | null {
		const decks = this.plugin.deckNotes();
		for (let i = games.length - 1; i >= 0; i--) {
			const file = games[i].file;
			if (file && decks.includes(file)) return file;
		}
		return null;
	}

	async add(deck: TFile, match: Match): Promise<void> {
		const file = await this.ensure();
		await this.plugin.app.vault.process(file, (text) => {
			const upgraded = upgradeLog(text);
			return addLogRow(upgraded, formatLogRow(this.deckCell(deck), match, logColumns(upgraded)));
		});
		this.plugin.lastMatch = { opponent: match.opponent, archetype: match.archetype, patch: match.patch };
		const record = tally((await this.games()).games.filter((g) => g.file === deck).map((g) => g.match));
		new Notice(`ChronoVault: ${match.result === "W" ? "win" : "loss"} logged for ${deck.basename} (now ${record.wins}–${record.losses}).`);
	}

	async update(game: LoggedGame, deck: TFile, match: Match): Promise<void> {
		await this.rewrite(game, (columns) => formatLogRow(this.deckCell(deck), match, columns, game.raw));
	}

	async remove(game: LoggedGame): Promise<void> {
		await this.rewrite(game, null);
	}

	async open(): Promise<void> {
		const file = await this.ensure();
		await this.plugin.app.workspace.getLeaf(false).openFile(file);
	}

	/** Replace the game's row with `next` (given the table's columns), or remove it when `next` is null. */
	private async rewrite(game: LoggedGame, next: ((columns: string[]) => string) | null): Promise<void> {
		const file = this.file();
		let found = false;
		if (file) {
			await this.plugin.app.vault.process(file, (text) => {
				// The row is found as it is now, then the table gets any missing column.
				const out = replaceLogRow(text, game.raw, next ? next(logColumns(text)) : null);
				found = out !== null;
				return out === null ? text : upgradeLog(out);
			});
		}
		if (!found) new Notice("ChronoVault: that game is no longer in the match log (was it edited by hand?).");
	}

	/**
	 * A link to the deck note, written the way the vault's "Files and links" settings say (wikilink or Markdown, path format).
	 * With "Deck names in the match log", a link with a path shows the deck's name: "[[Decks/Egg Novice|Egg Novice]]".
	 */
	private deckCell(deck: TFile): string {
		const link = this.plugin.app.fileManager.generateMarkdownLink(deck, this.path);
		if (!this.plugin.settings.matchLogDeckAlias || deckLinkTarget(link) === deck.basename) return link;
		return this.plugin.app.fileManager.generateMarkdownLink(deck, this.path, undefined, deck.basename);
	}

	private async ensure(): Promise<TFile> {
		const existing = this.file();
		if (existing) return existing;
		const path = this.path;
		const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		if (folder && !this.plugin.app.vault.getFolderByPath(folder)) await this.plugin.app.vault.createFolder(folder);
		const intro =
			"# Match log\n\n" +
			"```chrono-matches\n```\n\n" +
			"Games logged with the ChronoVault match tracker, one row per game. You can edit the table by hand: " +
			"Result is W or L, Opponent lists the syndicates.\n\n";
		return this.plugin.app.vault.create(path, `${intro}${logTableHeader()}\n`);
	}
}
