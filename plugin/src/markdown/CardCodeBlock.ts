import type ChronoCCGPlugin from "../../main";
import { attachCardPreview } from "../ui/CardPreview";
import { renderCardTile, renderUnknownCardTile } from "../ui/CardTile";

/**
 * ```chrono-card
 * Hush Now
 * 140
 * full
 * ```
 *
 * One card per line (numeric id or name). A line `full` renders large cards
 * with keywords/text.
 */
export function registerCardCodeBlock(plugin: ChronoCCGPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor("chrono-card", (source, el) => {
		el.empty();
		const lines = source
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"));
		const isFull = lines.some((l) => l.toLowerCase() === "full");
		const refs = lines.filter((l) => l.toLowerCase() !== "full");
		if (refs.length === 0) {
			el.createEl("p", { cls: "chrono-deck-hint", text: "chrono-card: missing card id or name." });
			return;
		}
		const row = el.createDiv({ cls: "chrono-card-row" });
		for (const ref of refs.slice(0, 50)) {
			const card = plugin.cards.resolve(ref);
			if (!card) {
				renderUnknownCardTile(row, ref);
				continue;
			}
			const tile = renderCardTile(row, card, plugin.settings, { size: isFull ? "full" : "thumb", showText: isFull });
			tile.addClass("is-clickable");
			attachCardPreview(plugin, tile, card, { tapToOpen: true });
		}
	});
}
