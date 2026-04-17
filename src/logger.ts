import { createHash } from 'crypto';

export function computeRepoKey(harnessDir: string): string {
  return createHash('sha1').update(harnessDir).digest('hex').slice(0, 12);
}
