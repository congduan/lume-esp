import { writeFile } from 'node:fs/promises';
import { bundle } from '../lume/bundle.js';
import { frame } from '../lume/protocol.js';
const [app, dest] = process.argv.slice(2);
if (!app || !dest) throw new Error('usage: prepare.mjs APP FRAME');
const bytes = await bundle(app);
await writeFile(dest, frame(bytes));
console.log(`bundle ${app}: ${bytes.length} bytes; frame ${bytes.length + 12} bytes`);
