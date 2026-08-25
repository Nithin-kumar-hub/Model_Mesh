# ModelMesh — File Ownership

## Track A
`apps/android/app/src/main/kotlin/com/modelmesh/ModelMeshApplication.kt`
`apps/android/app/src/main/kotlin/com/modelmesh/data/local/**`
`apps/android/app/src/main/kotlin/com/modelmesh/data/preprocess/**`
`apps/android/app/src/main/kotlin/com/modelmesh/data/repository/**`
`apps/android/app/src/main/kotlin/com/modelmesh/data/work/**`
`apps/android/app/src/main/kotlin/com/modelmesh/di/**`
`apps/android/app/proguard-rules.pro`
`apps/android/app/src/test/kotlin/**`
`scripts/**`
`README.md`

## Track B
`apps/android/app/src/main/kotlin/com/modelmesh/MainActivity.kt`
`apps/android/app/src/main/kotlin/com/modelmesh/ui/**`
`apps/android/app/src/main/res/**`
`apps/android/app/src/androidTest/kotlin/**`

## Frozen/shared
`apps/api/**` unless explicitly authorized
`apps/android/build.gradle.kts`
`apps/android/settings.gradle.kts`
`apps/android/gradle.properties`
`apps/android/gradle/**`
`apps/android/app/build.gradle.kts`
`apps/android/app/src/main/AndroidManifest.xml`
`apps/android/app/src/main/kotlin/com/modelmesh/util/**`
`apps/android/app/src/main/kotlin/com/modelmesh/data/models/**`
`apps/android/app/src/main/kotlin/com/modelmesh/data/api/**`
`apps/android/app/src/main/kotlin/com/modelmesh/domain/repository/**`
`apps/android/app/src/main/kotlin/com/modelmesh/domain/preprocess/**`
`apps/android/app/src/main/kotlin/com/modelmesh/domain/usecases/**`

Never silently edit a frozen file. Record a contract blocker instead.
