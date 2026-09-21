plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
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
        versionCode = 3
        versionName = "1.2"
    }

    // BuildConfig is off by default from AGP 8; Uploader reports the app
    // version to the server so a stale build on the phone is visible in the
    // dashboard's sync log rather than being guessed at.
    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
        // Debug is what actually gets installed here: this app is sideloaded
        // onto one phone over adb, never published, so a release signing config
        // would be ceremony with no reader.
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
