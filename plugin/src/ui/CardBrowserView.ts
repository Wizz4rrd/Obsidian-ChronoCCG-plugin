import { debounce, ItemView, Menu, Notice, WorkspaceLeaf } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { DEFAULT_SETTINGS } from "../settings/SettingsTab";
import { isDiverEligible } from "../data/DeckRules";
import { Card, SYNDICATES, Syndicate } from "../data/types";
import { attachCardPreview, CardDetailModal } from "./CardPreview";
import { renderCardTile } from "./CardTile";
import { CostChips, renderCostChips } from "./CostChips";
import { renderSyndicateIcon } from "./SyndicateIcon";
import { imageCache } from "../utils/ImageCache";

export const VIEW_TYPE_CARD_BROWSER = "chronoccg-card-browser";

/** Limits of the filters' share of the pane, so neither side can be dragged away. */
const MIN_FILTERS_PERCENT = 10;
const MAX_FILTERS_PERCENT = 85;

export class CardBrowserView extends ItemView {
	private query = "";
	private syndicateFilter: Set<Syndicate> = new Set();
	private typeFilter = new Set<string>();
	private rarityFilter = new Set<string>();
	private spellSpeedFilter = new Set<string>();
	private keywordFilter = new Set<string>();
	private setFilter = new Set<string>();
	private resultsEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private dynamicFiltersEl!: HTMLElement;
	private clearBtn!: HTMLButtonElement;
	private searchInput!: HTMLInputElement;
	private costFilter = new Set<number>();
	private costChips!: CostChips;
	private filterSourceKey = "";
	private refreshSoon = debounce(() => this.refresh(), 150, true);

	constructor(leaf: WorkspaceLeaf, private plugin: ChronoCCGPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_CARD_BROWSER;
	}

	getDisplayText(): string {
		return "ChronoCCG cards";
	}

	getIcon(): string {
		return "layers";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("chrono-card-browser");

		const toolbar = root.createDiv({ cls: "chrono-browser-toolbar" });
		const toolbarInner = toolbar.createDiv({ cls: "chrono-browser-toolbar-inner" });

		this.searchInput = toolbarInner.createEl("input", {
			type: "text",
			placeholder: "Search cards…",
			cls: "chrono-browser-search",
		});
		this.searchInput.addEventListener("input", () => {
			this.query = this.searchInput.value;
			this.refreshSoon();
		});

		const workspace = root.createDiv({ cls: "chrono-browser-workspace" });
		const filtersPanel = workspace.createDiv({ cls: "chrono-browser-filters-panel" });

		const costSection = filtersPanel.createDiv({ cls: "chrono-browser-section" });
		costSection.createDiv({ cls: "chrono-browser-section-title", text: "Energy cost" });
		this.costChips = renderCostChips(costSection, this.costFilter, () => this.refresh());

		const syndSection = filtersPanel.createDiv({ cls: "chrono-browser-section" });
		syndSection.createDiv({ cls: "chrono-browser-section-title", text: "Syndicates" });
		const syndRow = syndSection.createDiv({ cls: "chrono-filter-chips" });
		for (const s of SYNDICATES) {
			const btn = syndRow.createEl("button", { cls: "chrono-syndicate-btn" });
			renderSyndicateIcon(btn, s);
			btn.appendText(s);
			btn.addEventListener("click", () => {
				if (this.syndicateFilter.has(s)) this.syndicateFilter.delete(s);
				else this.syndicateFilter.add(s);
				btn.toggleClass("is-active", this.syndicateFilter.has(s));
				this.refresh();
			});
		}

		this.dynamicFiltersEl = filtersPanel.createDiv({ cls: "chrono-browser-dynamic-filters" });

		const actions = filtersPanel.createDiv({ cls: "chrono-browser-filter-actions" });
		this.clearBtn = actions.createEl("button", { cls: "chrono-browser-clear", text: "Clear filters" });
		this.clearBtn.addEventListener("click", () => this.clearAllFilters());

		this.addResizeHandle(workspace, filtersPanel);
		this.statusEl = workspace.createDiv({ cls: "chrono-browser-status" });
		this.resultsEl = workspace.createDiv({ cls: "chrono-browser-results" });

		this.refresh();
	}

	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		// Where it is now: tabs can also be dragged between the sidebar and the main area.
		const root = this.leaf.getRoot();
		const inSidebar = root === this.app.workspace.rightSplit || root === this.app.workspace.leftSplit;
		menu.addItem((item) =>
			item
				.setTitle(inSidebar ? "Open as page" : "Move to sidebar")
				.setIcon(inSidebar ? "file" : "panel-right")
				.setSection("pane")
				.onClick(() => void this.plugin.setCardBrowserPlacement(inSidebar ? "tab" : "sidebar")),
		);
	}

	/** Drag handle between the filters and the cards (mouse, touch and arrow keys; double-click resets it). */
	private addResizeHandle(workspace: HTMLElement, filtersPanel: HTMLElement): void {
		const s = this.plugin.settings;
		const apply = (percent: number) => {
			s.browserFiltersPercent = Math.round(Math.min(MAX_FILTERS_PERCENT, Math.max(MIN_FILTERS_PERCENT, percent)) * 10) / 10;
			filtersPanel.setCssProps({ "--chrono-filters-size": `${s.browserFiltersPercent}%` });
			handle.setAttr("aria-valuenow", String(Math.round(s.browserFiltersPercent)));
		};
		const save = () => void this.plugin.saveSettings();
		const handle = workspace.createDiv({
			cls: "chrono-browser-resize",
			attr: {
				role: "separator",
				tabindex: "0",
				"aria-orientation": "horizontal",
				"aria-label": "Resize filters",
				"aria-valuemin": String(MIN_FILTERS_PERCENT),
				"aria-valuemax": String(MAX_FILTERS_PERCENT),
			},
		});
		apply(s.browserFiltersPercent);

		handle.addEventListener("pointerdown", (evt) => {
			if (evt.button !== 0) return;
			evt.preventDefault();
			handle.setPointerCapture(evt.pointerId);
			handle.addClass("is-dragging");
			const startY = evt.clientY;
			const startHeight = filtersPanel.getBoundingClientRect().height;
			const total = workspace.getBoundingClientRect().height || 1;
			const move = (e: PointerEvent) => apply(((startHeight + e.clientY - startY) / total) * 100);
			const end = () => {
				handle.removeClass("is-dragging");
				handle.removeEventListener("pointermove", move);
				handle.removeEventListener("pointerup", end);
				handle.removeEventListener("pointercancel", end);
				save();
			};
			handle.addEventListener("pointermove", move);
			handle.addEventListener("pointerup", end);
			handle.addEventListener("pointercancel", end);
		});
		handle.addEventListener("dblclick", () => {
			apply(DEFAULT_SETTINGS.browserFiltersPercent);
			save();
		});
		handle.addEventListener("keydown", (evt) => {
			const step = evt.key === "ArrowUp" ? -5 : evt.key === "ArrowDown" ? 5 : 0;
			if (!step) return;
			evt.preventDefault();
			apply(s.browserFiltersPercent + step);
			save();
		});
	}

	async onClose(): Promise<void> {
		// nothing
	}

	private clearAllFilters(): void {
		this.syndicateFilter.clear();
		this.typeFilter.clear();
		this.rarityFilter.clear();
		this.spellSpeedFilter.clear();
		this.keywordFilter.clear();
		this.setFilter.clear();
		this.query = "";
		this.searchInput.value = "";
		this.costFilter.clear();
		this.costChips.sync();
		this.contentEl.querySelectorAll(".chrono-syndicate-btn, .chrono-filter-chip").forEach((el) => {
			el.classList.remove("is-active");
		});
		this.refresh();
	}

	private filterActiveCount(): number {
		let n = this.syndicateFilter.size + this.typeFilter.size + this.rarityFilter.size + this.spellSpeedFilter.size;
		n += this.keywordFilter.size + this.setFilter.size;
		if (this.query.trim()) n++;
		if (this.costFilter.size) n++;
		return n;
	}

	refresh(): void {
		imageCache.forget(this.resultsEl);
		this.resultsEl.empty();

		const active = this.filterActiveCount();
		this.clearBtn.disabled = active === 0;

		if (this.plugin.cards.size === 0) {
			this.statusEl.setText('No cards loaded. Open Settings → ChronoCCG and click "Refresh".');
			this.dynamicFiltersEl.empty();
			this.filterSourceKey = "";
			return;
		}

		this.ensureDynamicFilterChips();

		const matches = this.plugin.cards.search(
			{
				text: this.query || undefined,
				syndicates: this.syndicateFilter.size ? Array.from(this.syndicateFilter) : undefined,
				types: this.typeFilter.size ? Array.from(this.typeFilter) : undefined,
				rarities: this.rarityFilter.size ? Array.from(this.rarityFilter) : undefined,
				spellSpeeds: this.spellSpeedFilter.size ? Array.from(this.spellSpeedFilter) : undefined,
				keywords: this.keywordFilter.size ? Array.from(this.keywordFilter) : undefined,
				sets: this.setFilter.size ? Array.from(this.setFilter) : undefined,
				costs: this.costFilter,
			},
			500,
		);

		const filt = active > 0 ? ` • ${active} filter${active === 1 ? "" : "s"}` : "";
		this.statusEl.setText(`${matches.length} / ${this.plugin.cards.size} cards${filt}`);

		for (const card of matches) {
			this.renderResult(card);
		}
	}

	private ensureDynamicFilterChips(): void {
		const key = `${this.plugin.cards.version}|${this.plugin.cards.size}`;
		if (key === this.filterSourceKey && this.dynamicFiltersEl.childElementCount > 0) return;

		this.filterSourceKey = key;
		this.typeFilter.clear();
		this.rarityFilter.clear();
		this.spellSpeedFilter.clear();
		this.keywordFilter.clear();
		this.setFilter.clear();
		this.dynamicFiltersEl.empty();

		const addSection = (title: string) => {
			const section = this.dynamicFiltersEl.createDiv({ cls: "chrono-browser-section" });
			section.createDiv({ cls: "chrono-browser-section-title", text: title });
			return section.createDiv({ cls: "chrono-filter-chips" });
		};

		const speeds = this.plugin.cards.distinctSpellSpeeds();
		if (speeds.length) {
			const row = addSection("Spell speed");
			for (const sp of speeds) {
				const btn = row.createEl("button", { text: sp, cls: "chrono-filter-chip" });
				btn.addEventListener("click", () => {
					if (this.spellSpeedFilter.has(sp)) this.spellSpeedFilter.delete(sp);
					else this.spellSpeedFilter.add(sp);
					btn.toggleClass("is-active", this.spellSpeedFilter.has(sp));
					this.refresh();
				});
			}
		}

		const rarities = this.plugin.cards.distinctRarities();
		if (rarities.length) {
			const row = addSection("Rarity");
			for (const r of rarities) {
				const btn = row.createEl("button", { text: r, cls: "chrono-filter-chip" });
				btn.addEventListener("click", () => {
					if (this.rarityFilter.has(r)) this.rarityFilter.delete(r);
					else this.rarityFilter.add(r);
					btn.toggleClass("is-active", this.rarityFilter.has(r));
					this.refresh();
				});
			}
		}

		const types = this.plugin.cards.distinctTypes();
		if (types.length) {
			const row = addSection("Card type");
			for (const t of types) {
				const btn = row.createEl("button", { text: t, cls: "chrono-filter-chip" });
				btn.addEventListener("click", () => {
					if (this.typeFilter.has(t)) this.typeFilter.delete(t);
					else this.typeFilter.add(t);
					btn.toggleClass("is-active", this.typeFilter.has(t));
					this.refresh();
				});
			}
		}

		this.addChipSection("Keyword", this.plugin.cards.distinctKeywords(), this.keywordFilter);
		this.addChipSection("Set", this.plugin.cards.distinctSets(), this.setFilter);
	}

	private addChipSection(title: string, values: string[], filter: Set<string>): void {
		if (!values.length) return;
		const section = this.dynamicFiltersEl.createDiv({ cls: "chrono-browser-section" });
		section.createDiv({ cls: "chrono-browser-section-title", text: title });
		const row = section.createDiv({ cls: "chrono-filter-chips" });
		for (const v of values) {
			const btn = row.createEl("button", { text: v, cls: "chrono-filter-chip" });
			btn.addEventListener("click", () => {
				if (filter.has(v)) filter.delete(v);
				else filter.add(v);
				btn.toggleClass("is-active", filter.has(v));
				this.refresh();
			});
		}
	}

	private renderResult(card: Card): void {
		const tile = renderCardTile(this.resultsEl, card, this.plugin.settings, { size: "thumb" });
		tile.addClass("chrono-browser-card");
		tile.setAttr("tabindex", "0");
		tile.setAttr("aria-label", `${card.name} — click for actions`);
		attachCardPreview(this.plugin, tile.querySelector(".chrono-card-tile-visual") as HTMLElement, card);
		const open = (evt: MouseEvent | KeyboardEvent) => this.showCardMenu(card, evt);
		tile.addEventListener("click", open);
		tile.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			open(evt);
		});
		tile.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				open(evt);
			}
		});
	}

	private showCardMenu(card: Card, evt: MouseEvent | KeyboardEvent): void {
		const insert = (text: string) => {
			const editor = this.app.workspace.activeEditor?.editor;
			if (!editor) return void new Notice("Open a note in edit mode to insert cards.");
			editor.replaceSelection(text);
		};
		const menu = new Menu();
		menu.addItem((i) => i.setTitle("Insert inline reference").setIcon("text-cursor-input").onClick(() => insert(`\`chrono:${card.name}\``)));
		menu.addItem((i) => i.setTitle("Insert card block").setIcon("image").onClick(() => insert("```chrono-card\n" + card.name + "\n```\n")));
		menu.addSeparator();
		if (card.collectible !== false) {
			menu.addItem((i) => i.setTitle("Add to deck builder").setIcon("plus").onClick(() => void this.plugin.addToBuilder(card, false)));
		}
		if (isDiverEligible(card)) {
			menu.addItem((i) => i.setTitle("Set as Diver").setIcon("crown").onClick(() => void this.plugin.addToBuilder(card, true)));
		}
		menu.addItem((i) => i.setTitle("Show details").setIcon("info").onClick(() => new CardDetailModal(this.app, this.plugin, card).open()));
		if (evt instanceof MouseEvent) menu.showAtMouseEvent(evt);
		else {
			const r = (evt.target as HTMLElement).getBoundingClientRect();
			menu.showAtPosition({ x: r.left, y: r.bottom });
		}
	}
}
