// Usage: node scripts/import-monsters.cjs <source_json_path>
// Reads the given file, extracts the top-level monsters object even if the file
// is not a valid full JSON (e.g., starts with `monsters": { ... }`), and
// writes it into translations/en.json under the `monsters` key without altering other fields.

const fs = require('fs');
const path = require('path');

function tryParse(jsonStr) {
 try { return JSON.parse(jsonStr); } catch { return null; }
}

function extractMonsters(raw) {
 const trimmed = raw.trim();
 // Try direct JSON first
 const direct = tryParse(trimmed);
 if (direct && direct.monsters && typeof direct.monsters === 'object') {
 return direct.monsters;
 }

 // Locate monsters key
 const keyIdx = (() => {
 const a = trimmed.indexOf('"monsters"');
 if (a !== -1) return a;
 const b = trimmed.indexOf('monsters"');
 if (b !== -1) return b;
 const c = trimmed.indexOf('monsters');
 return c;
 })();
 if (keyIdx === -1) throw new Error('Could not find monsters key in source');
 const colonIdx = trimmed.indexOf(':', keyIdx);
 if (colonIdx === -1) throw new Error('Could not find colon after monsters key');
 const firstBrace = trimmed.indexOf('{', colonIdx);
 if (firstBrace === -1) throw new Error('Could not find opening { for monsters object');

 // First attempt: balanced scan
 let i = firstBrace;
 let depth =0, inStr = false, esc = false;
 for (; i < trimmed.length; i++) {
 const ch = trimmed[i];
 if (inStr) {
 if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
 continue;
 }
 if (ch === '"') { inStr = true; continue; }
 if (ch === '{') depth++;
 else if (ch === '}') { depth--; if (depth ===0) { i++; break; } }
 }
 if (depth ===0) {
 const objJson = trimmed.slice(firstBrace, i);
 const parsed = tryParse(objJson);
 if (!parsed) throw new Error('Failed to parse extracted monsters object');
 return parsed;
 }

 // Fallback: take from firstBrace to EOF, trim trailing comma, append '}'
 let body = trimmed.slice(firstBrace).trim();
 // Remove any trailing commas/newlines/spaces at the end
 body = body.replace(/[,\s]*$/, '');
 // Ensure it starts with '{'
 if (!body.startsWith('{')) body = '{' + body;
 // Append one closing brace
 let attempt = body + '}';
 let parsed = tryParse(attempt);
 if (!parsed) {
 // Try removing a trailing comma before the final }
 attempt = attempt.replace(/,\s*}/g, '}');
 parsed = tryParse(attempt);
 }
 if (!parsed) throw new Error('Failed to coerce monsters object to valid JSON');
 return parsed;
}

function main() {
 const srcPath = process.argv[2];
 if (!srcPath) {
 console.error('Source path required. Example: node scripts/import-monsters.cjs "D:/Downloads/translated_monsters_clean.json"');
 process.exit(1);
 }
 if (!fs.existsSync(srcPath)) {
 console.error('Source file not found:', srcPath);
 process.exit(1);
 }
 const translationsDir = path.join(__dirname, '..', 'translations');
 const enPath = path.join(translationsDir, 'en.json');
 if (!fs.existsSync(enPath)) {
 console.error('translations/en.json not found at', enPath);
 process.exit(1);
 }
 const srcRaw = fs.readFileSync(srcPath, 'utf-8');
 let monsters;
 try {
 monsters = extractMonsters(srcRaw);
 } catch (e) {
 console.error('Failed to extract monsters:', e.message);
 process.exit(1);
 }
 // Read en.json and merge
 const en = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
 en.monsters = monsters;
 fs.writeFileSync(enPath, JSON.stringify(en, null,4) + '\n');
 console.log('Updated translations/en.json with', Object.keys(en.monsters).length, 'monster entries.');
}

main();
