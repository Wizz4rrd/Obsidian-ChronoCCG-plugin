import type ChronoCCGPlugin from "../../main";
import { attachCardPreview, hideCardPopover, showCardPopover } from "../ui/CardPreview";
import { syndicateClass } from "../ui/CardTile";

/**
 * Inline card references: `chrono:Hush Now` or `chrono:140` (inline code).
 *
 * - Reading view: the inline code is replaced by a coloured card name with a
 *   hover preview (tap opens the card on mobile).
 * - Live Preview / source mode: the inline code stays as-is but hovering it
 *   shows the same preview (desktop only; mobile users switch to reading view).
 */
export const INLINE_PREFIX = "chrono:";

export function registerInlineCardRefs(plugin: ChronoCCGPlugin): void {
	plugin.registerMarkdownPostProcessor((el) => {
		el.querySelectorAll("code").forEach((code) => {
			if (code.parentElement?.tagName === "PRE") return;
			const text = code.textContent ?? "";
			if (!text.trim().toLowerCase().startsWith(INLINE_PREFIX)) return;
			const card = refToCard(plugin, text);
			if (!card) {
				code.addClass("chrono-card-ref-missing");
				code.setAttr("aria-label", "ChronoCCG: unknown card");
				return;
			}
			const span = createSpan({ cls: ["chrono-card-ref", syndicateClass(card)], text: card.name });
			span.setAttr("tabindex", "0");
			attachCardPreview(plugin, span, card, { tapToOpen: true });
			code.replaceWith(span);
		});
	});

	// Editor hover: delegate on the document so it covers every editor instance.
	plugin.registerDomEvent(document, "mouseover", (evt) => {
		const target = evt.target as HTMLElement | null;
		const code = target?.closest?.(".cm-inline-code");
		if (!code) return;
		const card = refToCard(plugin, code.textContent ?? "");
		if (!card) return;
		showCardPopover(plugin, card, evt);
		const leave = () => {
			hideCardPopover(code.ownerDocument);
			code.removeEventListener("mouseleave", leave);
		};
		code.addEventListener("mouseleave", leave);
	});
}

function refToCard(plugin: ChronoCCGPlugin, text: string) {
	const t = text.trim();
	if (!t.toLowerCase().startsWith(INLINE_PREFIX)) return undefined;
	return plugin.cards.resolve(t.slice(INLINE_PREFIX.length));
}
