import { App, ButtonComponent, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
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
	/** Height of the card browser's filters, in % of the pane (the rest is the cards). */
	browserFiltersPercent: number;
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
	browserFiltersPercent: 42,
	builderDraft: { deck: emptyDeck() },
};

/** Keys of {@link ChronoSettings} bound to a declarative control. */
type ControlKey = "dataSource" | "customDataUrl" | "autoRefreshDays" | "cardImageStyle" | "deckView" | "hoverPreviews" | "notesFolder" | "templateFolder" | "deckChangelog";

export class ChronoSettingsTab extends PluginSettingTab {
	/** Rows that show something derived from the settings (e.g. the images to download), redrawn when a setting changes. */
	private refreshers = new Set<() => void>();

	constructor(app: App, private plugin: ChronoCCGPlugin) {
		super(app, plugin);
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof ChronoSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings as unknown as Record<ControlKey, unknown>;
		s[key as ControlKey] = normalizeControlValue(key as ControlKey, value);
		await this.plugin.saveSettings();
		// "Custom data URL" is only shown for the custom source; each image style has its own images to download.
		this.refreshDomState();
		this.refreshers.forEach((refresh) => refresh());
	}

	getSettingDefinitions(): SettingDefinitionItem<ControlKey>[] {
		const s = this.plugin.settings;
		return [
			{
				type: "group",
				heading: "Card data",
				items: [
					{
						name: "Card data source",
						desc: "Where to pull the card database from.",
						control: {
							type: "dropdown",
							key: "dataSource",
							options: { bundled: "Bundled (offline seed)", official: "Official (playchrono.com)", custom: "Custom URL" },
						},
					},
					{
						name: "Custom data URL",
						desc: "JSON endpoint returning a card list or { cards: [...] }.",
						visible: () => s.dataSource === "custom",
						control: { type: "text", key: "customDataUrl", placeholder: "https://example.com/cards.json" },
					},
					{
						name: "Auto-refresh interval (days)",
						desc: "Re-download the card database when it is older than this. 0 disables auto-refresh.",
						control: { type: "number", key: "autoRefreshDays", min: 0, defaultValue: DEFAULT_SETTINGS.autoRefreshDays },
					},
					{
						name: "Refresh card database now",
						desc: "Downloads the card list again.",
						aliases: ["sync", "update cards"],
						render: (setting) => this.renderRefresh(setting),
					},
					{
						name: "Save card images",
						desc:
							`Download each card image once and keep a ${CACHED_IMAGE_WIDTH}px copy in the plugin folder, so cards also show offline. ` +
							"When off, the full-size images (about 1.3 MB each) are loaded every time, and the saved ones are deleted.",
						aliases: ["cache", "offline"],
						render: (setting) => this.renderSaveImages(setting),
					},
					{
						name: "Download all card images",
						desc: "Download every card image that isn't saved yet, so every card also shows offline.",
						aliases: ["offline", "cache"],
						render: (setting) => this.renderDownloadAll(setting),
					},
					{
						name: "Clear saved images",
						desc: "Delete the saved card images and icons.",
						aliases: ["cache"],
						render: (setting) => this.renderClearImages(setting),
					},
				],
			},
			{
				type: "group",
				heading: "Display",
				items: [
					{
						name: "Card image style",
						desc: "In-game: framed card with cost, stats and rules text on the image. Full art: illustration only.",
						control: { type: "dropdown", key: "cardImageStyle", options: { game: "In-game (framed)", full: "Full art only" } },
					},
					{
						name: "Default deck view",
						desc: "How chrono-deck blocks render. Each block also has a grid/list toggle.",
						control: { type: "dropdown", key: "deckView", options: { grid: "Card grid", list: "Compact list" } },
					},
					{
						name: "Hover previews",
						desc: "Show a large card image when hovering card names and tiles (desktop).",
						control: { type: "toggle", key: "hoverPreviews" },
					},
				],
			},
			{
				type: "group",
				heading: "Notes",
				items: [
					{
						name: "Notes folder",
						desc: "Deck, matchup and tournament notes are created in sub-folders of this folder. Empty = vault root.",
						control: { type: "folder", key: "notesFolder", placeholder: "ChronoCCG", includeRoot: true },
					},
					{
						name: "Template folder",
						desc:
							'Optional. A "Deck.md" file in this folder replaces the built-in deck note template. ' +
							"Placeholders: {{name}} {{date}} {{deck}} {{code}} {{divers}} {{syndicates}} {{deckLink}} {{opponent}} {{event}}.",
						control: { type: "folder", key: "templateFolder", placeholder: "ChronoCCG/Templates" },
					},
					{
						name: "Default templates",
						desc: "Copy the built-in deck, matchup and tournament templates into the template folder, so you can edit them. Existing files are kept.",
						render: (setting) => {
							setting.addButton((b) =>
								b.setButtonText("Write templates").onClick(async () => {
									b.setDisabled(true);
									try {
										await this.plugin.writeDefaultTemplates();
									} finally {
										b.setDisabled(false);
									}
								}),
							);
						},
					},
					{
						name: "Log deck changes",
						desc:
							'When you save a deck note from the deck builder, add what changed (cards, Divers, name) to the note\'s "Changelog" section. ' +
							"Saves on the same day are merged into one line.",
						control: { type: "toggle", key: "deckChangelog" },
					},
				],
			},
		];
	}

	/** Run `refresh` now and whenever a setting changes, until the row is torn down. */
	private keepFresh(refresh: () => void): () => void {
		refresh();
		this.refreshers.add(refresh);
		return () => this.refreshers.delete(refresh);
	}

	private renderRefresh(setting: Setting): () => void {
		const s = this.plugin.settings;
		const showStatus = () =>
			setting.setDesc(
				`Loaded cards: ${this.plugin.cards.size} • source: ${this.plugin.cards.source} • version: ${this.plugin.cards.version}` +
					(s.lastSyncIso ? ` • last sync: ${new Date(s.lastSyncIso).toLocaleString()}` : ""),
			);
		setting.addButton((b) =>
			b
				.setCta()
				.setButtonText("Refresh")
				.onClick(async () => {
					b.setDisabled(true).setButtonText("Refreshing…");
					try {
						await this.plugin.refreshCardDatabase();
						// New cards change what "Download all" has to download.
						this.refreshers.forEach((refresh) => refresh());
					} finally {
						b.setDisabled(false).setButtonText("Refresh");
					}
				}),
		);
		return this.keepFresh(showStatus);
	}

	private renderSaveImages(setting: Setting): void {
		const s = this.plugin.settings;
		setting.addToggle((t) =>
			t.setValue(s.cacheImages).onChange(async (v) => {
				if (v === s.cacheImages) return;
				const { files, bytes } = v ? { files: 0, bytes: 0 } : await imageCache.stats();
				if (v || !files) {
					s.cacheImages = v;
					await this.plugin.saveSettings();
					this.refreshers.forEach((refresh) => refresh());
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
	}

	private renderDownloadAll(setting: Setting): () => void {
		const s = this.plugin.settings;
		let urls: string[] = [];
		let downloadBtn!: ButtonComponent;
		setting.addButton((b) => {
			downloadBtn = b;
			b.onClick(() => {
				if (imageCache.downloadProgress?.running) imageCache.cancelDownload();
				else void this.confirmDownloadAll(urls);
			});
		});
		const describe = (saved: number, missing: number): string => {
			if (!s.cacheImages) return 'Turn on "Save card images" first.';
			if (!urls.length) return "No card data yet.";
			if (!missing) return `All ${urls.length} card images are saved.`;
			return (
				`${saved} of ${urls.length} card images are saved. Download the other ${missing} now, so every card also shows offline. ` +
				`They are shrunk to ${CACHED_IMAGE_WIDTH}px like the others.`
			);
		};
		const show = (p: DownloadProgress | null) => {
			if (p?.running) {
				setting.setDesc(`Downloading… ${p.done}/${p.total}${p.failed ? ` (${p.failed} failed)` : ""}`);
				downloadBtn.setButtonText("Cancel").removeCta().setDisabled(false);
				return;
			}
			void imageCache.savedCount(urls).then((saved) => {
				const missing = urls.length - saved;
				setting.setDesc(describe(saved, missing));
				downloadBtn.setButtonText("Download").setCta().setDisabled(!s.cacheImages || missing === 0);
			});
		};
		const stopListening = imageCache.onDownloadProgress(show);
		const stopRefreshing = this.keepFresh(() => {
			// Each image style has its own images.
			urls = cardImageUrls(this.plugin.cards.all(), s);
			show(imageCache.downloadProgress);
		});
		return () => {
			stopListening();
			stopRefreshing();
		};
	}

	private renderClearImages(setting: Setting): () => void {
		const showStats = () =>
			void imageCache.stats().then(({ files, bytes }) => {
				setting.setDesc(`${files} image(s), ${(bytes / 1024 / 1024).toFixed(1)} MB.`);
			});
		setting.addButton((b) =>
			b.setButtonText("Clear").onClick(async () => {
				b.setDisabled(true);
				try {
					await imageCache.clear();
					this.refreshers.forEach((refresh) => refresh());
				} finally {
					b.setDisabled(false);
				}
			}),
		);
		const stopListening = imageCache.onDownloadProgress((p) => {
			if (!p.running) showStats();
		});
		const stopRefreshing = this.keepFresh(showStats);
		return () => {
			stopListening();
			stopRefreshing();
		};
	}

	private async stopSavingImages(): Promise<void> {
		this.plugin.settings.cacheImages = false;
		await this.plugin.saveSettings();
		imageCache.cancelDownload();
		await imageCache.clear();
		this.refreshers.forEach((refresh) => refresh());
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

/** Same clean-up the old text inputs did: trimmed URL, folders without a trailing slash, a valid interval. */
function normalizeControlValue(key: ControlKey, value: unknown): unknown {
	switch (key) {
		case "customDataUrl":
			return typeof value === "string" ? value.trim() : "";
		case "notesFolder":
		case "templateFolder":
			return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
		case "autoRefreshDays": {
			const n = Number(value);
			return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SETTINGS.autoRefreshDays;
		}
		default:
			return value;
	}
}
