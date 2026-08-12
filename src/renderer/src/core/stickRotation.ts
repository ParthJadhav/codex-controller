export type RotationStep = 'clockwise' | 'counterclockwise'

export interface StickRotationOptions {
  /** Below this the stick is too close to centre for the angle to mean anything. */
  minimumMagnitude?: number
  /** Travel needed before one step is emitted. A quarter turn by default. */
  stepRadians?: number
  /** Angle jumps larger than this are a lost sample, not real travel. */
  maximumSampleRadians?: number
}

const TWO_PI = Math.PI * 2

/**
 * Below this the angle is noise rather than aim. Exported because Diagnostics
 * has to tell the user whether they are pushing the stick far enough for a
 * rotation to be tracked at all — a circle traced inside the threshold looks
 * identical to a dead stick otherwise.
 */
export const STICK_ROTATION_MINIMUM_MAGNITUDE = 0.5
/** Travel needed before one step is emitted. A quarter turn. */
export const STICK_ROTATION_STEP_RADIANS = Math.PI / 2
/** Angle jumps larger than this are a lost sample, not real travel. */
export const STICK_ROTATION_MAXIMUM_SAMPLE_RADIANS = Math.PI * 0.75

/**
 * Turns a stick position stream into discrete rotation steps.
 *
 * The DualSense has no encoder, so "rotate the stick" has to be recovered from
 * successive positions. Travel is accumulated with the sign of the motion and
 * reset whenever the user reverses or lets go, which keeps a wobble around the
 * step boundary from emitting alternating steps.
 *
 * The vector convention matches `stickVectorFromActiveValues`: x right, y up.
 * Increasing angle is therefore counterclockwise on screen.
 */
export class StickRotationTracker {
  private lastAngle: number | null = null
  private accumulated = 0
  private rejected = 0
  private readonly minimumMagnitude: number
  private readonly stepRadians: number
  private readonly maximumSampleRadians: number

  constructor(options: StickRotationOptions = {}) {
    this.minimumMagnitude = options.minimumMagnitude ?? STICK_ROTATION_MINIMUM_MAGNITUDE
    this.stepRadians = options.stepRadians ?? STICK_ROTATION_STEP_RADIANS
    this.maximumSampleRadians =
      options.maximumSampleRadians ?? STICK_ROTATION_MAXIMUM_SAMPLE_RADIANS
  }

  update(x: number, y: number): RotationStep | null {
    // A non-finite sample is not a position, and it is not smaller than the
    // minimum magnitude either — it used to sail past that guard and become a
    // NaN `lastAngle`, after which every delta was NaN and the tracker never
    // emitted another step for the rest of the session.
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      this.reset()
      return null
    }
    if (Math.hypot(x, y) < this.minimumMagnitude) {
      this.reset()
      return null
    }

    const angle = Math.atan2(y, x)
    const previous = this.lastAngle
    this.lastAngle = angle
    if (previous === null) return null

    let delta = angle - previous
    while (delta > Math.PI) delta -= TWO_PI
    while (delta < -Math.PI) delta += TWO_PI
    if (Math.abs(delta) >= this.maximumSampleRadians) {
      this.accumulated = 0
      this.rejected += 1
      return null
    }

    if (this.accumulated !== 0 && Math.sign(delta) !== Math.sign(this.accumulated)) {
      this.accumulated = 0
    }
    this.accumulated += delta

    if (this.accumulated >= this.stepRadians) {
      this.accumulated -= this.stepRadians
      return 'counterclockwise'
    }
    if (this.accumulated <= -this.stepRadians) {
      this.accumulated += this.stepRadians
      return 'clockwise'
    }
    return null
  }

  /**
   * Travel banked toward the next step, signed the way `update` is. Diagnostics
   * shows this so a stick that is turning but never reaching a quarter turn is
   * visibly different from one the tracker is ignoring outright.
   */
  get accumulatedRadians(): number {
    return this.accumulated
  }

  /**
   * How many samples were discarded as impossible jumps *during the attempt
   * being tracked*. A circle that produces no steps while this climbs is a
   * sample-cadence problem, not a dead stick, and those two findings send the
   * handoff's discriminator down different rows.
   */
  get rejectedSampleCount(): number {
    return this.rejected
  }

  /**
   * Clears the rejection count along with the angle state. It is evidence about
   * one attempt at a rotation: carried across a release it kept answering
   * "sample cadence issue" for a stick whose next circle read perfectly.
   */
  reset(): void {
    this.lastAngle = null
    this.accumulated = 0
    this.rejected = 0
  }
}
