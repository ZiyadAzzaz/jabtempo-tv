conda activate amazon-tv
# Dot-source from an initialized PowerShell to configure this process only.
$ErrorActionPreference = 'Stop'
if ($env:CONDA_DEFAULT_ENV -ne 'amazon-tv') { throw 'amazon-tv must be active' }
$taskAndroidRoot = if ($env:JABTEMPO_ANDROID_ROOT) { [IO.Path]::GetFullPath($env:JABTEMPO_ANDROID_ROOT).TrimEnd('\') } else { 'D:\android-fire-TV' }
$taskSdkPath = Join-Path $taskAndroidRoot 'sdk'
if (-not (Test-Path -LiteralPath $taskSdkPath)) { throw "Install the Android SDK first: $taskSdkPath" }
$env:ANDROID_HOME = $taskSdkPath
$env:ANDROID_SDK_ROOT = $taskSdkPath
$env:ANDROID_AVD_HOME = Join-Path $taskAndroidRoot 'avd'
$env:ANDROID_USER_HOME = Join-Path $taskAndroidRoot 'android-user'
$env:ANDROID_EMULATOR_HOME = $env:ANDROID_USER_HOME
$env:GRADLE_USER_HOME = Join-Path $taskAndroidRoot 'gradle'
$env:TEMP = Join-Path $taskAndroidRoot 'tmp'
$env:TMP = $env:TEMP
$env:JAVA_HOME = Join-Path $env:CONDA_PREFIX 'Library'
if (-not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
    throw 'Expected JDK in amazon-tv/Library. Inspect the installed openjdk package.'
}
$env:PATH = "$taskSdkPath\platform-tools;$taskSdkPath\emulator;$taskSdkPath\cmdline-tools\latest\bin;$env:PATH"
# Redirect JVM extraction/temp too; never snapshot or persist the machine PATH.
$env:JAVA_TOOL_OPTIONS = "-Djava.io.tmpdir=$($env:TEMP)"
