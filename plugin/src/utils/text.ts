/**
 * Text form of a scalar value from untyped JSON/YAML. Objects, arrays and
 * nullish values give "" instead of "[object Object]".
 */
export function asText(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
	return "";
}

/** Like {@link asText}, trimmed, with "" mapped to undefined. */
export function asOptionalText(value: unknown): string | undefined {
	return asText(value).trim() || undefined;
}
