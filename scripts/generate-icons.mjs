import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
 const root = path.resolve(__dirname, '..');
 const pngPath = path.join(root, 'icon.png');
 const icoPath = path.join(root, 'icon.ico');
 if (!fs.existsSync(pngPath)) {
 console.error('icon.png not found at project root. Place your new icon as icon.png');
 process.exit(1);
 }
 try {
 const buf = await pngToIco(pngPath);
 fs.writeFileSync(icoPath, buf);
 console.log('Generated icon.ico from icon.png');
 } catch (e) {
 console.error('Failed to generate .ico from .png:', e);
 process.exit(1);
 }
}

main();
