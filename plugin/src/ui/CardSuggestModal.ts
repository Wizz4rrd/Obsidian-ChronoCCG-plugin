import { App, FuzzyMatch, FuzzySuggestModal } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { Card } from "../data/types";
import { setCardImage } from "../utils/imageUrl";
import { cardMetaLine } from "./CardPreview";
import { syndicateClass } from "./CardTile";

/** Fuzzy card picker used by the "Insert card…" style commands. */
export class CardSuggestModal extends FuzzySuggestModal<Card> {
	constructor(
		app: App,
		private plugin: ChronoCCGPlugin,
		private onChoose: (card: Card) => void,
		placeholder = "Type a card name…",
	) {
		super(app);
		this.setPlaceholder(placeholder);
		this.limit = 50;
	}

	getItems(): Card[] {
		return this.plugin.cards.all().slice();
	}

	getItemText(card: Card): string {
		return `${card.name} ${card.syndicates.join(" ")} ${card.type} ${card.keywords.join(" ")}`;
	}

	renderSuggestion(match: FuzzyMatch<Card>, el: HTMLElement): void {
		const card = match.item;
		el.addClass("chrono-suggest");
		const img = el.createEl("img", { cls: "chrono-suggest-img", attr: { alt: "", loading: "lazy" } });
		setCardImage(img, card, this.plugin.settings);
		const text = el.createDiv({ cls: "chrono-suggest-text" });
		text.createDiv({ cls: ["chrono-suggest-name", syndicateClass(card)], text: card.name });
		text.createDiv({ cls: "chrono-suggest-meta", text: cardMetaLine(card) });
	}

	onChooseItem(card: Card): void {
		this.onChoose(card);
	}
}
