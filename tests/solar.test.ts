import test from "node:test";
import assert from "node:assert/strict";
import { dateAtKst, daylightHours, formatMinutes, getSolarPosition, seasonalDate } from "../src/lib/solar";
import { createShadowFan } from "../src/lib/shadows";

test("KST date conversion and time formatting are deterministic", () => {
  assert.equal(dateAtKst("2026-06-21", 720).toISOString(), "2026-06-21T03:00:00.000Z");
  assert.equal(formatMinutes(375), "06:15");
  assert.equal(formatMinutes(1440), "00:00");
});

test("summer noon in Gangnam has a high daylight sun", () => {
  const sun = getSolarPosition(dateAtKst("2026-06-21", 12 * 60 + 30), 37.49794, 127.02761);
  assert.equal(sun.isDaylight, true);
  assert.ok(sun.elevation > 70 && sun.elevation < 80);
  assert.ok(sun.azimuth > 160 && sun.azimuth < 220);
});

test("shadow fan is hidden at night and points away during day", () => {
  assert.equal(createShadowFan([127.02, 37.49], 180, -5).features.length, 0);
  const fan = createShadowFan([127.02, 37.49], 180, 45);
  assert.equal(fan.features.length, 5);
  assert.equal(fan.features[0].geometry.type, "Polygon");
});

test("calendar helpers preserve expected values", () => {
  assert.equal(seasonalDate(2026, "winter"), "2026-12-21");
  assert.equal(daylightHours(new Date(0), new Date(36_000_000)), 10);
});
