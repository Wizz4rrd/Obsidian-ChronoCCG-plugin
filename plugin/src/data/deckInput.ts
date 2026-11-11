export function unwrapDeckCode(input: string): string {
	let out = (input ?? "").trim();
	if (!out) return out;

	const first = out[0];
	const last = out[out.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === "`" && last === "`")) {
		out = out.slice(1, -1).trim();
	}
	return out;
}

export function looksLikeDeckCode(value: string): boolean {
	const normalized = unwrapDeckCode(value);
	return /^[A-Z2-7=]+$/i.test(normalized) && normalized.length >= 8;
}

/** Line range of the ```chrono-deck block containing `line` (fence lines inclusive). */
export function findDeckBlockAt(lines: string[], line: number): { start: number; end: number } | null {
	let start = -1;
	for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
		const t = lines[i].trim();
		if (/^(`{3,}|~{3,})\s*chrono-deck\b/.test(t)) {
			start = i;
			break;
		}
		if (i !== line && /^(`{3,}|~{3,})\s*$/.test(t)) return null;
	}
	if (start < 0) return null;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^(`{3,}|~{3,})\s*$/.test(lines[i].trim())) return i >= line ? { start, end: i } : null;
	}
	return null;
}
