import type { ControllerInputId } from '@shared/contracts'

/**
 * Which mesh on the model a logical input lives on.
 *
 * The stick directions and `share` have no geometry of their own: the model has
 * one stick cap and one Create button, and both the halo and the keyboard
 * navigation have to land on those rather than on nothing.
 *
 * This file used to also carry a hand-calibrated table of surface boxes with
 * `surfaceContains`/`inputAtPoint` hit-testing. Mesh raycasting against the
 * loaded glTF replaced it; the table survived only in its own tests, where it
 * kept asserting coordinates the app no longer consults.
 */
export const physicalInput = (input: ControllerInputId): ControllerInputId => {
  if (input === 'share') return 'view'
  if (input.startsWith('leftStick') && input !== 'leftStickClick') return 'leftStickClick'
  if (input.startsWith('rightStick') && input !== 'rightStickClick') return 'rightStickClick'
  return input
}
