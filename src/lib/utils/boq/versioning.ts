/**
 * BOQ Version Management Utilities
 * Helper functions for BOQ version generation and management
 */


/**
 * Generate BOQ version number
 */
export function generateBOQVersion(existingVersions: string[]): string {
  // Extract version numbers and find the next one
  const versionNumbers = existingVersions
    .map(v => {
      const match = v.match(/v?(\d+)\.(\d+)/);
      if (match) {
        return { major: parseInt(match[1]!, 10), minor: parseInt(match[2]!, 10) };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a!.major !== b!.major) return b!.major - a!.major;
      return b!.minor - a!.minor;
    });

  if (versionNumbers.length === 0) {
    return 'v1.0';
  }

  const latest = versionNumbers[0]!;
  return `v${latest.major}.${latest.minor + 1}`;
}