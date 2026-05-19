'use strict';

const fs = require('fs').promises;
const path = require('path');

function getAllowedRoot() {
  return process.env.AGENT_FS_ROOT || process.env.AGENT_SHELL_CWD || process.cwd();
}

function normalizePath(input) {
  if (!input || typeof input !== 'string') return null;
  const allowedRoot = path.resolve(getAllowedRoot());
  const target = path.resolve(allowedRoot, input);
  if (!target.startsWith(allowedRoot)) return null;
  return target;
}

async function readFile(filePath) {
  const p = normalizePath(filePath);
  if (!p) return { ok: false, error: 'Invalid or disallowed path.' };
  try {
    const content = await fs.readFile(p, 'utf-8');
    return { ok: true, content, path: p };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function writeFile(filePath, content) {
  const p = normalizePath(filePath);
  if (!p) return { ok: false, error: 'Invalid or disallowed path.' };
  try {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf-8');
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function listDir(dirPath) {
  const p = normalizePath(dirPath || '.');
  if (!p) return { ok: false, error: 'Invalid or disallowed path.' };
  try {
    const entries = await fs.readdir(p, { withFileTypes: true });
    return {
      ok: true,
      path: p,
      entries: entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
      })),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { readFile, writeFile, listDir, getAllowedRoot };
