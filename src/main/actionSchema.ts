import { z } from 'zod'
import {
  actionSafeties,
  actionTypes,
  focusPolicies,
  mappingLayerIds,
  shortcutModifiers,
  type KeyboardShortcut,
  type MappedAction
} from '../shared/contracts'
import { profileLimits } from '../shared/profileLimits'

/**
 * What a `MappedAction` is allowed to contain, as a run-time check.
 *
 * Two separate boundaries need this: the profile file on disk
 * ([profileRepository.ts](./profileRepository.ts)) and every action the
 * renderer asks the main process to dispatch ([ipcRequests.ts](./ipcRequests.ts)).
 * They are the same object under the same constraints, so they have to agree —
 * an action the repository would refuse to store must not be dispatchable, and
 * an action it stores must be dispatchable after a restart.
 *
 * `profileRepository` still carries its own copy of this schema because it was
 * being rewritten in parallel when this was written. It
 * should import from here; the two are byte-identical in intent today, and a
 * drift between them is a bug in whichever one is looser.
 */

export const keyboardShortcutSchema: z.ZodType<KeyboardShortcut> = z.strictObject({
  keyCode: z.number().int().min(0).max(profileLimits.shortcutKeyCode),
  modifiers: z.array(z.enum(shortcutModifiers)).max(profileLimits.shortcutModifiers),
  keyDisplay: z.string().min(1).max(profileLimits.shortcutKeyDisplay)
})

export const mappedActionSchema: z.ZodType<MappedAction> = z.lazy(() =>
  z.strictObject({
    type: z.enum(actionTypes),
    title: z.string().min(1).max(profileLimits.actionTitle),
    deepLinkURL: z.string().max(profileLimits.url).optional(),
    shortcut: keyboardShortcutSchema.optional(),
    codexCommandId: z.string().min(1).max(profileLimits.commandId).optional(),
    text: z.string().max(profileLimits.text).optional(),
    targetLayer: z.enum(mappingLayerIds).optional(),
    sequenceSteps: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          delayMilliseconds: z
            .number()
            .int()
            .min(0)
            .max(profileLimits.sequenceStepDelayMilliseconds),
          action: mappedActionSchema,
          focusPolicy: z.enum(focusPolicies),
          safety: z.enum(actionSafeties)
        })
      )
      .max(profileLimits.sequenceSteps)
      .optional()
  }).superRefine((action, context) => {
    const seen = new Set<string>()
    for (const [index, step] of (action.sequenceSteps ?? []).entries()) {
      if (seen.has(step.id)) {
        context.addIssue({
          code: 'custom',
          path: ['sequenceSteps', index, 'id'],
          message: `Sequence step id "${step.id}" is duplicated among its siblings.`
        })
      }
      seen.add(step.id)
    }
  })
)
