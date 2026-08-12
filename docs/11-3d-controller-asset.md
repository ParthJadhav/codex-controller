# DualSense controller 3D asset

Status date: 2026-07-24

## Decision

The Electron Controller workspace renders a real textured PlayStation 5
DualSense mesh directly in Three.js. The model is **Playstation 5 Dualsense** by
AHarmlessPotato, published on
[Sketchfab](https://sketchfab.com/3d-models/playstation-5-dualsense-878c1f882808477ab81c2fe86d5a3936)
under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

The downloadable GLB was obtained through the public Objaverse mirror and is
bundled without a format conversion. Asset identity is pinned:

| Artifact                                                 | SHA-256                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| Source `878c1f882808477ab81c2fe86d5a3936.glb`            | `534f153ab1ff1e0c9c8213a75bc9167ec6b5336fea9e3536ca8e6f6e81605efc` |
| App `src/renderer/public/models/DualSenseController.glb` | `534f153ab1ff1e0c9c8213a75bc9167ec6b5336fea9e3536ca8e6f6e81605efc` |

## Runtime integration

`DualSenseScene` owns a transparent Three.js WebGL canvas with a fixed
orthographic front camera, filmic tone mapping, and restrained studio key,
fill, ambient, and rim lights.

The original GLB does not provide stable semantic node names, but its physical
controls are disconnected topology islands. `splitDualSenseIntoParts` preserves
the source vertex attributes while splitting connected components and
classifying them by measured source-space bounds:

- Face buttons, every D-pad direction, both sticks, the touchpad, Create,
  Options, PS, shoulders, and triggers become actual interactive mesh nodes.
- Raycasting targets those original mesh nodes directly. There is no DOM or
  canvas hotspot layer over the controller.
- Selected, hovered, and physically pressed controls modify the complete
  original part's PBR material, emissive response, position, and geometry-based
  additive halo.
- Face-button symbols are small Three.js line meshes parented to the original
  face-button geometry.
- Two light-strip meshes beside the touchpad mirror the same priority result
  written to the physical controller light.
- An offscreen semantic control list preserves keyboard navigation and screen
  reader access without changing pointer hit testing.
- Missing assets produce a visible fallback instead of a blank scene or crash.

The topology classifier is covered by unit tests, and the packaged Electron
runtime is verified by clicking representative projected points on every
visible control and checking the selected mapping.

## License compliance

`src/renderer/public/models/DualSenseController-LICENSE.md` carries the creator,
title, source URL, CC BY 4.0 license, bundled hash, modification summary, and
trademark disclaimer. The same attribution appears in Settings.

PlayStation and DualSense are trademarks of Sony Interactive Entertainment. This independent project is not affiliated with or endorsed by Sony.
