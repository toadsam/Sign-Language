#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

const KEY_CANDIDATES = new Set([
  'name',
  'lemma',
  'word',
  'token',
  'morpheme',
  'morphemes',
  'morph',
  'gloss',
  'label',
  'surface',
  'text',
  'form',
]);

const TOKEN_SPLIT_RE = /[,\s/|;+]+/;
const TOKEN_CLEAN_RE = /[^0-9A-Za-z\u3131-\u318E\uAC00-\uD7A3_-]/g;

function parseArgs(argv) {
  const args = {
    dataRoots: [],
    topK: 300,
    output: 'src/main/resources/sign_dictionary.json',
    minLen: 1,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--data-root') args.dataRoots.push(argv[++i]);
    else if (arg === '--top-k') args.topK = Number(argv[++i]);
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--min-len') args.minLen = Number(argv[++i]);
  }

  if (args.dataRoots.length === 0) {
    throw new Error('Missing required argument: --data-root');
  }
  return args;
}

function normalizeKey(key) {
  return String(key).trim().toLowerCase().replace(/[-_]/g, '');
}

function cleanToken(token) {
  return String(token).trim().replace(TOKEN_CLEAN_RE, '');
}

function extractTokensFromValue(value, minLen) {
  const tokens = [];

  if (typeof value === 'string') {
    for (const piece of value.split(TOKEN_SPLIT_RE)) {
      const token = cleanToken(piece);
      if (token.length >= minLen) tokens.push(token);
    }
    return tokens;
  }

  if (Array.isArray(value)) {
    for (const item of value) tokens.push(...extractTokensFromValue(item, minLen));
    return tokens;
  }

  if (value && typeof value === 'object' && typeof value.name === 'string') {
    const token = cleanToken(value.name);
    if (token.length >= minLen) tokens.push(token);
  }

  return tokens;
}

function extractTokens(node, minLen) {
  const tokens = [];

  if (Array.isArray(node)) {
    for (const item of node) tokens.push(...extractTokens(item, minLen));
    return tokens;
  }

  if (!node || typeof node !== 'object') {
    return tokens;
  }

  for (const [key, value] of Object.entries(node)) {
    const nk = normalizeKey(key);
    if (KEY_CANDIDATES.has(nk)) {
      tokens.push(...extractTokensFromValue(value, minLen));
    } else if (value && typeof value === 'object') {
      tokens.push(...extractTokens(value, minLen));
    }
  }

  return tokens;
}

async function listJsonFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const outputPath = path.resolve(args.output);
  const outputFileName = path.basename(outputPath);

  const roots = args.dataRoots.map((root) => path.resolve(root));
  const jsonFiles = [];
  for (const root of roots) {
    const files = await listJsonFiles(root);
    for (const file of files) {
      if (path.basename(file) !== outputFileName) {
        jsonFiles.push(file);
      }
    }
  }

  if (jsonFiles.length === 0) {
    throw new Error(`No json files found under: ${roots.join(', ')}`);
  }

  const counter = new Map();
  let failedFiles = 0;

  for (const jsonFile of jsonFiles) {
    try {
      const payload = await loadJson(jsonFile);
      const tokens = extractTokens(payload, args.minLen);
      for (const token of tokens) {
        counter.set(token, (counter.get(token) ?? 0) + 1);
      }
    } catch {
      failedFiles += 1;
    }
  }

  const topWords = [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, args.topK)
    .map(([word]) => word);

  const dictionary = topWords.map((word, index) => ({
    id: index + 1,
    word,
    file: `${String(index + 1).padStart(4, '0')}.placeholder`,
  }));

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(dictionary, null, 2)}\n`, 'utf8');

  console.log(`json files scanned: ${jsonFiles.length}`);
  console.log(`failed json files: ${failedFiles}`);
  console.log(`unique words found: ${counter.size}`);
  console.log(`dictionary entries written: ${dictionary.length}`);
  console.log(`output: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
