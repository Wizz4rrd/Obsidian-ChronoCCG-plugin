import { App, Modal, Setting, TFile } from "obsidian";
import { MATCH_FORMATS, MatchFormat, parseDeckCodes } from "../data/tournament";
import { Deck } from "../data/types";

export interface TournamentOptions {
	event: string;
	format: MatchFormat;
	rounds: number;
	/** Deck notes brought to the event, in list order. */
	decks: TFile[];
	/** Decks pasted as codes, for decks without a note. */
	codeDecks: Deck[];
}

/** Event name, match format, number of rounds and the decks brought (several for Bo3/Bo5). */
export class TournamentModal extends Modal {
	private event = "";
	private format: MatchFormat = "Bo3";
	private rounds = 3;
	private picked: Set<TFile>;
	private codes = "";
	private codesError!: HTMLElement;

	constructor(
		app: App,
		private deckNotes: TFile[],
		preselected: TFile | null,
		private onSubmit: (opts: TournamentOptions) => void,
	) {
		super(app);
		this.picked = new Set(preselected ? [preselected] : []);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText("New tournament report");
		new Setting(contentEl).setName("Event").addText((t) => {
			t.setPlaceholder("e.g. Weekly Dive #12").onChange((v) => (this.event = v));
			t.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") this.submit();
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(contentEl)
			.setName("Format")
			.setDesc("Games per match: a row is added for each one.")
			.addDropdown((d) => {
				for (const f of MATCH_FORMATS) d.addOption(f, f === "Bo1" ? "Best of 1" : f === "Bo3" ? "Best of 3" : "Best of 5");
				d.setValue(this.format).onChange((v) => (this.format = v as MatchFormat));
			});
		new Setting(contentEl).setName("Rounds").addSlider((s) =>
			s
				.setLimits(1, 12, 1)
				.setValue(this.rounds)
				.onChange((v) => (this.rounds = v)),
		);

		new Setting(contentEl).setName("Decks").setHeading();
		if (!this.deckNotes.length) {
			contentEl.createEl("p", { cls: "setting-item-description", text: "No deck notes yet: paste deck codes below, or add the decks later." });
		}
		const list = contentEl.createDiv({ cls: "chrono-tournament-decks" });
		for (const file of this.deckNotes) {
			new Setting(list).setName(file.basename).addToggle((t) =>
				t.setValue(this.picked.has(file)).onChange((on) => {
					if (on) this.picked.add(file);
					else this.picked.delete(file);
				}),
			);
		}

		new Setting(contentEl)
			.setName("Deck codes")
			.setDesc("For decks you don't have a note for: paste their codes, one per line.")
			.addTextArea((t) => {
				t.setPlaceholder("Deck code\nDeck code").onChange((v) => {
					this.codes = v;
					this.codesError.empty();
				});
				t.inputEl.rows = 3;
				t.inputEl.addClass("chrono-tournament-codes");
			});
		this.codesError = contentEl.createDiv({ cls: "chrono-tournament-codes-error" });

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText("Create").setCta().onClick(() => this.submit()));
	}

	private submit(): void {
		const { decks: codeDecks, invalid } = parseDeckCodes(this.codes);
		if (invalid.length) {
			this.codesError.setText(`Not a deck code: line ${invalid.join(", ")}.`);
			return;
		}
		this.close();
		this.onSubmit({
			event: this.event.trim() || "Tournament",
			format: this.format,
			rounds: this.rounds,
			decks: this.deckNotes.filter((f) => this.picked.has(f)),
			codeDecks,
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
