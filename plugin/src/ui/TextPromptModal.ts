import { App, Modal, Setting } from "obsidian";

export interface TextPromptOptions {
	title: string;
	placeholder?: string;
	value?: string;
	multiline?: boolean;
	cta?: string;
	onSubmit: (value: string) => void;
}

/** Minimal single-field prompt (Obsidian has no built-in one). */
export class TextPromptModal extends Modal {
	private value: string;

	constructor(app: App, private opts: TextPromptOptions) {
		super(app);
		this.value = opts.value ?? "";
	}

	onOpen(): void {
		const { contentEl, opts } = this;
		this.titleEl.setText(opts.title);
		const submit = () => {
			if (!this.value.trim()) return;
			this.close();
			opts.onSubmit(this.value.trim());
		};
		const field = new Setting(contentEl).setClass("chrono-prompt-field");
		if (opts.multiline) {
			field.addTextArea((t) => {
				t.setPlaceholder(opts.placeholder ?? "").setValue(this.value).onChange((v) => (this.value = v));
				t.inputEl.rows = 4;
				t.inputEl.addClass("chrono-prompt-input", "chrono-mono");
				window.setTimeout(() => t.inputEl.focus(), 0);
			});
		} else {
			field.addText((t) => {
				t.setPlaceholder(opts.placeholder ?? "").setValue(this.value).onChange((v) => (this.value = v));
				t.inputEl.addClass("chrono-prompt-input");
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") submit();
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});
		}
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setCta().setButtonText(opts.cta ?? "OK").onClick(submit));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
