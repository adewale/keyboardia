/**
 * Test script for OG image generation
 * Run with: npx tsx scripts/test-og-image.ts
 */

import { generateOGImage } from '../src/worker/og-image';
import * as fs from 'fs';

async function test() {
  console.log('Testing OG image generation...\n');

  try {
    const response = await generateOGImage({
      sessionName: "Test Session",
      tracks: [
        { steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false] },
        { steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false] },
        { steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false] }
      ],
      tempo: 120,
      trackCount: 3
    });

    console.log('Response status:', response.status);
    console.log('Content-Type:', response.headers.get('content-type'));

    const buffer = await response.arrayBuffer();
    console.log('Size:', buffer.byteLength, 'bytes');

    // Check PNG signature
    const view = new Uint8Array(buffer);
    const isPng = view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47;
    console.log('Valid PNG signature:', isPng);

    if (isPng) {
      // Write to file for inspection
      const outputPath = '/tmp/og-generated.png';
      fs.writeFileSync(outputPath, Buffer.from(buffer));
      console.log('\nWrote to', outputPath);
      console.log('Open with: open', outputPath);
    }

    console.log('\n✅ OG image generation successful!');
  } catch (error) {
    console.error('\n❌ OG image generation failed:', error);
    process.exit(1);
  }
}

test();
