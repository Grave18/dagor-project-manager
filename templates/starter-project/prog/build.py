#!/usr/bin/env python3
import os
import shutil
import sys
from pathlib import Path

PROJECT_PROG = Path(__file__).resolve().parent
DAGOR_ROOT = PROJECT_PROG.parent.parent
sys.path.insert(0, str(DAGOR_ROOT))
from build_all import (  # noqa: E402
  BUILD_TARGET_ARCH,
  DAGOR_HOST,
  DABUILD_CMD,
  DRY_RUN,
  FONTGEN_EXE,
  JAM_BUILD_TARGET_ARCH_OPTIONS,
  VROMFS_PACKER_EXE,
  run,
)
sys.path.remove(str(DAGOR_ROOT))
os.chdir(PROJECT_PROG)

PROJECT_ROOT = PROJECT_PROG.parent
PROJECT_LOCATION = "__PROJECT_NAME__/prog"
GAME_NAME = "__PROJECT_NAME__"
VROMFS_NAME = f"{GAME_NAME}.vromfs.bin"
SHADER_COMPILER_EXE = Path(VROMFS_PACKER_EXE).with_name("dsc2-hlsl11-dev.exe")
SHADER_INTERMEDIATE_DIR = PROJECT_ROOT / "_output" / "shaders" / "__PROJECT_NAME__-game~dx11"
TOOLS_SHADER_INTERMEDIATE_DIR = PROJECT_ROOT / "_output" / "shaders" / "__PROJECT_NAME__-tools~dx11"

SUPPORTED_COMPONENTS = {"assets", "code", "editor_shaders", "gui", "shaders", "vromfs"}
requested_components = [
  arg for arg in sys.argv[1:]
  if not arg.startswith("arch:") and arg not in {"--dry-run", "-dry-run"}
]
unknown_components = sorted(set(requested_components) - SUPPORTED_COMPONENTS)
if unknown_components:
  raise SystemExit(f"Unsupported build component(s): {', '.join(unknown_components)}")

components = set(requested_components) or {"assets", "code", "gui", "shaders", "vromfs"}
if DAGOR_HOST == "windows" and BUILD_TARGET_ARCH not in {"", "x86_64"}:
  raise SystemExit("This template currently supports Windows x86_64 builds only.")


def run_checked(command, cwd="."):
  if not run(command, cwd=cwd):
    raise SystemExit(1)


def build_vromfs():
  if not Path(VROMFS_PACKER_EXE).is_file():
    raise SystemExit(f"VROMFS packer not found: {VROMFS_PACKER_EXE}")
  run_checked([VROMFS_PACKER_EXE, "prog.vromfs.blk", "-platform:PC", "-quiet", "-addpath:."])
  output_path = PROJECT_ROOT / "game" / VROMFS_NAME
  if not DRY_RUN and not output_path.is_file():
    raise SystemExit(f"VROMFS packer did not create the expected file: {output_path}")


def build_editor_shaders(reuse_prebuilt=True):
  if DAGOR_HOST != "windows":
    raise SystemExit("This template currently supports Windows shader builds only.")
  if not SHADER_COMPILER_EXE.is_file():
    raise SystemExit(f"Shader compiler not found: {SHADER_COMPILER_EXE}")

  tools_output_dir = PROJECT_ROOT / "tools"
  if not DRY_RUN:
    tools_output_dir.mkdir(parents=True, exist_ok=True)

  tools_shader_dump = tools_output_dir / "tools.ps50.shdump.bin"
  if not DRY_RUN and (not reuse_prebuilt or not (tools_shader_dump.is_file() and tools_shader_dump.stat().st_size > 0)):
    prebuilt_tools_dump = find_prebuilt_tools_shader_dump() if reuse_prebuilt else None
    if prebuilt_tools_dump:
      shutil.copy2(prebuilt_tools_dump, tools_shader_dump)
      print(f"Reused tools shader dump: {prebuilt_tools_dump}")
    else:
      common_args = [
        "-q", "-shaderOn", "-nodisassembly", "-commentPP", "-codeDumpErr", "-maxVSF", "4096"
      ]
      run_checked([
        str(SHADER_COMPILER_EXE), "shaders_tools11.blk", *common_args,
        "-o", str(TOOLS_SHADER_INTERMEDIATE_DIR)
      ], cwd="shaders")

  if not DRY_RUN and (not tools_shader_dump.is_file() or tools_shader_dump.stat().st_size == 0):
    raise SystemExit(f"Shader compiler did not create the expected dump: {tools_shader_dump}")
  if not DRY_RUN:
    print(f"Shader dump: {tools_shader_dump}")


def build_shaders():
  if DAGOR_HOST != "windows":
    raise SystemExit("This template currently supports Windows shader builds only.")
  if not SHADER_COMPILER_EXE.is_file():
    raise SystemExit(f"Shader compiler not found: {SHADER_COMPILER_EXE}")

  output_dir = PROJECT_ROOT / "game" / "compiledShaders"
  if not DRY_RUN:
    SHADER_INTERMEDIATE_DIR.parent.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

  common_args = [
    "-q", "-shaderOn", "-nodisassembly", "-commentPP", "-codeDumpErr", "-maxVSF", "4096"
  ]
  run_checked([
    str(SHADER_COMPILER_EXE), "shaders_dx11.blk", *common_args,
    "-o", str(SHADER_INTERMEDIATE_DIR)
  ], cwd="shaders")
  build_editor_shaders(reuse_prebuilt=False)

  game_shader_dump = output_dir / "game.ps50.shdump.bin"
  if not DRY_RUN and (not game_shader_dump.is_file() or game_shader_dump.stat().st_size == 0):
    raise SystemExit(f"Shader compiler did not create the expected dump: {game_shader_dump}")
  if not DRY_RUN:
    print(f"Shader dump: {game_shader_dump}")


def find_prebuilt_tools_shader_dump():
  candidates = [
    DAGOR_ROOT / "project_stalker" / "tools" / "tools.ps50.shdump.bin",
    DAGOR_ROOT / "outerSpace" / "tools" / "tools.ps50.shdump.bin",
  ]
  samples_dir = DAGOR_ROOT / "samples"
  if samples_dir.is_dir():
    candidates.extend(samples_dir.glob("*/tools/tools.ps50.shdump.bin"))
    candidates.extend(samples_dir.glob("*/develop/toolShaders/tools.ps50.shdump.bin"))

  for candidate in candidates:
    if candidate.is_file() and candidate.stat().st_size > 0:
      return candidate
  return None


def build_gui():
  if not Path(FONTGEN_EXE).is_file():
    raise SystemExit(f"Font generator not found: {FONTGEN_EXE}")
  if not Path(VROMFS_PACKER_EXE).is_file():
    raise SystemExit(f"VROMFS packer not found: {VROMFS_PACKER_EXE}")

  gui_dir = PROJECT_ROOT / "develop" / "gui"
  font_output_dir = gui_dir / "pc.out.ui"
  if not DRY_RUN:
    if font_output_dir.exists():
      shutil.rmtree(font_output_dir)
    font_output_dir.mkdir(parents=True)

  run_checked([FONTGEN_EXE, "fontgenPC.blk", "-fullDynamic", "-quiet"], cwd=str(gui_dir / "fonts"))
  run_checked([VROMFS_PACKER_EXE, "fonts.vromfs.blk", "-quiet"], cwd=str(gui_dir))

  output_path = PROJECT_ROOT / "game" / "ui" / "fonts.vromfs.bin"
  if not DRY_RUN and (not output_path.is_file() or output_path.stat().st_size == 0):
    raise SystemExit(f"Font build did not create the expected file: {output_path}")
  if not DRY_RUN:
    print(f"UI fonts: {output_path}")


def build_code():
  if shutil.which("jam") is None:
    raise SystemExit("Jam is not available on PATH.")

  project_jam_options = list(JAM_BUILD_TARGET_ARCH_OPTIONS)
  if not project_jam_options and DAGOR_HOST == "windows":
    project_jam_options = ["-sPlatformArch=x86_64"]

  run_checked([
    "jam",
    "-sRoot=../..",
    f"-sProjectLocation={PROJECT_LOCATION}",
    f"-sTarget={GAME_NAME}-aot",
    "-sOutDir=../tools/das-aot",
    "-f",
    "../../prog/daNetGame-das-aot/jamfile",
    *project_jam_options,
  ])
  run_checked(["jam", "-sNeedDasAotCompile=yes", *project_jam_options])

  if DAGOR_HOST == "windows":
    target_arch = BUILD_TARGET_ARCH or "x86_64"
    exe_path = PROJECT_ROOT / "game" / f"windows-{target_arch}" / f"{GAME_NAME}-dev.exe"
    if not DRY_RUN and (not exe_path.is_file() or exe_path.stat().st_size == 0):
      raise SystemExit(f"Game build did not create the expected executable: {exe_path}")
    if not DRY_RUN:
      print(f"Executable: {exe_path}")


if "vromfs" in components or "code" in components:
  build_vromfs()

if "shaders" in components:
  build_shaders()
elif "editor_shaders" in components:
  build_editor_shaders()

if "gui" in components:
  build_gui()

if "code" in components:
  build_code()

if "assets" in components:
  if not Path(DABUILD_CMD[0]).is_file():
    raise SystemExit(f"Asset builder not found: {DABUILD_CMD[0]}")
  run_checked(DABUILD_CMD + ["../application.blk"], cwd="../develop")
