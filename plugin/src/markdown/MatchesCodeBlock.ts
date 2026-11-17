import { debounce, MarkdownRenderChild, setIcon, TFile } from "obsidian";
import type ChronoVaultPlugin from "../../main";
import { deckNoteFrontmatter } from "../templates/DeckNoteSync";
import { RecordMatchModal } from "../tracker/RecordMatchModal";
import { groupRecords, pairingLabel } from "../data/matches";
import { pairingFromLabel, renderFormStrip, renderKpis, renderPairing, renderRecordTable } from "../tracker/MatchWidgets";

/**
 * ```chrono-matches``` (no content): the match tracker's numbers inside a note.
 * In a deck note, that deck's results: win rate, record, form and the record
 * against each syndicate pair. Anywhere else (e.g. the match log), every game.
 * Both with buttons to log a game and open the tracker.
 */
export function registerMatchesCodeBlock(plugin: ChronoVaultPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor("chrono-matches", (_source, el, ctx) => {
		ctx.addChild(new MatchesBlock(el, plugin, ctx.sourcePath));
	});
}

const FORM_GAMES = 10;

class MatchesBlock extends MarkdownRenderChild {
	private refreshSoon = debounce(() => void this.render(), 300, true);

	constructor(
		containerEl: HTMLElement,
		private plugin: ChronoVaultPlugin,
		private sourcePath: string,
	) {
		super(containerEl);
	}

	onload(): void {
		const { vault } = this.plugin.app;
		this.registerEvent(vault.on("modify", (file) => file.path === this.plugin.matchLog.path && this.refreshSoon()));
		this.registerEvent(vault.on("create", (file) => file.path === this.plugin.matchLog.path && this.refreshSoon()));
		this.registerEvent(vault.on("rename", () => this.refreshSoon()));
		void this.render();
	}

	/** The deck note this block is in, or null outside a deck note. */
	private deck(): TFile | null {
		const file = this.plugin.app.vault.getFileByPath(this.sourcePath);
		return file && deckNoteFrontmatter(this.plugin.app, file) ? file : null;
	}

	private async render(): Promise<void> {
		const deck = this.deck();
		const { games: all } = await this.plugin.matchLog.games();
		const games = deck ? all.filter((g) => g.file?.path === deck.path) : all;
		const el = this.containerEl;
		el.empty();
		el.addClass("chrono-matches-block");

		const bar = el.createDiv({ cls: "chrono-matches-bar" });
		const log = bar.createEl("button", { cls: "mod-cta" });
		setIcon(log.createSpan(), "plus");
		log.appendText(" Log a game");
		log.addEventListener("click", () => new RecordMatchModal(this.plugin, deck).open());
		const open = bar.createEl("button");
		setIcon(open.createSpan(), "trophy");
		open.appendText(" Open match tracker");
		open.addEventListener("click", () => void this.plugin.activateMatchTracker(deck));

		if (!games.length) {
			el.createDiv({ cls: "chrono-match-hint", text: deck ? "No games logged for this deck yet." : "No games logged yet." });
			return;
		}
		const matches = games.map((g) => g.match);
		renderKpis(el, matches);
		const strip = el.createDiv({ cls: "chrono-tracker-strip" });
		strip.createSpan({ cls: "chrono-match-hint", text: `Last ${Math.min(FORM_GAMES, matches.length)}` });
		renderFormStrip(strip, matches, FORM_GAMES);
		if (deck) {
			renderRecordTable(
				el,
				["Syndicate pair"],
				groupRecords(matches, (m) => pairingLabel(m.opponent), (m) => m).map((p) => ({ label: (td) => void renderPairing(td, pairingFromLabel(p.key)), record: p.record })),
			);
		}
	}
}
