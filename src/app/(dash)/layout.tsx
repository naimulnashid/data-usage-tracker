import { Shell } from '@/components/Shell';
import { windowsDevice } from '@/lib/queries';
import { getAndroidDevices } from '@/lib/android-queries';

// The shell queries the database for the phone list, so it must not be
// cached alongside a stale one.
export const dynamic = 'force-dynamic';

/**
 * Everything behind the password gate renders inside the shell.
 *
 * This stays a server component purely to read the phone list; the chrome
 * itself is `Shell`, which needs the pathname to pick the device accent.
 */
export default function DashLayout({ children }: { children: React.ReactNode }) {
  // The sidebar lists whatever phones have actually reported, so adding a
  // second one needs no code change at all.
  const phones = getAndroidDevices().map((d) => ({ slug: d.slug, label: d.label }));

  return (
    <Shell phones={phones} laptop={windowsDevice()}>
      {children}
    </Shell>
  );
}
