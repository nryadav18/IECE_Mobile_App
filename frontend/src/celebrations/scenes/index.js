/**
 * Scene registry.
 *
 * An occasion names its scene as a string; this is the only place that string
 * becomes a component. Adding a scene means adding it here and nowhere else,
 * and an occasion carrying a scene name that doesn't exist falls back to
 * `confetti` rather than rendering nothing — a wrong-looking header is
 * recoverable, a blank one is not.
 */

import ConfettiScene from './ConfettiScene';
import EmblemScene from './EmblemScene';
import FlagScene from './FlagScene';
import FloralScene from './FloralScene';
import LightsScene from './LightsScene';
import SkyScene from './SkyScene';
import {
  AnniversaryScene,
  DiwaliScene,
  IndependenceScene,
  RepublicScene,
} from './flagships';

export const SCENES = {
  /* engines */
  flag: FlagScene,
  lights: LightsScene,
  floral: FloralScene,
  sky: SkyScene,
  confetti: ConfettiScene,
  emblem: EmblemScene,
  /* flagships */
  independence: IndependenceScene,
  republic: RepublicScene,
  diwali: DiwaliScene,
  anniversary: AnniversaryScene,
};

export const SCENE_KEYS = Object.keys(SCENES);

export function sceneFor(name) {
  return SCENES[name] || SCENES.confetti;
}
