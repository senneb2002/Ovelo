# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['python\\server.py'],
    pathex=['python'],  # CRITICAL: Include python directory so all modules are found
    binaries=[],
    datas=[],
    hiddenimports=['win32timezone', 'win32gui', 'win32api', 'win32con', 'pynput.keyboard._win32', 'pynput.mouse._win32'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,  # Set to 0 to disable bytecode optimization (ensures fresh compile)
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='ovelo_server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
