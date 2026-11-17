import { currentStreak, formatRate, formatRecord, Match, MatchRecord, MatchResult, pairingLabel, SMALL_SAMPLE, tally, weeklyRecords, winRate } from "../data/matches";
import { Syndicate, SYNDICATES } from "../data/types";
import { renderSyndicateIcon } from "../ui/SyndicateIcon";

/** Opponent's syndicate icons and names ("Unknown" without any). */
export function renderPairing(parent: HTMLElement, opponent: Syndicate[], withNames = true): HTMLElement {
	const el = parent.createSpan({ cls: "chrono-match-pairing", attr: { "aria-label": pairingLabel(opponent) } });
	for (const s of opponent) renderSyndicateIcon(el, s);
	if (withNames || !opponent.length) el.createSpan({ text: pairingLabel(opponent) });
	return el;
}

/** "Silence + Sungrace" back to its syndicates. */
export function pairingFromLabel(label: string): Syndicate[] {
	return SYNDICATES.filter((s) => label.split(" + ").includes(s));
}

export function renderResultChip(parent: HTMLElement, result: MatchResult): HTMLElement {
	const cls = result === "W" ? "is-win" : "is-loss";
	return parent.createSpan({ cls: ["chrono-match-chip", cls], text: result });
}

/** Win-rate bar with the percentage; tinted from red (0%) to green (100%). */
export function renderRateBar(parent: HTMLElement, record: MatchRecord): HTMLElement {
	const rate = winRate(record);
	const el = parent.createDiv({ cls: "chrono-match-rate" });
	const bar = el.createDiv({ cls: "chrono-match-rate-bar" });
	const fill = bar.createDiv({ cls: "chrono-match-rate-fill" });
	if (rate !== null) {
		fill.setCssProps({ "--chrono-rate": `${Math.round(rate * 100)}%` });
		fill.addClass(rateClass(rate));
	}
	el.createSpan({ cls: "chrono-match-rate-text", text: formatRate(rate) });
	return el;
}

export function rateClass(rate: number | null): string {
	if (rate === null) return "is-none";
	if (rate >= 0.6) return "is-good";
	if (rate >= 0.5) return "is-ok";
	if (rate >= 0.4) return "is-meh";
	return "is-bad";
}

/**
 * A table of records: one row per group, with games, W–L and the win-rate bar.
 * Rows without games are muted, rows with fewer than SMALL_SAMPLE games faded.
 * `onClick` makes a row a filter.
 */
export function renderRecordTable(
	parent: HTMLElement,
	headers: [string, ...string[]],
	rows: Array<{ label: (cell: HTMLElement) => void; record: MatchRecord; onClick?: () => void }>,
): HTMLTableElement {
	// Scrolls sideways rather than spilling out of its card on a narrow pane.
	const table = parent.createDiv({ cls: "chrono-match-table-wrap" }).createEl("table", { cls: "chrono-match-table" });
	const head = table.createEl("thead").createEl("tr");
	for (const h of headers) head.createEl("th", { text: h });
	head.createEl("th", { cls: "chrono-match-col-games", text: "Games" });
	for (const h of ["Record", "Win rate"]) head.createEl("th", { text: h });
	const body = table.createEl("tbody");
	for (const row of rows) {
		const tr = body.createEl("tr");
		if (!row.record.games) tr.addClass("is-empty");
		else if (row.record.games < SMALL_SAMPLE) tr.addClass("is-small");
		row.label(tr.createEl("td"));
		tr.createEl("td", { cls: ["chrono-match-num", "chrono-match-col-games"], text: String(row.record.games) });
		tr.createEl("td", { cls: "chrono-match-num", text: row.record.games ? formatRecord(row.record) : "–" });
		renderRateBar(tr.createEl("td"), row.record);
		if (row.onClick && row.record.games) {
			const onClick = row.onClick;
			tr.addClass("chrono-tracker-filter-row");
			tr.setAttr("title", "Show only these games");
			tr.addEventListener("click", onClick);
		}
	}
	return table;
}

/** Record against each of the six syndicates (every game where the opponent played it): all six, always in the same order. */
export function syndicateRows(matches: Match[]): Array<{ s: Syndicate; record: MatchRecord }> {
	return SYNDICATES.map((s) => ({ s, record: tally(matches.filter((m) => m.opponent.includes(s))) }));
}

const CHART_W = 600;
const CHART_H = 140;
const CHART_PAD = { top: 10, right: 12, bottom: 22, left: 36 };

/**
 * Win rate per week as a line, with the 50% mark; each week's dot has its
 * record as a tooltip. Nothing when the games span fewer than two weeks.
 */
export function renderWeeklyChart(parent: HTMLElement, matches: Match[]): HTMLElement | null {
	const weeks = weeklyRecords(matches);
	if (weeks.length < 2) return null;
	const el = parent.createDiv({ cls: "chrono-match-chart" });
	el.createDiv({ cls: "chrono-match-hint", text: "Win rate per week" });
	const svg = el.createSvg("svg", { attr: { viewBox: `0 0 ${CHART_W} ${CHART_H}`, role: "img", "aria-label": "Win rate per week" } });
	const w = CHART_W - CHART_PAD.left - CHART_PAD.right;
	const h = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
	const x = (i: number) => CHART_PAD.left + (weeks.length === 1 ? w / 2 : (i / (weeks.length - 1)) * w);
	const y = (rate: number) => CHART_PAD.top + (1 - rate) * h;
	for (const [rate, label] of [
		[1, "100%"],
		[0.5, "50%"],
		[0, "0%"],
	] as const) {
		svg.createSvg("line", { cls: rate === 0.5 ? "chrono-match-chart-mid" : "chrono-match-chart-grid", attr: { x1: CHART_PAD.left, x2: CHART_W - CHART_PAD.right, y1: y(rate), y2: y(rate) } });
		svg.createSvg("text", { cls: "chrono-match-chart-label", attr: { x: CHART_PAD.left - 6, y: y(rate) + 4, "text-anchor": "end" } }).textContent = label;
	}
	const points = weeks.map((wk, i) => `${x(i)},${y(winRate(wk.record) ?? 0)}`).join(" ");
	svg.createSvg("polyline", { cls: "chrono-match-chart-line", attr: { points } });
	weeks.forEach((wk, i) => {
		const rate = winRate(wk.record) ?? 0;
		const dot = svg.createSvg("circle", { cls: ["chrono-match-chart-dot", ...(wk.record.games < SMALL_SAMPLE ? ["is-small"] : [])], attr: { cx: x(i), cy: y(rate), r: 4 } });
		dot.createSvg("title").textContent = `Week of ${wk.week}: ${formatRecord(wk.record)} (${formatRate(rate)}, ${wk.record.games} game${wk.record.games === 1 ? "" : "s"})`;
	});
	for (const i of weeks.length > 2 ? [0, weeks.length - 1] : [0, 1]) {
		svg.createSvg("text", { cls: "chrono-match-chart-label", attr: { x: x(i), y: CHART_H - 6, "text-anchor": i === 0 ? "start" : "end" } }).textContent = weeks[i].week.slice(5);
	}
	return el;
}

/** Headline numbers: win rate, record, games, streak, last 10. */
export function renderKpis(parent: HTMLElement, matches: Match[]): HTMLElement {
	const el = parent.createDiv({ cls: "chrono-match-kpis" });
	const kpi = (label: string, value: string, cls?: string) => {
		const k = el.createDiv({ cls: ["chrono-match-kpi", ...(cls ? [cls] : [])] });
		k.createDiv({ cls: "chrono-match-kpi-value", text: value });
		k.createDiv({ cls: "chrono-match-kpi-label", text: label });
	};
	const all = tally(matches);
	kpi("Win rate", formatRate(winRate(all)), rateClass(winRate(all)));
	kpi("Record", formatRecord(all));
	kpi("Games", String(all.games));
	const streak = currentStreak(matches);
	if (streak) kpi("Streak", `${streak.count}${streak.result}`, streak.result === "W" ? "is-good" : "is-bad");
	const last10 = tally(matches.slice(-10));
	if (all.games > 10) kpi("Last 10", formatRecord(last10), rateClass(winRate(last10)));
	return el;
}

/** One game: result, date, deck (when given), opponent, archetype, patch and note. */
export function renderGameRow(parent: HTMLElement, m: Match, deck?: string): HTMLElement {
	const row = parent.createDiv({ cls: "chrono-match-game" });
	renderResultChip(row, m.result);
	row.createSpan({ cls: "chrono-match-date", text: m.date || "–" });
	if (deck) row.createSpan({ cls: "chrono-match-deck", text: deck });
	row.createSpan({ cls: "chrono-match-vs", text: "vs" });
	renderPairing(row, m.opponent);
	if (m.archetype) row.createSpan({ cls: "chrono-match-tag", text: m.archetype });
	if (m.patch) row.createSpan({ cls: "chrono-match-tag", text: `patch ${m.patch}` });
	if (m.note) row.createSpan({ cls: "chrono-match-note", text: m.note });
	return row;
}

/** The last games as small W / L chips, oldest on the left. */
export function renderFormStrip(parent: HTMLElement, matches: Match[], count: number): HTMLElement {
	const el = parent.createDiv({ cls: "chrono-match-form-strip", attr: { "aria-label": `Last ${Math.min(count, matches.length)} games, oldest first` } });
	for (const m of matches.slice(-count)) {
		const chip = renderResultChip(el, m.result);
		chip.setAttr("title", `${m.date || "No date"}: ${m.result === "W" ? "win" : "loss"} vs ${pairingLabel(m.opponent)}${m.archetype ? ` (${m.archetype})` : ""}`);
	}
	return el;
}
