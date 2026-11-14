import { App, TFile } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { DECK_NOTE_TYPE, deckProperties, DeckPropertyKey, staleProperties } from "../data/deckProperties";
import { Deck } from "../data/types";

/** Frontmatter of `file` when it is a deck note (`type: chrono-deck`). */
export function deckNoteFrontmatter(app: App, file: TFile): Record<string, unknown> | null {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	return fm?.type === DECK_NOTE_TYPE ? fm : null;
}

/** Derived properties of a deck note that no longer match `deck`. */
export function outdatedDeckProperties(plugin: ChronoCCGPlugin, file: TFile, deck: Deck): DeckPropertyKey[] {
	const fm = deckNoteFrontmatter(plugin.app, file);
	return fm ? staleProperties(fm, deckProperties(deck, plugin.cards)) : [];
}

/** Bring a deck note's `deck`, `syndicates`, `divers` and `code` in line with `deck`. Returns the properties that changed. */
export async function updateDeckNoteProperties(plugin: ChronoCCGPlugin, file: TFile, deck: Deck): Promise<DeckPropertyKey[]> {
	if (!outdatedDeckProperties(plugin, file, deck).length) return [];
	const expected = deckProperties(deck, plugin.cards);
	let changed: DeckPropertyKey[] = [];
	await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		if (fm.type !== DECK_NOTE_TYPE) return;
		changed = staleProperties(fm, expected);
		for (const key of changed) fm[key] = expected[key];
	});
	return changed;
}
