import { Shell } from '@/components/Shell';
import { getProfiles, databaseExists, windowsDevice } from '@/lib/queries';
import { getAndroidDevices } from '@/lib/android-queries';

// The shell queries the database for the network list, so it must not be
// cached alongside a stale set of profiles.
export const dynamic = 'force-dynamic';

/**
 * Everything behind the password gate renders inside the shell.
 *
 * This stays a server component purely to read the profile list; the chrome
 * itself is `Shell`, which needs the pathname to pick the device accent.
 */
export default function DashLayout({ children }: { children: React.ReactNode }) {
  // Read here rather than per page: the scope bar lives in the shell, and the
  // option list is identical everywhere.
  const profiles = databaseExists() ? getProfiles() : [];
  // The sidebar lists whatever phones have actually reported, so adding a
  // second one needs no code change at all.
  const phones = getAndroidDevices().map((d) => ({ slug: d.slug, label: d.label }));

  return (
    <Shell profiles={profiles} phones={phones} laptop={windowsDevice()}>
      {children}
    </Shell>
  );
}
