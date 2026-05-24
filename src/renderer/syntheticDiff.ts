import type { FilePair, PRDifferences } from '@shared/types';

const LARGE_LINES = 50_000;

const FAKE_BEFORE_BLOB = 'synthetic-before';
const FAKE_AFTER_BLOB = 'synthetic-after';

/**
 * Build a fake PRDifferences with one ~50k-line file. Used by the debug
 * "Load synthetic 50k diff" button to verify Monaco scroll performance
 * without needing a real PR of that size.
 */
export function syntheticDifferences(): PRDifferences {
  return {
    pullRequestId: '__synthetic__',
    repositoryName: '__synthetic__',
    beforeCommitId: '0000',
    afterCommitId: '1111',
    files: [
      {
        path: 'synthetic-50k.txt',
        afterPath: 'synthetic-50k.txt',
        beforePath: 'synthetic-50k.txt',
        changeType: 'M',
        beforeBlobId: FAKE_BEFORE_BLOB,
        afterBlobId: FAKE_AFTER_BLOB,
      },
    ],
  };
}

export function isSyntheticBlob(blobId: string | undefined): boolean {
  return blobId === FAKE_BEFORE_BLOB || blobId === FAKE_AFTER_BLOB;
}

export function syntheticFilePair(): FilePair {
  const beforeLines: string[] = [];
  const afterLines: string[] = [];
  for (let i = 1; i <= LARGE_LINES; i++) {
    const base = `line ${i}: lorem ipsum dolor sit amet, consectetur adipiscing elit — number ${i}`;
    beforeLines.push(base);
    if (i % 3 === 0) {
      afterLines.push(
        `line ${i}: CHANGED — Aenean commodo ligula eget dolor (variant ${i * 7})`,
      );
    } else if (i % 17 === 0) {
      afterLines.push(base);
      afterLines.push(`line ${i}.1: ADDED line for parity (${i})`);
    } else {
      afterLines.push(base);
    }
  }
  const beforeText = beforeLines.join('\n');
  const afterText = afterLines.join('\n');
  return {
    before: { text: beforeText, binary: false, size: beforeText.length },
    after: { text: afterText, binary: false, size: afterText.length },
  };
}
