/**
 * Remove 'v' prefix from version string if present
 */
export function removeVPrefix(version: string): string {
  if (version.startsWith('v')) {
    return version.substring(1)
  }
  return version
}
