export interface Size {
	width: number;
	height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from a PNG header, or null when `bytes` isn't a PNG. */
export function pngSize(bytes: Uint8Array): Size | null {
	if (bytes.length < 24 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
	// IHDR is always the first chunk: length (4 bytes) and "IHDR" (4 bytes), then width and height.
	if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	return width && height ? { width, height } : null;
}

/** Size that fits in `maxWidth` with the same aspect ratio. Never upscales. */
export function fitWidth(width: number, height: number, maxWidth: number): Size {
	const scale = Math.min(1, maxWidth / width);
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
