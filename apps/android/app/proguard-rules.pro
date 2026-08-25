# ModelMesh — R8 / ProGuard rules for the release build.
#
# Only what reflection or code generation actually needs. Anything broader would
# defeat the point of shrinking a phone app.

# ── kotlinx.serialization ────────────────────────────────────────────────────
# The generated serializers are looked up reflectively from the companion.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keep,includedescriptorclasses class com.modelmesh.**$$serializer { *; }
-keepclassmembers class com.modelmesh.** {
    *** Companion;
}
-keepclasseswithmembers class com.modelmesh.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# ── socket.io-client ─────────────────────────────────────────────────────────
# Event dispatch is by string name, and the JSON payloads are org.json.
-keep class io.socket.** { *; }
-keep class io.socket.client.** { *; }
-dontwarn io.socket.**

# ── Retrofit + OkHttp ────────────────────────────────────────────────────────
# Retrofit builds the API from annotations on the interface at runtime.
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class retrofit2.** { *; }
-keep interface retrofit2.** { *; }
-keep,allowobfuscation interface com.modelmesh.data.api.ModelMeshApi
-keepattributes Signature, Exceptions, RuntimeVisibleAnnotations, AnnotationDefault

# ── Room ─────────────────────────────────────────────────────────────────────
-keep class * extends androidx.room.RoomDatabase
-dontwarn androidx.room.**

# ── ML Kit / Play services ───────────────────────────────────────────────────
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.mlkit.**

# ── Hilt / Dagger ────────────────────────────────────────────────────────────
-keep class dagger.hilt.** { *; }
-keep @dagger.hilt.InstallIn class * { *; }
-keep @dagger.hilt.android.HiltAndroidApp class * { *; }

# ── Enums ────────────────────────────────────────────────────────────────────
# Every wire enum is mapped through valueOf/values by name.
-keepclassmembers enum com.modelmesh.** {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ── Coroutines ───────────────────────────────────────────────────────────────
-dontwarn kotlinx.coroutines.**
