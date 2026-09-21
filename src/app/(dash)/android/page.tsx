import { redirect } from 'next/navigation';
import { getAndroidDevices } from '@/lib/android-queries';
import { AndroidEmpty } from '@/components/AndroidEmpty';

export const dynamic = 'force-dynamic';

/**
 * `/android` names a platform, not a device, and there can be more than one
 * phone. So it holds no content of its own: it forwards to whichever device has
 * moved the most data, which is the one someone typing `/android` almost
 * certainly meant.
 *
 * Kept as a real route rather than deleted, because it is the obvious thing to
 * type and the obvious thing for an old bookmark to point at.
 */
export default function AndroidIndex() {
  const devices = getAndroidDevices();
  if (devices.length === 0) return <AndroidEmpty />;
  redirect(`/android/${devices[0]!.slug}`);
}
