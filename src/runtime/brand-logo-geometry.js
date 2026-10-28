/* Private factory input, shared by the React mark and its tests. No exports here:
 * assigning module.exports would overwrite the enclosing theme's export map. */
var UniverseBrandLogoGeometry = {
  cx: 12,
  cy: 12,
  horizon: 5.8,
  ring: 5.8,
  tilt: -16,
  /* One ellipse split at its endpoints: back goes left-to-right, front returns.
   * Keeping the centre empty uses a luminance mask, not a background colour. */
  path: {
    back: 'M 1.5 12 A 10.5 3.9 0 0 1 22.5 12',
    front: 'M 22.5 12 A 10.5 3.9 0 0 1 1.5 12',
  },
  period: 10,
}
