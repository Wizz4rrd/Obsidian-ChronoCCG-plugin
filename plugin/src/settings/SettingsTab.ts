import { App, ButtonComponent, PluginSettingTab, Setting } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { DataSourceId } from "../data/DataSync";
import { BuilderDraft, emptyDeck } from "../ui/DeckBuilderView";
import { ConfirmModal } from "../ui/ConfirmModal";
import { CACHED_IMAGE_KB, CACHED_IMAGE_WIDTH, DownloadProgress, imageCache, ORIGINAL_IMAGE_KB } from "../utils/ImageCache";
import { cardImageUrls } from "../utils/imageUrl";

/** Full card render (frame, stats and text on the image) vs illustration only. */
export type CardImageStyle = "game" | "full";

export type DeckView = "grid" | "list";

export interface ChronoSettings {
	dataSource: DataSourceId;
	customDataUrl: string;
	/** Prefer framed card art (stats on image) or full-bleed illustration. */
	cardImageStyle: CardImageStyle;
	autoRefreshDays: number;
	/** Keep downloaded card images in the plugin folder. */
	cacheImages: boolean;
	lastSyncIso: string | null;
	/** Default rendering of ```chrono-deck blocks. */
	deckView: DeckView;
	hoverPreviews: boolean;
	/** Root folder for notes created by the plugin ("" = vault root). */
	notesFolder: string;
	/** Optional folder with user templates overriding the built-in ones. */
	templateFolder: string;
	/** Log deck builder saves in the deck note's Changelog section. */
	deckChangelog: boolean;
	/** Deck builder state, persisted between sessions. */
	builderDraft: BuilderDraft;
}

export const DEFAULT_SETTINGS: ChronoSettings = {
	dataSource: "official",
	customDataUrl: "",
	cardImageStyle: "game",
	autoRefreshDays: 7,
	cacheImages: true,
	lastSyncIso: null,
	deckView: "grid",
	hoverPreviews: true,
	notesFolder: "ChronoCCG",
	templateFolder: "",
	deckChangelog: true,
	builderDraft: { deck: emptyDeck() },
};

export class ChronoSettingsTab extends PluginSettingTab {
	private stopListening: (() => void) | null = null;

	constructor(app: App, private plugin: ChronoCCGPlugin) {
		super(app, plugin);
	}

	hide(): void {
		this.stopListening?.();
		this.stopListening = null;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.stopListening?.();
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();

		new Setting(containerEl).setName("Card data").setHeading();

		new Setting(containerEl)
			.setName("Card data source")
			.setDesc("Where to pull the card database from.")
			.addDropdown((d) =>
				d
					.addOption("bundled", "Bundled (offline seed)")
					.addOption("official", "Official (playchrono.com)")
					.addOption("custom", "Custom URL")
					.setValue(s.dataSource)
					.onChange(async (v) => {
						s.dataSource = v as DataSourceId;
						await save();
						this.display();
					}),
			);

		if (s.dataSource === "custom") {
			new Setting(containerEl)
				.setName("Custom data URL")
				.setDesc("JSON endpoint returning a card list or { cards: [...] }.")
				.addText((t) =>
					t
						.setPlaceholder("https://example.com/cards.json")
						.setValue(s.customDataUrl)
						.onChange(async (v) => {
							s.customDataUrl = v.trim();
							await save();
						}),
				);
		}

		new Setting(containerEl)
			.setName("Auto-refresh interval (days)")
			.setDesc("Re-download the card database when it is older than this. 0 disables auto-refresh.")
			.addText((t) =>
				t.setValue(String(s.autoRefreshDays)).onChange(async (v) => {
					const n = Number(v);
					s.autoRefreshDays = Number.isFinite(n) && n >= 0 ? n : 7;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Refresh card database now")
			.setDesc(
				`Loaded cards: ${this.plugin.cards.size} • source: ${this.plugin.cards.source} • version: ${this.plugin.cards.version}` +
					(s.lastSyncIso ? ` • last sync: ${new Date(s.lastSyncIso).toLocaleString()}` : ""),
			)
			.addButton((b) =>
				b
					.setCta()
					.setButtonText("Refresh")
					.onClick(async () => {
						b.setDisabled(true).setButtonText("Refreshing…");
						try {
							await this.plugin.refreshCardDatabase();
							this.display();
						} finally {
							b.setDisabled(false);
						}
					}),
			);

		new Setting(containerEl)
			.setName("Save card images")
			.setDesc(
				`Download each card image once and keep a ${CACHED_IMAGE_WIDTH}px copy in the plugin folder, so cards also show offline. ` +
					"When off, the full-size images (about 1.3 MB each) are loaded every time, and the saved ones are deleted.",
			)
			.addToggle((t) =>
				t.setValue(s.cacheImages).onChange(async (v) => {
					if (v === s.cacheImages) return;
					const { files, bytes } = v ? { files: 0, bytes: 0 } : await imageCache.stats();
					if (v || !files) {
						s.cacheImages = v;
						await save();
						showDownload(imageCache.downloadProgress);
						return;
					}
					new ConfirmModal(this.app, {
						title: "Stop saving card images",
						message:
							`This deletes the ${files} saved image${files === 1 ? "" : "s"} (${(bytes / 1024 / 1024).toFixed(1)} MB). ` +
							"Cards then load the full-size images (about 1.3 MB each) from the internet every time, and don't show offline.",
						cta: "Turn off and delete",
						warning: true,
						onConfirm: () => void this.stopSavingImages(),
						onCancel: () => t.setValue(true),
					}).open();
				}),
			);

		const urls = cardImageUrls(this.plugin.cards.all(), s);
		const downloadSetting = new Setting(containerEl).setName("Download all card images");
		let downloadBtn!: ButtonComponent;
		downloadSetting.addButton((b) => {
			downloadBtn = b;
			b.onClick(() => {
				if (imageCache.downloadProgress?.running) imageCache.cancelDownload();
				else void this.confirmDownloadAll(urls);
			});
		});
		const downloadText = (saved: number, missing: number): string => {
			if (!s.cacheImages) return 'Turn on "Save card images" first.';
			if (!urls.length) return "No card data yet.";
			if (!missing) return `All ${urls.length} card images are saved.`;
			return (
				`${saved} of ${urls.length} card images are saved. Download the other ${missing} now, so every card also shows offline. ` +
				`They are shrunk to ${CACHED_IMAGE_WIDTH}px like the others.`
			);
		};
		const showDownload = (p: DownloadProgress | null) => {
			if (p?.running) {
				downloadSetting.setDesc(`Downloading… ${p.done}/${p.total}${p.failed ? ` (${p.failed} failed)` : ""}`);
				downloadBtn.setButtonText("Cancel").removeCta().setDisabled(false);
				return;
			}
			void imageCache.savedCount(urls).then((saved) => {
				const missing = urls.length - saved;
				downloadSetting.setDesc(downloadText(saved, missing));
				downloadBtn.setButtonText("Download").setCta().setDisabled(!s.cacheImages || missing === 0);
			});
		};
		showDownload(imageCache.downloadProgress);

		const cacheSetting = new Setting(containerEl)
			.setName("Clear saved images")
			.setDesc("Counting saved images…")
			.addButton((b) =>
				b.setButtonText("Clear").onClick(async () => {
					b.setDisabled(true);
					try {
						await imageCache.clear();
						this.display();
					} finally {
						b.setDisabled(false);
					}
				}),
			);
		const showStats = () =>
			void imageCache.stats().then(({ files, bytes }) => {
				cacheSetting.setDesc(`${files} image(s), ${(bytes / 1024 / 1024).toFixed(1)} MB.`);
			});
		showStats();
		this.stopListening = imageCache.onDownloadProgress((p) => {
			showDownload(p);
			if (!p.running) showStats();
		});

		new Setting(containerEl).setName("Display").setHeading();

		new Setting(containerEl)
			.setName("Card image style")
			.setDesc("In-game: framed card with cost, stats and rules text on the image. Full art: illustration only.")
			.addDropdown((d) =>
				d
					.addOption("game", "In-game (framed)")
					.addOption("full", "Full art only")
					.setValue(s.cardImageStyle)
					.onChange(async (v) => {
						s.cardImageStyle = v as CardImageStyle;
						await save();
						// Each style has its own images to download.
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName("Default deck view")
			.setDesc("How chrono-deck blocks render. Each block also has a grid/list toggle.")
			.addDropdown((d) =>
				d
					.addOption("grid", "Card grid")
					.addOption("list", "Compact list")
					.setValue(s.deckView)
					.onChange(async (v) => {
						s.deckView = v as DeckView;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Hover previews")
			.setDesc("Show a large card image when hovering card names and tiles (desktop).")
			.addToggle((t) =>
				t.setValue(s.hoverPreviews).onChange(async (v) => {
					s.hoverPreviews = v;
					await save();
				}),
			);

		new Setting(containerEl).setName("Notes").setHeading();

		new Setting(containerEl)
			.setName("Notes folder")
			.setDesc("Deck, matchup and tournament notes are created in sub-folders of this folder. Empty = vault root.")
			.addText((t) =>
				t
					.setPlaceholder("ChronoCCG")
					.setValue(s.notesFolder)
					.onChange(async (v) => {
						s.notesFolder = v.trim().replace(/\/+$/, "");
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Template folder")
			.setDesc(
				'Optional. A "Deck.md" file in this folder replaces the built-in deck note template. ' +
					"Placeholders: {{name}} {{date}} {{deck}} {{code}} {{divers}} {{syndicates}} {{deckLink}} {{opponent}} {{event}}.",
			)
			.addText((t) =>
				t
					.setPlaceholder("ChronoCCG/Templates")
					.setValue(s.templateFolder)
					.onChange(async (v) => {
						s.templateFolder = v.trim().replace(/\/+$/, "");
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Default templates")
			.setDesc("Copy the built-in deck, matchup and tournament templates into the template folder, so you can edit them. Existing files are kept.")
			.addButton((b) =>
				b.setButtonText("Write templates").onClick(async () => {
					await this.plugin.writeDefaultTemplates();
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Log deck changes")
			.setDesc(
				'When you save a deck note from the deck builder, add what changed (cards, Divers, name) to the note\'s "Changelog" section. ' +
					"Saves on the same day are merged into one line.",
			)
			.addToggle((t) =>
				t.setValue(s.deckChangelog).onChange(async (v) => {
					s.deckChangelog = v;
					await save();
				}),
			);
	}

	private async stopSavingImages(): Promise<void> {
		this.plugin.settings.cacheImages = false;
		await this.plugin.saveSettings();
		imageCache.cancelDownload();
		await imageCache.clear();
		this.display();
	}

	private async confirmDownloadAll(urls: string[]): Promise<void> {
		const missing = urls.length - (await imageCache.savedCount(urls));
		if (!missing) return;
		const mb = (kb: number) => Math.max(1, Math.round((missing * kb) / 1024));
		new ConfirmModal(this.app, {
			title: "Download all card images",
			message:
				`This downloads ${missing} card images (about ${mb(ORIGINAL_IMAGE_KB)} MB) and keeps a ${CACHED_IMAGE_WIDTH}px copy of each ` +
				`(about ${mb(CACHED_IMAGE_KB)} MB in the plugin folder). You can keep using Obsidian while it runs.`,
			cta: "Download",
			onConfirm: () => void this.plugin.downloadAllCardImages(),
		}).open();
	}
}
