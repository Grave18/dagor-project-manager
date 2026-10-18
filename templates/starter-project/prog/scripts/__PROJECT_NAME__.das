options no_aot = true
require app
require ecs
require ecs.fs
require ECSGlobalTags
require danetlibs.frame_graph_renderer.frame_graph_renderer_init
require danetlibs.composite_entity.composite_entity_init

[init]
def load
  var ok = true
  ok = load_folder("%scripts/das") && ok
  ok = load_folder("%scripts/das/character_controller") && ok
  if ecs_has_tag("input") || is_in_aot()
    ok = load_folder("%scripts/das/input") && ok
  ok = load_frame_graph_renderer("%danetlibs/frame_graph_renderer") && ok
  ok = load_composite_entity("%danetlibs/composite_entity") && ok
  if is_in_aot()
    assert(ok)
