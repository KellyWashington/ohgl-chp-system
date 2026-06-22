#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--check', 'src/main.js'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
