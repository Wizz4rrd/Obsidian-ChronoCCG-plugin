import { App, Modal, Setting } from "obsidian";

export interface ConfirmOptions {
	title: string;
	message: string;
	cta: string;
	/** Red button, for actions that delete something. */
	warning?: boolean;
	onConfirm: () => void;
	onCancel?: () => void;
}

/** Yes/no question. Closing it any other way than with the button counts as "Cancel". */
export class ConfirmModal extends Modal {
	private confirmed = false;

	constructor(app: App, private opts: ConfirmOptions) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.opts.title);
		this.contentEl.createEl("p", { text: this.opts.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => {
				b.setButtonText(this.opts.cta).onClick(() => {
					this.confirmed = true;
					this.close();
					this.opts.onConfirm();
				});
				if (this.opts.warning) b.setWarning();
				else b.setCta();
			});
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.confirmed) this.opts.onCancel?.();
	}
}
