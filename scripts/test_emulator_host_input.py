"""Verify host keyboard input on our named AVD; never send keys to another window."""
import ctypes as C
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import subprocess
import time
import xml.etree.ElementTree as ET

if os.environ.get('CONDA_DEFAULT_ENV') != 'amazon-tv':
    raise SystemExit('Activate amazon-tv and source use_android_sdk.ps1 first.')
adb = str(Path(os.environ['ANDROID_HOME']) / 'platform-tools/adb.exe')
user = C.WinDLL('user32', use_last_error=True)
kernel = C.WinDLL('kernel32', use_last_error=True)
user.GetForegroundWindow.restype = W.HWND
user.GetWindowThreadProcessId.argtypes = [W.HWND, C.POINTER(W.DWORD)]
user.GetWindowTextW.argtypes = [W.HWND, W.LPWSTR, C.c_int]
user.SetForegroundWindow.argtypes = [W.HWND]
user.ShowWindow.argtypes = [W.HWND, C.c_int]
kernel.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
kernel.OpenProcess.restype = W.HANDLE
kernel.QueryFullProcessImageNameW.argtypes = [W.HANDLE, W.DWORD, W.LPWSTR, C.POINTER(W.DWORD)]
kernel.CloseHandle.argtypes = [W.HANDLE]
windows = []
callback_type = C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)

@callback_type
def collect(hwnd, unused):
    title = C.create_unicode_buffer(1024)
    user.GetWindowTextW(hwnd, title, 1024)
    if 'JabTempo_TV_1080p' in title.value and '5580' in title.value:
        pid = W.DWORD()
        user.GetWindowThreadProcessId(hwnd, C.byref(pid))
        handle = kernel.OpenProcess(0x1000, False, pid.value)
        if handle:
            name = C.create_unicode_buffer(4096)
            size = W.DWORD(4096)
            try:
                if kernel.QueryFullProcessImageNameW(handle, 0, name, C.byref(size)):
                    exe = Path(name.value).resolve()
                    if exe.is_relative_to(Path(os.environ['ANDROID_HOME'], 'emulator').resolve()):
                        windows.append((hwnd, title.value, pid.value, str(exe)))
            finally:
                kernel.CloseHandle(handle)
    return True

user.EnumWindows(collect, 0)
if len(windows) != 1:
    raise SystemExit(f'Expected one owned AVD window; found {windows!r}. No host input sent.')
hwnd, title, pid, executable = windows[0]

class KEYBDINPUT(C.Structure):
    _fields_ = [('wVk', W.WORD), ('wScan', W.WORD), ('dwFlags', W.DWORD),
                ('time', W.DWORD), ('dwExtraInfo', C.c_size_t)]

class MOUSEINPUT(C.Structure):
    _fields_ = [('dx', W.LONG), ('dy', W.LONG), ('mouseData', W.DWORD),
                ('dwFlags', W.DWORD), ('time', W.DWORD), ('dwExtraInfo', C.c_size_t)]

class INPUTUNION(C.Union):
    _fields_ = [('ki', KEYBDINPUT), ('mi', MOUSEINPUT)]

class INPUT(C.Structure):
    _anonymous_ = ('data',)
    _fields_ = [('type', W.DWORD), ('data', INPUTUNION)]

user.SendInput.argtypes = [W.UINT, C.POINTER(INPUT), C.c_int]

def android(*args):
    return subprocess.check_output([adb, '-s', 'emulator-5580', *args], text=True, timeout=25)

def tree():
    if 'org.jabtempo.tv' not in android('shell', 'dumpsys', 'window'):
        raise RuntimeError('JabTempo activity is unavailable.')
    dumped = android('shell', 'uiautomator', 'dump', '/sdcard/jabtempo-input.xml')
    if 'dumped to:' not in dumped:
        raise RuntimeError('No fresh UI tree; refusing stale assertions.')
    return ET.fromstring(android('exec-out', 'cat', '/sdcard/jabtempo-input.xml'))

def focused(root):
    return next((n.get('content-desc') or n.get('text') for n in root.iter('node')
                 if n.get('focused') == 'true'), None)

def key(vk):
    user.ShowWindow(hwnd, 9)
    user.SetForegroundWindow(hwnd)
    time.sleep(.2)
    # Check immediately before each down/up pair: never type into the IDE or another app.
    if user.GetForegroundWindow() != hwnd:
        raise RuntimeError('Owned emulator could not receive foreground focus. No key sent.')
    events = (INPUT * 2)(INPUT(type=1, ki=KEYBDINPUT(wVk=vk)),
                         INPUT(type=1, ki=KEYBDINPUT(wVk=vk, dwFlags=2)))
    if user.SendInput(2, events, C.sizeof(INPUT)) != 2:
        raise RuntimeError('Windows rejected emulator key input.')
    time.sleep(.35)

report = {'status': 'FAIL', 'source': 'Windows SendInput to foreground-verified owned emulator window',
          'window': title, 'pid': pid, 'executable': executable, 'physicalPhoneVerified': False}
try:
    android('shell', 'am', 'force-stop', 'org.jabtempo.tv')
    android('shell', 'am', 'start', '-W', '-n', 'org.jabtempo.tv/.MainActivity')
    time.sleep(1.5)
    first = tree()
    if any('Learn left and right.' in n.get('text', '') for n in first.iter('node')) or any(
        n.get('resource-id') == 'screen-Pair' for n in first.iter('node')
    ):
        android('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        first = tree()
    assert any('Your moves. Your rhythm.' in n.get('text', '') for n in first.iter('node')), 'Home absent'
    report['before'] = focused(first)
    key(0x27)  # Right, actual laptop keyboard route rather than adb keyevent.
    report['afterRight'] = focused(tree())
    assert report['afterRight'] == 'Family Challenge', report
    key(0x0D)
    assert any('A little friendly competition.' in n.get('text', '') for n in tree().iter('node')), 'Enter did not open Family'
    report['rightArrow'] = report['enterSelect'] = True
    report['status'] = 'PASS'
except Exception as error:
    report['error'] = str(error)
finally:
    Path('results/native').mkdir(parents=True, exist_ok=True)
    Path('results/native/host_input.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
if report['status'] != 'PASS':
    raise SystemExit(1)
