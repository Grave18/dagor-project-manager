// Copyright (C) Gaijin Games KFT.  All rights reserved.

#include <daScript/misc/platform.h>
#include <daScript/daScriptModule.h>
#include <package_physobj/pullDas.h>

// The editor's navmesh module is referenced by the shared AOT compiler, not the game.
das::Module *das_pull_RebuildNavMeshModule() { return nullptr; }

void pull_game_das() { NEED_MODULES_PACKAGE_PHYSOBJ() }
