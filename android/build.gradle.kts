// Versions pinned to what is already in the Gradle cache on this machine, so a
// rebuild after a Windows reset does not depend on resolving anything new.
plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.10" apply false
}
