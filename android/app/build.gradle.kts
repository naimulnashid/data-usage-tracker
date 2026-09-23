import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/*
  Release signing, OPTIONAL by design.

  local.properties (never committed) may carry `signing.properties=<path>`,
  naming a properties file that holds storeFile, storePassword, keyAlias and
  keyPassword. storeFile is resolved relative to that file, so the key and its
  properties live together outside the repo.

  Without the line, a release build comes out unsigned: a fresh clone still
  builds, and debug is unaffected. WITH it, a missing file or an unedited
  CHANGE_ME fails the build rather than falling back -- a release signed with
  nothing, or with the debug key, is the silent failure worth refusing.
*/
fun loadProps(f: File) = Properties().apply { f.inputStream().use { load(it) } }

val releaseSigning: Properties? = rootProject.file("local.properties")
    .takeIf { it.exists() }
    ?.let { loadProps(it).getProperty("signing.properties") }
    ?.let { path ->
        val f = file(path)
        if (!f.exists()) {
            throw GradleException("signing.properties names $f, which does not exist. Is the drive holding the key mounted?")
        }
        loadProps(f).also { p ->
            for (k in listOf("storeFile", "storePassword", "keyAlias", "keyPassword")) {
                val v = p.getProperty(k)
                if (v.isNullOrBlank() || v == "CHANGE_ME") {
                    throw GradleException("$k is not set in $f")
                }
            }
            p.setProperty("storeFile", f.parentFile.resolve(p.getProperty("storeFile")).path)
        }
    }

android {
    namespace = "com.naimul.datausage"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.naimul.datausage"
        // API 26, lowered from 29 for a phone stuck on Android 8.1 (API 27),
        // the last update its maker shipped.
        //
        // 29 was the floor because only from 29 does a null subscriber id mean
        // "every SIM". Below it, null matches NO mobile traffic at all, silently
        // -- so UsageReader asks for each SIM's id instead, which needs
        // READ_PHONE_STATE (declared with maxSdkVersion 28, so newer phones
        // never see the prompt). Two calls newer than 26 are gated as well:
        // Bucket.getMetered (28) and AppOpsManager.unsafeCheckOpNoThrow (29).
        //
        // 26 rather than lower because that is where the adaptive launcher
        // icon and java.time (Uploader.parseIso) begin. Going below it needs a
        // legacy icon and a hand-rolled ISO parser, nothing more; lint's NewApi
        // check will name anything else.
        minSdk = 26
        targetSdk = 36
        versionCode = 4
        versionName = "1.3"
    }

    // BuildConfig is off by default from AGP 8; Uploader reports the app
    // version to the server so a stale build on the phone is visible in the
    // dashboard's sync log rather than being guessed at.
    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        releaseSigning?.let { p ->
            create("release") {
                storeFile = file(p.getProperty("storeFile"))
                storePassword = p.getProperty("storePassword")
                keyAlias = p.getProperty("keyAlias")
                keyPassword = p.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // The published APK is a release build under a key kept off C:.
            // Debug builds use ~/.android/debug.keystore, which is on C: and
            // dies with a Windows reset -- after which no build could update a
            // phone that has the debug-signed app installed.
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

/*
  NO DEPENDENCIES. Deliberately.

  The obvious choice for the periodic upload is WorkManager, and it would be
  fine -- but it drags in Room, SQLite, lifecycle and concurrent-futures, and
  this project's whole premise is that it must still build after a Windows
  reset, possibly years from now, from whatever is on disk. The framework's
  JobScheduler does periodic work with a network constraint and survives
  reboots, which is the entire requirement, and it costs nothing to resolve.

  Same reasoning that put node:sqlite in the dashboard instead of
  better-sqlite3.
*/
dependencies { }
