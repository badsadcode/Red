# Credits

All third-party assets in this repository are **CC0 1.0 (public domain)**:
https://creativecommons.org/publicdomain/zero/1.0/ . Attribution is not required, but given gladly.

## Textures: Poly Haven (https://polyhaven.com), CC0

Downloaded as 1k diffuse JPGs and baked down to 64/128 px palettised PNGs by `tools/fetch_textures.py`.

| Role | Source |
|---|---|
| `brick_painted` | https://polyhaven.com/a/painted_brick |
| `cabin_logs` | https://polyhaven.com/a/wood_trunk_wall |
| `carpet_office` | https://polyhaven.com/a/dirty_carpet |
| `castle_stone` | https://polyhaven.com/a/stone_block_wall |
| `ceiling_tiles` | procedural (tools/fetch_textures.py) |
| `chainlink` | procedural (tools/fetch_textures.py) |
| `concrete_dirty` | https://polyhaven.com/a/dirty_concrete |
| `concrete_floor` | https://polyhaven.com/a/hangar_concrete_floor |
| `concrete_wall` | https://polyhaven.com/a/concrete_wall_006 |
| `dirt_road` | https://polyhaven.com/a/rocky_trail |
| `dock_planks` | https://polyhaven.com/a/weathered_planks |
| `floor_tiles` | https://polyhaven.com/a/worn_tile_floor |
| `ground_forest` | https://polyhaven.com/a/mud_forest |
| `ground_grass` | https://polyhaven.com/a/grass_ground |
| `hazard_stripes` | procedural (tools/fetch_textures.py) |
| `metal_panel` | https://polyhaven.com/a/blue_metal_plate |
| `metal_plate` | https://polyhaven.com/a/metal_plate |
| `metal_rusty` | https://polyhaven.com/a/rusty_metal_02 |
| `moss_rock` | https://polyhaven.com/a/mossy_rock |
| `noise` | procedural (tools/fetch_textures.py) |
| `rock_cliff` | https://polyhaven.com/a/dark_rock_02 |
| `roof_shingles` | https://polyhaven.com/a/roof_slates_02 |
| `shore_gravel` | https://polyhaven.com/a/ganges_river_pebbles |
| `sign_restricted` | procedural (tools/fetch_textures.py) |
| `stone_floor_old` | https://polyhaven.com/a/monastery_stone_floor |
| `wood_dark` | https://polyhaven.com/a/dark_wood |
| `wood_planks` | https://polyhaven.com/a/wood_floor_worn |

Roles marked *procedural* are drawn by `tools/fetch_textures.py` itself (also CC0).

## Models: Quaternius (https://quaternius.com), CC0

Downloaded as OBJ + MTL from the public pack folders and converted to vertex-coloured GLBs by `tools/fetch_models.py`.

| Pack | Models |
|---|---|
| [Ultimate Food Pack](https://quaternius.com/packs/ultimatefood.html) | `apple`, `bottle`, `bread`, `chocolate_bar`, `egg_fried`, `fish_bone`, `fish_cooked`, `frying_pan`, `jar`, `mushroom`, `pot_soup`, `soda`, `steak` |
| [Survival Pack](https://quaternius.com/packs/survival.html) | `axe`, `backpack`, `bandages`, `battery_big`, `battery_small`, `bear_trap`, `bonfire`, `can_closed`, `can_open`, `compass`, `firewood`, `first_aid_kit`, `flare_gun`, `flashlight`, `gas_can`, `hatchet`, `matchbox`, `paddle`, `pan`, `pot`, `propane_tank`, `radio`, `shovel`, `trashcan`, `water_bottle` |
| [Ultimate Home Interior Pack](https://quaternius.com/packs/ultimatehomeinterior.html) | `bed_double`, `bed_single`, `bookshelf`, `chair_1`, `chair_2`, `couch`, `door_wood`, `drawer`, `fireplace`, `fridge`, `houseplant`, `kitchen_cabinet`, `kitchen_drawers`, `kitchen_sink`, `lamp_ceiling`, `lamp_desk`, `lamp_floor`, `nightstand`, `oven`, `plate`, `rug`, `rug_round`, `stool`, `table_round`, `trashcan_small`, `wall_shelf` |
| [Ultimate Nature Pack](https://quaternius.com/packs/ultimatenature.html) | `birch_1`, `birch_2`, `bush_1`, `bush_2`, `bush_berries_1`, `bush_berries_2`, `flowers`, `grass`, `grass_short`, `lilypad`, `log`, `log_moss`, `pine_1`, `pine_2`, `pine_3`, `pine_4`, `pine_5`, `plant_1`, `plant_2`, `plant_3`, `rock_1`, `rock_2`, `rock_3`, `rock_moss_1`, `rock_moss_2`, `rock_moss_3`, `rock_moss_4`, `rock_moss_5`, `rock_moss_6`, `rock_moss_7`, `stump`, `stump_moss`, `tree_common_1`, `tree_common_2`, `tree_dead_1` |
| [Ultimate Modular Sci-Fi Pack](https://quaternius.com/packs/ultimatemodularscifi.html) | `capsule`, `chest`, `column`, `computer`, `computer_small`, `container`, `crate`, `crate_long`, `laser`, `machine_base`, `pipes`, `pipes_long`, `pod`, `shelf`, `shelf_tall`, `staircase`, `statue`, `teleporter`, `vent`, `vessel`, `vessel_short`, `vessel_tall` |
| [Ultimate Furniture Pack](https://quaternius.com/packs/ultimatefurniture.html) | `closet`, `desk`, `office_chair`, `table` |
| [Cute Fish Pack](https://quaternius.com/packs/cutefish.html) | `dock_long`, `dock_stairs`, `fishing_rod`, `lure`, `rowboat`, `worm` |
| [Animated Fish Pack](https://quaternius.com/packs/animatedfish.html) | `fish_1`, `fish_2`, `fish_3` |

## Audio

All sound is synthesised at runtime with the Web Audio API; no recorded samples are used.
