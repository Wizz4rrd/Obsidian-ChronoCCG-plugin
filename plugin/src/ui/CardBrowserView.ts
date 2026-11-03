import { ItemView, Menu, Notice, WorkspaceLeaf } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { Card, SYNDICATES, Syndicate } from "../data/types";
import { attachCardPreview, CardDetailModal } from "./CardPreview";
import { renderCardTile } from "./CardTile";

export const VIEW_TYPE_CARD_BROWSER = "chronoccg-card-browser";

function parseCostInput(value: string): number | undefined {
	const t = value.trim();
	if (!t) return undefined;
	const n = Number(t);
	return Number.isFinite(n) ? n : undefined;
}

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
	private minCostInput!: HTMLInputElement;
	private maxCostInput!: HTMLInputElement;
	private filterSourceKey = "";

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
			this.refresh();
		});

		const workspace = root.createDiv({ cls: "chrono-browser-workspace" });
		const filtersPanel = workspace.createDiv({ cls: "chrono-browser-filters-panel" });

		const costSection = filtersPanel.createDiv({ cls: "chrono-browser-section" });
		costSection.createDiv({ cls: "chrono-browser-section-title", text: "Energy cost" });
		const costRow = costSection.createDiv({ cls: "chrono-filter-cost chrono-filter-cost--panel" });
		this.minCostInput = costRow.createEl("input", {
			type: "number",
			cls: "chrono-filter-num",
			attr: { min: "0", placeholder: "Min" },
		});
		costRow.createSpan({ text: "–", cls: "chrono-filter-cost-sep" });
		this.maxCostInput = costRow.createEl("input", {
			type: "number",
			cls: "chrono-filter-num",
			attr: { min: "0", placeholder: "Max" },
		});
		const bumpSearch = () => this.refresh();
		this.minCostInput.addEventListener("input", bumpSearch);
		this.maxCostInput.addEventListener("input", bumpSearch);

		const syndSection = filtersPanel.createDiv({ cls: "chrono-browser-section" });
		syndSection.createDiv({ cls: "chrono-browser-section-title", text: "Syndicates" });
		const syndRow = syndSection.createDiv({ cls: "chrono-filter-chips" });
		for (const s of SYNDICATES) {
			const btn = syndRow.createEl("button", { text: s, cls: "chrono-syndicate-btn" });
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

		this.statusEl = workspace.createDiv({ cls: "chrono-browser-status" });
		this.resultsEl = workspace.createDiv({ cls: "chrono-browser-results" });

		this.refresh();
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
		this.minCostInput.value = "";
		this.maxCostInput.value = "";
		this.contentEl.querySelectorAll(".chrono-syndicate-btn, .chrono-filter-chip").forEach((el) => {
			el.classList.remove("is-active");
		});
		this.refresh();
	}

	private filterActiveCount(): number {
		let n = this.syndicateFilter.size + this.typeFilter.size + this.rarityFilter.size + this.spellSpeedFilter.size;
		n += this.keywordFilter.size + this.setFilter.size;
		if (this.query.trim()) n++;
		if (parseCostInput(this.minCostInput.value) !== undefined) n++;
		if (parseCostInput(this.maxCostInput.value) !== undefined) n++;
		return n;
	}

	refresh(): void {
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

		const minCost = parseCostInput(this.minCostInput.value);
		const maxCost = parseCostInput(this.maxCostInput.value);

		const matches = this.plugin.cards.search(
			{
				text: this.query || undefined,
				syndicates: this.syndicateFilter.size ? Array.from(this.syndicateFilter) : undefined,
				types: this.typeFilter.size ? Array.from(this.typeFilter) : undefined,
				rarities: this.rarityFilter.size ? Array.from(this.rarityFilter) : undefined,
				spellSpeeds: this.spellSpeedFilter.size ? Array.from(this.spellSpeedFilter) : undefined,
				keywords: this.keywordFilter.size ? Array.from(this.keywordFilter) : undefined,
				sets: this.setFilter.size ? Array.from(this.setFilter) : undefined,
				minCost,
				maxCost,
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
		menu.addItem((i) => i.setTitle("Add to deck builder").setIcon("plus").onClick(() => void this.plugin.addToBuilder(card, false)));
		if (/agent|unit/i.test(card.type)) {
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
