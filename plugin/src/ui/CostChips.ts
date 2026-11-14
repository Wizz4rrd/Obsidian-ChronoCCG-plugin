import { COST_FILTER_MAX } from "../data/CardRepository";

/** Cost filter chips "0" … "7+": click one or more; none selected shows every cost. */
export interface CostChips {
	/** Show `selected` again after it was changed elsewhere (e.g. "Clear filters"). */
	sync(): void;
}

export function renderCostChips(parent: HTMLElement, selected: Set<number>, onChange: () => void): CostChips {
	const row = parent.createDiv({ cls: "chrono-filter-chips chrono-cost-chips" });
	const buttons: HTMLElement[] = [];
	const sync = () => buttons.forEach((b, cost) => b.toggleClass("is-active", selected.has(cost)));
	for (let cost = 0; cost <= COST_FILTER_MAX; cost++) {
		const b = row.createEl("button", {
			cls: "chrono-filter-chip chrono-cost-chip",
			text: cost === COST_FILTER_MAX ? `${cost}+` : String(cost),
			attr: { "aria-label": cost === COST_FILTER_MAX ? `Cost ${cost} or more` : `Cost ${cost}` },
		});
		b.addEventListener("click", () => {
			if (selected.has(cost)) selected.delete(cost);
			else selected.add(cost);
			sync();
			onChange();
		});
		buttons.push(b);
	}
	sync();
	return { sync };
}
