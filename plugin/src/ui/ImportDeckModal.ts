import { App, Modal, Notice, Setting } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { decodeDeck } from "../data/DeckCodec";
import { toCodeBlock } from "../data/DeckExport";
import { unwrapDeckCode } from "../data/deckInput";
import { Deck } from "../data/types";

export class ImportDeckModal extends Modal {
	private code = "";
	private deckName = "";

	constructor(app: App, private plugin: ChronoCCGPlugin) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText("Import deck from code");

		new Setting(contentEl)
			.setName("Deck code")
			.setDesc("Paste a ChronoCCG deck code (from the game or a deck site).")
			.setClass("chrono-prompt-field")
			.addTextArea((t) =>
				t
					.setPlaceholder("AUGVG33NNZ2X…")
					.onChange((v) => (this.code = v))
					.then((t) => {
						t.inputEl.rows = 4;
						t.inputEl.addClass("chrono-prompt-input", "chrono-mono");
					}),
			);

		new Setting(contentEl)
			.setName("Deck name (optional)")
			.setDesc("Leave blank to use the name embedded in the code.")
			.addText((t) => t.onChange((v) => (this.deckName = v.trim())));

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Open in builder").onClick(() => this.openInBuilder()))
			.addButton((b) => b.setButtonText("Insert in active note").onClick(() => this.insertInActiveNote()))
			.addButton((b) =>
				b
					.setCta()
					.setButtonText("Create deck note")
					.onClick(() => this.createNote()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private decodeOrToast(): Deck | null {
		try {
			const decoded = decodeDeck(unwrapDeckCode(this.code), { maxDecodedBytes: 8_192, maxEntries: 2_000 });
			if (decoded.entries.length === 0 && decoded.divers.length === 0) {
				new Notice("Deck code decoded but contained no cards.");
				return null;
			}
			if (decoded.warnings.length) new Notice(`Deck code warnings: ${decoded.warnings.join(" ")}`);
			return { name: this.deckName || decoded.name || "Imported deck", divers: decoded.divers, entries: decoded.entries };
		} catch (err) {
			new Notice(`Invalid deck code: ${(err as Error).message}`);
			return null;
		}
	}

	private insertInActiveNote(): void {
		const deck = this.decodeOrToast();
		if (!deck) return;
		const editor = this.app.workspace.activeEditor?.editor;
		if (!editor) {
			new Notice("No active editor. Open a note in edit mode, then try again.");
			return;
		}
		editor.replaceSelection(toCodeBlock(deck, this.plugin.cards));
		this.close();
	}

	private async createNote(): Promise<void> {
		const deck = this.decodeOrToast();
		if (!deck) return;
		const file = await this.plugin.templates.createDeckNote(deck);
		if (file) this.close();
	}

	private openInBuilder(): void {
		const deck = this.decodeOrToast();
		if (!deck) return;
		this.close();
		void this.plugin.openDeckInBuilder(deck);
	}
}
