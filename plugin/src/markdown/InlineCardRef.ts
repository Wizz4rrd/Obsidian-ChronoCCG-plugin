import { syntaxTree } from "@codemirror/language";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import type ChronoVaultPlugin from "../../main";
import { attachCardPreview, hideCardPopover, showCardPopover } from "../ui/CardPreview";
import { syndicateClass, UNKNOWN_CARD_HINT } from "../ui/CardTile";

/**
 * Inline card references: `chrono:Hush Now` or `chrono:140` (inline code).
 *
 * - Reading view and Live Preview: the inline code is replaced by a coloured
 *   card name with a hover preview; clicking opens the card. In Live Preview
 *   the source comes back when the cursor touches it.
 * - Source mode: the inline code stays as-is but hovering it shows the preview.
 */
export const INLINE_PREFIX = "chrono:";

export function registerInlineCardRefs(plugin: ChronoVaultPlugin): void {
	plugin.registerMarkdownPostProcessor((el) => {
		el.querySelectorAll("code").forEach((code) => {
			if (code.parentElement?.tagName === "PRE") return;
			const text = code.textContent ?? "";
			if (!isCardRef(text)) return;
			code.replaceWith(renderCardRef(plugin, text));
		});
	});

	plugin.registerEditorExtension(livePreviewCardRefs(plugin));

	// Source mode hover: delegate on the document so it covers every editor instance.
	plugin.registerDomEvent(activeDocument, "mouseover", (evt) => {
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

/** Coloured card name for a `chrono:` reference, or a marked-up placeholder when the card is unknown. */
function renderCardRef(plugin: ChronoVaultPlugin, text: string): HTMLElement {
	const card = refToCard(plugin, text);
	if (!card) {
		return createSpan({
			cls: ["chrono-card-ref", "is-unknown"],
			text: refName(text),
			attr: { "aria-label": UNKNOWN_CARD_HINT },
		});
	}
	const span = createSpan({ cls: ["chrono-card-ref", syndicateClass(card)], text: card.name });
	span.setAttr("tabindex", "0");
	attachCardPreview(plugin, span, card, { tapToOpen: true });
	return span;
}

/**
 * Plain text (e.g. a game's note) into `parent`, with its `chrono:` inline
 * code as card references and other inline code as code.
 */
export function renderTextWithCardRefs(plugin: ChronoVaultPlugin, parent: HTMLElement, text: string): void {
	text.split(/(`[^`]+`)/).forEach((part, i) => {
		// Odd parts are the backticked ones.
		if (i % 2 === 0) return void (part && parent.appendText(part));
		const inner = part.slice(1, -1);
		if (isCardRef(inner)) parent.appendChild(renderCardRef(plugin, inner));
		else parent.createEl("code", { text: inner });
	});
}

function isCardRef(text: string): boolean {
	return text.trim().toLowerCase().startsWith(INLINE_PREFIX);
}

function refName(text: string): string {
	return text.trim().slice(INLINE_PREFIX.length).trim();
}

function refToCard(plugin: ChronoVaultPlugin, text: string) {
	if (!isCardRef(text)) return undefined;
	return plugin.cards.resolve(refName(text));
}

// ---- Live Preview -----------------------------------------------------------

class CardRefWidget extends WidgetType {
	constructor(
		private plugin: ChronoVaultPlugin,
		private text: string,
		private cardsVersion: string,
	) {
		super();
	}

	eq(other: CardRefWidget): boolean {
		return other.text === this.text && other.cardsVersion === this.cardsVersion;
	}

	toDOM(): HTMLElement {
		return renderCardRef(this.plugin, this.text);
	}

	/** Let the widget handle its own clicks (open the card) instead of the editor. */
	ignoreEvent(): boolean {
		return true;
	}
}

function livePreviewCardRefs(plugin: ChronoVaultPlugin) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private cardsVersion = plugin.cards.version;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(plugin, view);
			}

			update(u: ViewUpdate): void {
				const cardsChanged = this.cardsVersion !== plugin.cards.version;
				const modeChanged = u.startState.field(editorLivePreviewField) !== u.state.field(editorLivePreviewField);
				if (u.docChanged || u.viewportChanged || u.selectionSet || cardsChanged || modeChanged) {
					this.cardsVersion = plugin.cards.version;
					this.decorations = buildDecorations(plugin, u.view);
				}
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

function buildDecorations(plugin: ChronoVaultPlugin, view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const state = view.state;
	if (!state.field(editorLivePreviewField)) return builder.finish();

	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter: (node) => {
				const name = node.type.name;
				if (!name.includes("inline-code") || name.includes("formatting")) return;
				const text = state.doc.sliceString(node.from, node.to);
				if (!isCardRef(text)) return;
				const [start, end] = withBackticks(state, node.from, node.to);
				if (selectionTouches(state, start, end)) return;
				builder.add(
					start,
					end,
					Decoration.replace({ widget: new CardRefWidget(plugin, text, plugin.cards.version) }),
				);
			},
		});
	}
	return builder.finish();
}

/** Widen an inline-code content range to include its backtick delimiters. */
function withBackticks(state: EditorState, from: number, to: number): [number, number] {
	let start = from;
	let end = to;
	while (start > 0 && state.doc.sliceString(start - 1, start) === "`") start--;
	while (end < state.doc.length && state.doc.sliceString(end, end + 1) === "`") end++;
	return [start, end];
}

function selectionTouches(state: EditorState, from: number, to: number): boolean {
	return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}
