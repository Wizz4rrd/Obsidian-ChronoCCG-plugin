import { BasesEntry, BasesPropertyId, BasesView, BasesViewConfig, Keymap, ListValue, QueryController, RenderContext, Value } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { Syndicate, SYNDICATES } from "../data/types";
import { attachCardPreview } from "../ui/CardPreview";
import { syndicateClass, UNKNOWN_CARD_HINT } from "../ui/CardTile";
import { renderSyndicateIcon } from "../ui/SyndicateIcon";

export const DECKS_BASES_VIEW = "chronoccg-decks";

const CARDS_OPTION = "cardProperties";
const SYNDICATES_OPTION = "syndicateProperty";
const DEFAULT_CARDS_PROPERTY = "note.divers";
const DEFAULT_SYNDICATES_PROPERTY = "note.syndicates";

/**
 * A Bases view for deck notes: a table like the built-in one, where card names
 * (the Divers by default) show as inline card references with the hover preview,
 * and syndicates as their icons.
 */
export function registerDecksBasesView(plugin: ChronoCCGPlugin): void {
	plugin.registerBasesView(DECKS_BASES_VIEW, {
		name: "ChronoCCG decks",
		icon: "swords",
		factory: (controller, containerEl) => new DecksBasesView(controller, containerEl, plugin),
		options: () => [
			{
				type: "multitext",
				key: CARDS_OPTION,
				displayName: "Card properties",
				default: [DEFAULT_CARDS_PROPERTY],
			},
			{
				type: "property",
				key: SYNDICATES_OPTION,
				displayName: "Syndicates property",
				default: DEFAULT_SYNDICATES_PROPERTY,
			},
		],
	});
}

class DecksBasesView extends BasesView {
	type = DECKS_BASES_VIEW;
	/** Parent of page previews opened from file names. */
	private hoverParent: RenderContext = { hoverPopover: null };

	constructor(
		controller: QueryController,
		private containerEl: HTMLElement,
		private plugin: ChronoCCGPlugin,
	) {
		super(controller);
	}

	onDataUpdated(): void {
		const root = this.containerEl;
		root.empty();
		root.addClass("chrono-bases-decks");
		const props = this.config.getOrder();
		const cardProps = new Set(cardProperties(this.config));
		const syndicateProp = this.config.getAsPropertyId(SYNDICATES_OPTION) ?? DEFAULT_SYNDICATES_PROPERTY;

		const table = root.createEl("table", { cls: "chrono-bases-table" });
		const head = table.createEl("thead").createEl("tr");
		for (const prop of props) head.createEl("th", { text: this.config.getDisplayName(prop) });

		const body = table.createEl("tbody");
		for (const group of this.data.groupedData) {
			if (group.hasKey()) {
				const row = body.createEl("tr", { cls: "chrono-bases-group" });
				row.createEl("td", { text: group.key?.toString() ?? "", attr: { colspan: String(Math.max(1, props.length)) } });
			}
			for (const entry of group.entries) {
				const row = body.createEl("tr");
				for (const prop of props) {
					const cell = row.createEl("td");
					if (prop === "file.name") this.renderFileLink(cell, entry);
					else if (cardProps.has(prop)) this.renderCards(cell, entry.getValue(prop));
					else if (prop === syndicateProp) renderSyndicates(cell, entry.getValue(prop));
					else entry.getValue(prop)?.renderTo(cell, this.hoverParent);
				}
			}
		}
		if (!this.data.data.length) root.createDiv({ cls: "chrono-bases-empty", text: "No deck notes match this view." });
	}

	private renderFileLink(cell: HTMLElement, entry: BasesEntry): void {
		const file = entry.file;
		const link = cell.createEl("a", { cls: "internal-link", text: file.basename, href: file.path });
		link.addEventListener("click", (evt) => {
			evt.preventDefault();
			void this.app.workspace.openLinkText(file.path, "", Keymap.isModEvent(evt));
		});
		link.addEventListener("mouseover", (evt) => {
			this.app.workspace.trigger("hover-link", {
				event: evt,
				source: "bases",
				hoverParent: this.hoverParent,
				targetEl: link,
				linktext: file.path,
			});
		});
	}

	/** Card names as inline card references: coloured, with the hover preview; click opens the card. */
	private renderCards(cell: HTMLElement, value: Value | null): void {
		const names = textValues(value);
		names.forEach((name, i) => {
			if (i) cell.appendText(", ");
			const card = this.plugin.cards.resolve(name);
			if (!card) {
				cell.createSpan({ cls: ["chrono-card-ref", "is-unknown"], text: name, attr: { "aria-label": UNKNOWN_CARD_HINT } });
				return;
			}
			const ref = cell.createSpan({ cls: ["chrono-card-ref", syndicateClass(card)], text: card.name, attr: { tabindex: "0" } });
			attachCardPreview(this.plugin, ref, card, { tapToOpen: true });
		});
	}
}

/** Card properties picked in the view options; the Divers by default. */
function cardProperties(config: BasesViewConfig): BasesPropertyId[] {
	const picked = config.get(CARDS_OPTION);
	const list = Array.isArray(picked) ? picked.filter((p): p is string => typeof p === "string" && p.trim() !== "") : [];
	return (list.length ? list : [DEFAULT_CARDS_PROPERTY]).map((p) => (p.includes(".") ? p : `note.${p}`) as BasesPropertyId);
}

/** Syndicate icons with the name as tooltip; anything that isn't a syndicate stays text. */
function renderSyndicates(cell: HTMLElement, value: Value | null): void {
	const wrap = cell.createSpan({ cls: "chrono-bases-syndicates" });
	for (const name of textValues(value)) {
		const s = SYNDICATES.find((x: Syndicate) => x.toLowerCase() === name.toLowerCase());
		if (!s) {
			wrap.createSpan({ text: name });
			continue;
		}
		const icon = renderSyndicateIcon(wrap, s);
		icon.setAttr("aria-hidden", "false");
		icon.setAttr("aria-label", s);
	}
}

/** The text of each item of a list property, or of a single value. */
function textValues(value: Value | null): string[] {
	if (!value || !value.isTruthy()) return [];
	if (value instanceof ListValue) {
		const out: string[] = [];
		for (let i = 0; i < value.length(); i++) out.push(value.get(i).toString());
		return out.map((s) => s.trim()).filter(Boolean);
	}
	const text = value.toString().trim();
	return text ? [text] : [];
}
