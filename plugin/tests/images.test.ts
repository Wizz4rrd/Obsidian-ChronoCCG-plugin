import { test } from "node:test";
import assert from "node:assert/strict";
import { fitWidth, pngSize } from "../src/utils/imageSize";

/** PNG signature followed by an IHDR chunk header. */
function pngHeader(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(33);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes;
}

test("reads the size of a PNG from its header", () => {
	assert.deepEqual(pngSize(pngHeader(1640, 2296)), { width: 1640, height: 2296 });
	const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8X0000000000000000");
	assert.equal(pngSize(webp), null);
	assert.equal(pngSize(pngHeader(1640, 2296).subarray(0, 20)), null);
});

test("shrinks to the cache width without upscaling", () => {
	assert.deepEqual(fitWidth(1640, 2296, 400), { width: 400, height: 560 });
	assert.deepEqual(fitWidth(300, 420, 400), { width: 300, height: 420 });
});
