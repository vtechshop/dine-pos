const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '../node_modules/react-native-bluetooth-escpos-printer');

// Fix 1: build.gradle — remove conflicting buildscript block, fix deprecated APIs
const buildGradle = path.join(base, 'android/build.gradle');
const fixedBuildGradle = `apply plugin: 'com.android.library'

android {
    compileSdk 34
    namespace "com.tszalai.escposprinter"

    defaultConfig {
        minSdkVersion 24
        targetSdkVersion 34
        versionCode 1
        versionName "1.0"
    }
    lint {
        abortOnError false
    }
    sourceSets {
        main {
            java.srcDirs = ['src/main/java']
        }
    }
}

repositories {
    mavenCentral()
    google()
}

dependencies {
    implementation fileTree(dir: 'libs', include: ['*.jar'])
    compileOnly 'com.facebook.react:react-android:+'
    implementation "com.google.zxing:core:3.5.2"
    implementation 'androidx.core:core:1.12.0'
}
`;

// Fix 2: RNBluetoothEscposPrinterPackage.java — remove JavaScriptModule (removed in RN 0.65+)
const packageJava = path.join(base, 'android/src/main/java/cn/jystudio/bluetooth/RNBluetoothEscposPrinterPackage.java');
const fixedPackageJava = `
package cn.jystudio.bluetooth;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import cn.jystudio.bluetooth.escpos.RNBluetoothEscposPrinterModule;
import cn.jystudio.bluetooth.tsc.RNBluetoothTscPrinterModule;
import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

public class RNBluetoothEscposPrinterPackage implements ReactPackage {
    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
        BluetoothService service = new BluetoothService(reactContext);
        return Arrays.<NativeModule>asList(new RNBluetoothManagerModule(reactContext, service),
                new RNBluetoothEscposPrinterModule(reactContext, service),
                new RNBluetoothTscPrinterModule(reactContext, service));
    }

    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}
`;

if (fs.existsSync(buildGradle)) {
    fs.writeFileSync(buildGradle, fixedBuildGradle);
    console.log('✔ Patched build.gradle');
}

if (fs.existsSync(packageJava)) {
    fs.writeFileSync(packageJava, fixedPackageJava);
    console.log('✔ Patched RNBluetoothEscposPrinterPackage.java');
}
