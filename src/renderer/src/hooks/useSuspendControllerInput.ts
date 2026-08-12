import { useEffect } from 'react'
import { controllerInputSuspension } from '../core/inputSuspension'

/**
 * Holds controller input suspended for as long as `active` is true.
 *
 * The claim is released on unmount as well as when `active` goes false, so a
 * recorder that is closed mid-recording cannot leave the controller mute.
 */
export function useSuspendControllerInput(active: boolean): void {
  useEffect(() => {
    if (!active) return
    return controllerInputSuspension.claim()
  }, [active])
}
