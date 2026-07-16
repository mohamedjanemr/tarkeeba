import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFileBasedMemories } from '../memory-data-handlers';

describe('loadFileBasedMemories', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('can load the complete legacy history for the unified memory browser', () => {
    const specsDir = mkdtempSync(path.join(tmpdir(), 'memory-specs-'));
    tempDirs.push(specsDir);

    for (let specNumber = 1; specNumber <= 12; specNumber += 1) {
      const sessionDir = path.join(
        specsDir,
        `${String(specNumber).padStart(3, '0')}-spec`,
        'memory',
        'session_insights'
      );
      mkdirSync(sessionDir, { recursive: true });

      for (let sessionNumber = 1; sessionNumber <= 4; sessionNumber += 1) {
        writeFileSync(
          path.join(sessionDir, `session_${String(sessionNumber).padStart(3, '0')}.json`),
          JSON.stringify({
            session_number: sessionNumber,
            timestamp: `2026-07-${String(specNumber).padStart(2, '0')}T00:00:00Z`,
            discoveries: {},
          })
        );
      }
    }

    expect(loadFileBasedMemories(specsDir, 100)).toHaveLength(30);
    expect(loadFileBasedMemories(specsDir, 100, {
      maxSpecs: Number.POSITIVE_INFINITY,
      maxSessionsPerSpec: Number.POSITIVE_INFINITY,
    })).toHaveLength(48);
  });
});
