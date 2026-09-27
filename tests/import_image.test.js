const assert = require('assert');

// Test Spectrum palette definition
const SPECTRUM_PALETTE = [
    ['#000000', '#0000d7', '#d70000', '#d700d7', '#00d700', '#00d7d7', '#d7d700', '#d7d7d7'],
    ['#000000', '#0000ff', '#ff0000', '#ff00ff', '#00ff00', '#00ff7f', '#ffff00', '#ffffff']
];

function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
}

// Emulate convertImageToZXCanvas logic
function convertImageToZXCanvas(srcCanvas) {
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    const raw     = srcCanvas.getContext('2d').getImageData(0, 0, w, h).data;
    const pixels  = new Uint8Array(w * h);
    const blocksX = Math.floor(w / 8);
    const blocksY = Math.floor(h / 8);
    const attrs   = new Uint8Array(blocksX * blocksY);

    const pal = SPECTRUM_PALETTE.map(set => set.map(hex => {
        const c = hexToRgb(hex);
        return [c.r, c.g, c.b];
    }));

    const bR = new Uint8Array(64);
    const bG = new Uint8Array(64);
    const bB = new Uint8Array(64);

    for (let by = 0; by < blocksY; by++) {
        for (let bx = 0; bx < blocksX; bx++) {
            for (let py = 0; py < 8; py++) {
                for (let px = 0; px < 8; px++) {
                    const x = bx * 8 + px;
                    const y = by * 8 + py;
                    const i = (y * w + x) * 4;
                    const j = py * 8 + px;
                    bR[j] = raw[i]; bG[j] = raw[i+1]; bB[j] = raw[i+2];
                }
            }

            let bestErr = Infinity;
            let bestBright = 0, bestPaper = 0, bestInk = 7;

            for (let bright = 0; bright < 2; bright++) {
                const p = pal[bright];
                for (let pi = 0; pi < 8; pi++) {
                    const pr = p[pi][0], pg = p[pi][1], pb = p[pi][2];
                    for (let ii = 0; ii < 8; ii++) {
                        const ir = p[ii][0], ig = p[ii][1], ib = p[ii][2];
                        let err = 0;
                        for (let j = 0; j < 64; j++) {
                            const r = bR[j], g = bG[j], b = bB[j];
                            const dI = (r-ir)*(r-ir) + (g-ig)*(g-ig) + (b-ib)*(b-ib);
                            const dP = (r-pr)*(r-pr) + (g-pg)*(g-pg) + (b-pb)*(b-pb);
                            err += dI < dP ? dI : dP;
                            if (err >= bestErr) break;
                        }
                        if (err < bestErr) {
                            bestErr = err;
                            bestBright = bright;
                            bestPaper  = pi;
                            bestInk    = ii;
                        }
                    }
                }
            }

            attrs[by * blocksX + bx] = (bestBright << 6) | (bestPaper << 3) | bestInk;

            for (let py = 0; py < 8; py++) {
                for (let px = 0; px < 8; px++) {
                    const j = py * 8 + px;
                    const r = bR[j], g = bG[j], b = bB[j];
                    const dI = (r-pal[bestBright][bestInk][0])**2 + (g-pal[bestBright][bestInk][1])**2 + (b-pal[bestBright][bestInk][2])**2;
                    const dP = (r-pal[bestBright][bestPaper][0])**2 + (g-pal[bestBright][bestPaper][1])**2 + (b-pal[bestBright][bestPaper][2])**2;
                    pixels[(by * 8 + py) * w + (bx * 8 + px)] = dI <= dP ? 1 : 0;
                }
            }
        }
    }

    return { pixels, attributes: attrs };
}

function testDimensionCalculation() {
    console.log('Testing dimension calculation...');
    const computeDims = (rawW, rawH) => ({
        w: Math.max(8, (rawW % 8 === 0 ? rawW : Math.round(rawW / 8) * 8)),
        h: Math.max(8, (rawH % 8 === 0 ? rawH : Math.round(rawH / 8) * 8))
    });

    assert.deepStrictEqual(computeDims(256, 48), { w: 256, h: 48 });
    assert.deepStrictEqual(computeDims(256, 192), { w: 256, h: 192 });
    assert.deepStrictEqual(computeDims(16, 16), { w: 16, h: 16 });
    assert.deepStrictEqual(computeDims(255, 47), { w: 256, h: 48 });
    assert.deepStrictEqual(computeDims(4, 4), { w: 8, h: 8 });
    console.log('PASSED: Dimension calculation.');
}

function testConversion256x48() {
    console.log('Testing 256x48 conversion...');
    const w = 256, h = 48;
    const data = new Uint8ClampedArray(w * h * 4);
    // Fill top half white, bottom half black
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const val = y < 24 ? 255 : 0;
            data[idx] = val;
            data[idx + 1] = val;
            data[idx + 2] = val;
            data[idx + 3] = 255;
        }
    }

    const mockCanvas = {
        width: w,
        height: h,
        getContext: () => ({
            getImageData: () => ({ data })
        })
    };

    const res = convertImageToZXCanvas(mockCanvas);
    assert.strictEqual(res.pixels.length, 256 * 48);
    assert.strictEqual(res.attributes.length, 32 * 6);
    console.log('PASSED: 256x48 conversion.');
}

testDimensionCalculation();
testConversion256x48();
console.log('All image import tests passed successfully.');
