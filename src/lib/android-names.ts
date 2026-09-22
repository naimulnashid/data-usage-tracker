/**
 * Which package names a uid that several packages share.
 *
 * Android names a shared uid after the package that declares
 * `android:sharedUserLabel` -- that is what its own Data usage screen shows.
 * The phone does not report that attribute, so without help the name falls
 * back to the first package by name, preferring a user app to a system one.
 * That is right for most shared uids (`android` for the system uid) and was
 * wrong for Google's: where Google Backup Transport shares it,
 * `com.google.android.backuptransport` sorts before `com.google.android.gms`,
 * and a uid carrying Play services' traffic was listed as "Google Backup
 * Transport".
 *
 * So this lists the packages that name their shared uid, standing in for the
 * attribute. It holds packages, not names: the label still comes from the
 * phone. Add one only where the fallback picks a name that misleads.
 *
 * Kept apart from `android-queries.ts`, which is server-only, so the self-test
 * can check the rule.
 */
export const NAMES_SHARED_UID: ReadonlySet<string> = new Set([
  'com.google.android.gms',
]);

export interface UidPackage {
  package: string;
  isSystem: boolean;
}

/**
 * Orders a uid's packages so that the first one names it: a listed package,
 * then user apps before system ones, then by package name.
 */
export function byNamingOrder(a: UidPackage, b: UidPackage): number {
  const listed = Number(NAMES_SHARED_UID.has(b.package)) - Number(NAMES_SHARED_UID.has(a.package));
  if (listed !== 0) return listed;
  if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1;
  return a.package < b.package ? -1 : a.package > b.package ? 1 : 0;
}
