require app
require ecs
require DagorSystem
require DagorDataBlock
require DagorMath
require DngCamera

[cpp_event(broadcast)]
struct EventOnClientConnected
  connid : int
  matching : uint64
  userName : das_string
  groupId : int64
  clientFlags : uint16
  platformUserId : das_string
  platform : das_string
  matchingTeam : int
  appId : int

[es(on_event=EventOnGameAppStarted)]
def on_gameapp_started_es(evt : Event)
  var sceneName = dgs_get_argv("scene")
  if empty(sceneName)
    sceneName = dgs_get_settings() |> datablock_getStr("scene", "")
  if empty(sceneName)
    sceneName = "gamedata/scenes/empty.blk"

  var importScenes : array<string>
  dgs_get_argv_all("importScene") <| $(importScene)
    importScenes |> push(importScene)
    return false

  print("[SCENE LOAD] starting with scene = {sceneName}, importScenes = {importScenes}")
  switch_scene(sceneName, importScenes)

[es(tag=not_inside_tools)]
def on_client_connected_server(evt : EventOnClientConnected)
  var spawnTms : array<float3x4>
  query() <| $ [es(REQUIRE=respbase)] (transform : float3x4)
    spawnTms |> push(transform)

  assert(length(spawnTms) > 0, "No spawn bases to spawn onto")
  let spawnTm = spawnTms[0]
  createEntity("phys_global_state")
  let eid : EntityId = createEntitySync("character_controller") <| $(var init)
    init |> set("transform", spawnTm)
    init |> set("phys__pos", spawnTm[3] - float3(0.f, 1.f, 0.f))
    init |> set("phys__rot", float4(DagorMath::quat(spawnTm)))

  set_scene_camera_entity(eid)
