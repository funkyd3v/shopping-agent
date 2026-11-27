import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CassetteStore } from './cassette.store';

describe('CassetteStore', () => {
  const originalMode = process.env.LLM_MODE;
  const originalDir = process.env.CASSETTE_DIR;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shopping-cassettes-'));
    process.env.CASSETTE_DIR = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalMode === undefined) delete process.env.LLM_MODE;
    else process.env.LLM_MODE = originalMode;
    if (originalDir === undefined) delete process.env.CASSETTE_DIR;
    else process.env.CASSETTE_DIR = originalDir;
  });

  it('keys on role and tool schema as well as provider/model/messages', () => {
    process.env.LLM_MODE = 'replay';
    const store = new CassetteStore();
    const messages = [{ role: 'user', content: 'hello' }];
    const roleKey = store.key('groq', 'model', 'router', messages);
    expect(store.key('groq', 'model', 'agent', messages)).not.toBe(roleKey);
    expect(store.key('groq', 'model', 'router', messages, [{ name: 'a' }])).not.toBe(roleKey);
  });

  it('records in record mode without serving stale fixtures', () => {
    process.env.LLM_MODE = 'record';
    const recorder = new CassetteStore();
    const key = recorder.key('groq', 'model', 'router', [{ role: 'user', content: 'hi' }]);
    recorder.save(key, 'fresh answer');

    // Record mode writes but must never replay the fixture it just wrote.
    expect(recorder.load(key)).toBeNull();

    process.env.LLM_MODE = 'replay';
    expect(new CassetteStore().load(key)).toBe('fresh answer');
  });
});
