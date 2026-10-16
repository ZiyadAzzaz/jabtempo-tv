const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withKotlinJvmTarget(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const rootBuildGradle = path.join(
        config.modRequest.platformProjectRoot,
        "build.gradle"
      );

      if (fs.existsSync(rootBuildGradle)) {
        let contents = fs.readFileSync(rootBuildGradle, "utf-8");

        if (!contents.includes("ext.kotlinVersion")) {
          contents = contents.replace(
            "buildscript {",
            'buildscript {\n  ext.kotlinVersion = findProperty("android.kotlinVersion") ?: "2.0.21"'
          );
          fs.writeFileSync(rootBuildGradle, contents);
        }
      }

      return config;
    },
  ]);
}

module.exports = withKotlinJvmTarget;
