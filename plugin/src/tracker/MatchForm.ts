import { TFile } from "obsidian";
import { unwrapDeckCode } from "../data/deckInput";
import { Match, MatchResult, today } from "../data/matches";
import { Syndicate, SYNDICATES } from "../data/types";
import { renderSyndicateIcon } from "../ui/SyndicateIcon";

export interface MatchFormOptions {
	decks: TFile[];
	/** Preselected deck; with `lockDeck`, the deck picker is hidden. */
	deck: TFile | null;
	lockDeck?: boolean;
	/** Archetypes logged before, suggested while typing. */
	archetypes: string[];
	/** Patches logged before, newest first, suggested while typing. */
	patches: string[];
	/** The syndicates of a deck code's Divers, or null when it isn't a valid code. */
	codeSyndicates: (code: string) => Syndicate[] | null;
	/** Opponent and archetype of the last game and the latest patch, kept for the next one; a whole game when editing it. */
	initial?: Partial<Match>;
	/** Editing a game: its result button is highlighted. */
	editing?: boolean;
	onSubmit: (file: TFile, match: Match) => void | Promise<void>;
}

let formCount = 0;

/**
 * Deck, opponent's syndicates (up to two), optional archetype /
 * date / patch / opponent's deck code / note, and Win / Loss buttons that record the game.
 * Shared by the match tracker and the "Record match result" modal.
 */
export function renderMatchForm(parent: HTMLElement, opts: MatchFormOptions): { focus: () => void } {
	const form = parent.createDiv({ cls: "chrono-match-form" });
	let deck: TFile | null = opts.deck ?? opts.decks[0] ?? null;
	let opponent: Syndicate[] = (opts.initial?.opponent ?? []).slice();

	const row = (label: string) => {
		const r = form.createDiv({ cls: "chrono-match-row" });
		r.createDiv({ cls: "chrono-match-label", text: label });
		return r.createDiv({ cls: "chrono-match-field" });
	};

	if (!opts.lockDeck) {
		const field = row("Deck");
		if (!opts.decks.length) field.createSpan({ cls: "chrono-match-hint", text: "No deck notes yet. Create one with “New deck note”." });
		else {
			const select = field.createEl("select", { cls: "dropdown" });
			for (const f of opts.decks) select.createEl("option", { text: f.basename, value: f.path });
			if (deck) select.value = deck.path;
			select.addEventListener("change", () => (deck = opts.decks.find((f) => f.path === select.value) ?? null));
		}
	}

	const oppField = row("Opponent");
	const chips = oppField.createDiv({ cls: "chrono-match-synds" });
	const buttons = new Map<Syndicate, HTMLButtonElement>();
	const syncChips = () => buttons.forEach((b, s) => b.toggleClass("is-active", opponent.includes(s)));
	for (const s of SYNDICATES) {
		const b = chips.createEl("button", { cls: ["chrono-syndicate-btn", `chrono-synd-${s.toLowerCase()}`], attr: { type: "button", "aria-label": s } });
		renderSyndicateIcon(b, s);
		b.createSpan({ cls: "chrono-match-synd-name", text: s });
		b.addEventListener("click", () => {
			if (opponent.includes(s)) opponent = opponent.filter((x) => x !== s);
			// A deck has at most two syndicates: a third replaces the oldest pick.
			else opponent = [...opponent, s].slice(-2);
			syncChips();
		});
		buttons.set(s, b);
	}
	syncChips();

	const archetype = archetypeInput(row("Archetype"), opts.initial?.archetype ?? "", opts.archetypes);

	const more = form.createEl("details", { cls: "chrono-match-more" });
	const summary = more.createEl("summary", { text: "Date, patch, opponent's deck, note" });
	const summaryHint = summary.createSpan({ cls: "chrono-match-hint" });
	const moreRow = (label: string) => {
		const r = more.createDiv({ cls: "chrono-match-row" });
		r.createDiv({ cls: "chrono-match-label", text: label });
		return r.createDiv({ cls: "chrono-match-field" });
	};
	const date = moreRow("Date").createEl("input", { type: "date", cls: "chrono-match-input" });
	date.value = opts.initial?.date || today();

	const patchField = moreRow("Patch");
	const patchListId = `chrono-patches-${++formCount}`;
	const patch = patchField.createEl("input", { type: "text", cls: "chrono-match-input", attr: { placeholder: "e.g. 0.11.1", list: patchListId } });
	patch.value = opts.initial?.patch ?? "";
	const patchList = patchField.createEl("datalist", { attr: { id: patchListId } });
	for (const p of opts.patches) patchList.createEl("option", { value: p });
	const syncSummary = () => summaryHint.setText(patch.value.trim() ? ` · patch ${patch.value.trim()}` : "");
	patch.addEventListener("input", syncSummary);
	syncSummary();

	const codeField = moreRow("Opp. deck");
	const code = codeField.createEl("input", { type: "text", cls: "chrono-match-input", attr: { placeholder: "Opponent's deck code, optional", spellcheck: "false" } });
	code.value = opts.initial?.opponentDeck ?? "";
	const codeHint = codeField.createDiv({ cls: "chrono-match-hint" });
	code.addEventListener("input", () => {
		const value = code.value.trim();
		if (!value) return void codeHint.setText("");
		const synds = opts.codeSyndicates(value);
		if (!synds) return void codeHint.setText("Not a valid deck code.");
		// The Divers say which syndicates the opponent played.
		if (synds.length) {
			opponent = synds.slice(0, 2);
			syncChips();
		}
		codeHint.setText(synds.length ? `Opponent set to ${synds.join(" + ")} from the Divers.` : "");
	});

	const note = moreRow("Note").createEl("input", { type: "text", cls: "chrono-match-input", attr: { placeholder: "Optional" } });
	note.value = opts.initial?.note ?? "";
	if (opts.editing) more.open = true;

	const actions = form.createDiv({ cls: "chrono-match-results" });
	const submit = async (result: MatchResult) => {
		if (!deck) return;
		await opts.onSubmit(deck, {
			date: date.value || today(),
			patch: patch.value.trim(),
			result,
			opponent: opponent.slice(),
			archetype: archetype(),
			opponentDeck: unwrapDeckCode(code.value).replace(/\s+/g, ""),
			note: note.value.trim(),
		});
		if (!opts.editing) {
			note.value = code.value = "";
			codeHint.setText("");
		}
	};
	const resultBtn = (result: MatchResult, label: string, cls: string) => {
		const b = actions.createEl("button", { cls: ["chrono-match-result", cls], text: label, attr: { type: "button" } });
		if (opts.editing && opts.initial?.result === result) b.addClass("is-current");
		b.addEventListener("click", () => void submit(result));
	};
	resultBtn("W", opts.editing ? "Save as win" : "Win", "is-win");
	resultBtn("L", opts.editing ? "Save as loss" : "Loss", "is-loss");

	return { focus: () => buttons.get(opponent[0] ?? SYNDICATES[0])?.focus() };
}

/**
 * Free text, suggesting the archetypes logged before; returns a getter for the
 * value. Typing a known archetype in another case ("aggro") gives its logged
 * spelling ("Aggro"), so the stats don't split it in two.
 */
function archetypeInput(field: HTMLElement, value: string, known: string[]): () => string {
	const listId = `chrono-archetypes-${++formCount}`;
	const input = field.createEl("input", { type: "text", cls: "chrono-match-input", attr: { placeholder: "Optional, e.g. Aggro", list: listId } });
	input.value = value;
	const datalist = field.createEl("datalist", { attr: { id: listId } });
	for (const a of known) datalist.createEl("option", { value: a });
	return () => {
		const typed = input.value.trim().replace(/\s+/g, " ");
		return known.find((a) => a.toLowerCase() === typed.toLowerCase()) ?? typed;
	};
}
