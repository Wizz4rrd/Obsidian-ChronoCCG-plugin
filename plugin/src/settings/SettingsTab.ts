import { App, PluginSettingTab, Setting } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { DataSourceId } from "../data/DataSync";
import { BuilderDraft, emptyDeck } from "../ui/DeckBuilderView";
import { CACHED_IMAGE_WIDTH, imageCache } from "../utils/ImageCache";

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
	constructor(app: App, private plugin: ChronoCCGPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
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
					"When off, the full-size images (about 1.3 MB each) are loaded every time.",
			)
			.addToggle((t) =>
				t.setValue(s.cacheImages).onChange(async (v) => {
					s.cacheImages = v;
					await save();
				}),
			);

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
		void imageCache.stats().then(({ files, bytes }) => {
			cacheSetting.setDesc(`${files} image(s), ${(bytes / 1024 / 1024).toFixed(1)} MB.`);
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
}
