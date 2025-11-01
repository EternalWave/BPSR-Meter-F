import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import pngToIco from 'png-to-ico';
import Jimp from 'jimp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
 const root = path.resolve(__dirname, '..');
 const icoPath = path.join(root, 'icon.ico');
 // Accept common names
 const candidates = [
 path.join(root, 'icon.png'),
 path.join(root, 'icon.jpg'),
 path.join(root, 'icon.jpeg'),
 ];
 const srcPath = candidates.find((p) => fs.existsSync(p));
 if (!srcPath) {
 console.error('No icon image found. Place icon.png (preferred) or icon.jpg at the project root.');
 process.exit(1);
 }
 // Always re-encode to a clean PNG to avoid invalid files mislabeled as PNG
 const tmpPng = path.join(root, 'icon.reencoded.png');
 try {
 const img = await Jimp.read(srcPath);
 // ensure square and reasonable size
 const size = Math.max(img.bitmap.width, img.bitmap.height);
 img.contain(size, size, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);
 await img.writeAsync(tmpPng);
 const buf = await pngToIco(tmpPng);
 fs.writeFileSync(icoPath, buf);
 fs.unlinkSync(tmpPng);
 console.log(`Generated icon.ico from ${path.basename(srcPath)}`);
 } catch (e) {
 console.error('Failed to generate .ico:', e);
 try { if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng); } catch {}
 process.exit(1);
 }
}

main();
