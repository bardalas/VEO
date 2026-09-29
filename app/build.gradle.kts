plugins { id("com.android.application") }

// Release signing comes from CI secrets (see .github/workflows/build-apk.yml).
// Never commit the keystore — installs can only be updated by APKs signed with the same key.
val signingKeystore: String? = System.getenv("SIGNING_KEYSTORE_PATH")

android {
    namespace = "com.veo.player"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.veo.player"
        minSdk = 24
        targetSdk = 36
        versionCode = 4543
        versionName = "0.45.43"
        // Problem reports are filed as issues in the app's own repository (MainActivity.reportIssue). The key
        // that allows it is CI's secret VEO_ISSUES_TOKEN - a token that can only open issues there - put
        // into the build, never into the source. A build without it offers GitHub's own issue page instead.
        buildConfigField("String", "ISSUES_TOKEN", "\"${System.getenv("VEO_ISSUES_TOKEN").orEmpty()}\"")
    }
    buildFeatures { buildConfig = true }
    signingConfigs {
        create("release") {
            if (signingKeystore != null) {
                storeFile = file(signingKeystore)
                storeType = "pkcs12"
                storePassword = System.getenv("SIGNING_STORE_PASSWORD")
                keyAlias = System.getenv("SIGNING_KEY_ALIAS")
                keyPassword = System.getenv("SIGNING_STORE_PASSWORD")
            }
        }
    }
    // Phones and Android TV boxes are ARM; x86 is only needed for emulators.
    // Compressing native libs cuts the APK download size roughly in half.
    packaging {
        jniLibs { useLegacyPackaging = true }
    }
    // Release lint ("lintVital") adds ~30s per CI build; run lint locally when needed.
    lint {
        checkReleaseBuilds = false
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (signingKeystore != null) signingConfig = signingConfigs.getByName("release")
        }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.8.0")
    // serves the app's own page over https, so it is a page with an address and not a bare file
    implementation("androidx.webkit:webkit:1.14.0")
    val jlibtorrentVersion = "2.0.12.9"
    implementation("com.frostwire:jlibtorrent:$jlibtorrentVersion")
    implementation("com.frostwire:jlibtorrent-android-arm64:$jlibtorrentVersion")
    implementation("com.frostwire:jlibtorrent-android-arm:$jlibtorrentVersion")
    // Emulators on a PC are x86_64, where the ARM natives cannot load and torrents would be the one
    // thing that could not be tested. Debug builds carry them; the release stays lean for real TVs.
    debugImplementation("com.frostwire:jlibtorrent-android-x86_64:$jlibtorrentVersion")
    // 32-bit x86 emulator images (e.g. the Android Studio "Television" AVD) need this one instead.
    debugImplementation("com.frostwire:jlibtorrent-android-x86:$jlibtorrentVersion")
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.11.1")
    implementation("androidx.media3:media3-exoplayer-dash:1.11.1")
    implementation("androidx.media3:media3-ui:1.11.1")
}
