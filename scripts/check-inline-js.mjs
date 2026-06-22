#!/usr/bin/env node
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const html = readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const tmp = join(process.cwd(), '.inline-js-check.tmp.cjs');
writeFileSync(tmp, scripts);
const result = spawnSync(process.execPath, ['--check', tmp], { stdio: 'inherit' });
unlinkSync(tmp);
process.exit(result.status ?? 1);
