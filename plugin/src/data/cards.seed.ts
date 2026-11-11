import { CardDatabase } from "./types";

/**
 * Tiny offline seed so the plugin works out of the box before any sync.
 * Replace via Settings → Refresh card database.
 */
export const SEED_DATABASE: CardDatabase = {
	version: "0.0.0-seed",
	source: "bundled",
	cards: [
		{
			id: 1,
			name: "Sample Lifeblood Diver",
			syndicates: ["Lifeblood"],
			type: "Unit",
			cost: 2,
			attack: 2,
			health: 2,
			rarity: "Common",
			keywords: [],
			text: "Placeholder card. Run 'ChronoCCG: Refresh card database' to load real data.",
		},
	],
};
