// App-wide haptic patterns for react-haptics (merged with its presets: selection, impact-light,
// impact-medium, impact-heavy, success, warning, error).
//
// Two layers:
// - TapHaptics (components/tap-haptics.tsx): one document listener ticks on any button/link tap.
//   Android vibrates; iOS Safari ignores it (it only ticks from a real tap on a switch).
// - `data-haptic="<pattern>"`: react-haptics lays an invisible <input switch> over the element so iOS
//   ticks too. A touch that starts on that switch doesn't scroll the page, so use it ONLY on controls
//   outside scrolling content (the fixed action bar) or on quick confirm taps (pull In / Out).
export const HAPTIC_PATTERNS = {
  /** Repeats while the scoring console's pull button is held (Android only). */
  "pull-hold": [{ duration: 30, intensity: 1 }, { delay: 270, duration: 30, intensity: 0.6 }],
}
