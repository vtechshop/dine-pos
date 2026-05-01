module.exports = {
  dependencies: {
    // Override autolinking for this package — its build.gradle namespace is
    // 'com.tszalai.escposprinter' but the actual Java class lives in cn.jystudio.bluetooth
    'react-native-bluetooth-escpos-printer': {
      platforms: {
        android: {
          packageImportPath: 'import cn.jystudio.bluetooth.RNBluetoothEscposPrinterPackage;',
          packageInstance: 'new RNBluetoothEscposPrinterPackage()',
        },
      },
    },
  },
};
